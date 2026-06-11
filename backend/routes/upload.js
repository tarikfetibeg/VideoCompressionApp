const express = require('express');
const multer = require('multer');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const FfmpegSettings = require('../models/FfmpegSettings');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const {
  allowedVideoExtensions,
  allowedVideoMimetypes,
  supportedVideoFormatSummary,
} = require('../config/mediaFormats');
const path = require('path');
const fs = require('fs');
const {
  paths,
  ensureFolderExists,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
  createRawManifestPath,
} = require('../utils/storagePaths');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { probeMedia } = require('../services/videoProcessingService');
const { getQueueErrorMessage } = require('../utils/queueErrors');

const router = express.Router();

const DEFAULT_MAX_UPLOAD_SIZE_GB = 25;
const MAX_UPLOAD_SIZE_GB = Number(process.env.MAX_UPLOAD_SIZE_GB) > 0
  ? Number(process.env.MAX_UPLOAD_SIZE_GB)
  : DEFAULT_MAX_UPLOAD_SIZE_GB;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_GB * 1024 * 1024 * 1024;
const MAX_UPLOAD_FILES = parseInt(process.env.MAX_UPLOAD_FILES || '50', 10) || 50;

const storage = multer.diskStorage({
  destination: paths.raw,
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('raw', file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const mimetype = String(file.mimetype || '').toLowerCase();

  if (allowedVideoMimetypes.includes(mimetype)) {
    return cb(null, true);
  }

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedVideoExtensions.includes(ext)) {
    return cb(null, true);
  }

  return cb(
    new Error(`Unsupported file type: ${file.mimetype} or extension ${ext}. Supported: ${supportedVideoFormatSummary}.`),
    false
  );
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: MAX_UPLOAD_FILES,
  },
});

function mapCodec(codec) {
  switch (codec) {
    case 'h264':
      return 'libx264';
    case 'h265':
      return 'libx265';
    case 'h264_nvenc':
      return 'h264_nvenc';
    case 'h265_nvenc':
      return 'hevc_nvenc';
    default:
      return 'libx264';
  }
}

function mapResolution(resolution) {
  switch (resolution) {
    case '720':
      return '1280x720';
    case '1080':
      return '1920x1080';
    case '1440':
      return '2560x1440';
    case '2160':
      return '3840x2160';
    default:
      return '1920x1080';
  }
}

function getBitrateKbps(value) {
  const parsed = parseInt(value, 10);
  return parsed ? parsed * 1000 : 1500;
}

function getFrameRate(value) {
  const parsed = parseInt(value, 10);
  return parsed || 30;
}

async function getRawRetentionDays() {
  const settings = await FfmpegSettings.findOne({});
  const value = settings && Number.isInteger(settings.rawRetentionDays)
    ? settings.rawRetentionDays
    : 0;

  if (value < 0) return 0;
  if (value > 365) return 365;

  return value;
}

function buildRawRetentionInfo(rawRetentionDays) {
  const days = Number(rawRetentionDays) || 0;

  if (days <= 0) {
    return {
      keepRaw: false,
      rawRetentionDays: 0,
      rawExpiresAt: null,
    };
  }

  return {
    keepRaw: true,
    rawRetentionDays: days,
    rawExpiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  };
}

function buildSourceMetadata(mediaProbe = {}) {
  return {
    sourceFormat: mediaProbe.container || null,
    sourceCodec: mediaProbe.codec || null,
    sourceResolution: mediaProbe.resolution || null,
    sourceBitrate: mediaProbe.bitrate || null,
    sourceFramerate: mediaProbe.framerate || null,
    sourceDuration: mediaProbe.duration || null,
    sourceAudioCodec: mediaProbe.audioCodec || null,
    sourceAudioChannels: mediaProbe.audioChannels || null,
    sourceAudioSampleRate: mediaProbe.audioSampleRate || null,
  };
}

async function inspectSourceMedia(rawVideoPath) {
  try {
    const mediaProbe = await probeMedia(rawVideoPath);
    return buildSourceMetadata(mediaProbe);
  } catch (error) {
    console.warn(`Could not probe source media "${rawVideoPath}":`, error.message);
    return buildSourceMetadata();
  }
}

async function enqueueOrMarkFailed(videoDoc) {
  try {
    const job = await enqueueVideoProcessing(videoDoc._id);
    videoDoc.processingJobId = job.id.toString();
    return { job, error: null };
  } catch (error) {
    const queueMessage = getQueueErrorMessage(error);
    videoDoc.processingStatus = 'failed';
    videoDoc.processingError = queueMessage;
    videoDoc.processingCompletedAt = new Date();
    await videoDoc.save();

    return { job: null, error: queueMessage };
  }
}

async function writeRawUploadManifest(rawVideoPath, manifest) {
  try {
    ensureFolderExists(paths.rawManifests);

    await fs.promises.writeFile(
      createRawManifestPath(rawVideoPath),
      JSON.stringify(
        {
          ...manifest,
          rawPath: rawVideoPath,
          recordedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (error) {
    console.warn('Could not write raw upload manifest:', error.message);
  }
}

router.post(
  '/',
  authenticateToken,
  authorize(['Reporter', 'Editor', 'VideoEditor', 'Admin']),
  upload.array('videos', MAX_UPLOAD_FILES),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded.' });
      }

      const videosProcessed = [];
      const auditDetails = [];
      const queueFailures = [];
      const rawRetentionDays = await getRawRetentionDays();

      if (req.user.role === 'Reporter' || req.user.role === 'Admin') {
        const tagEvent = req.body.event;
        const tagLocation = req.body.location || '';
        const tagDate = req.body.date;

        if (!tagEvent || !tagDate) {
          return res.status(400).json({
            message: 'Missing required tags: event or date.',
          });
        }

        for (const file of req.files) {
          const rawVideoPath = file.path;
          const outputFilename = createMp4Filename('compressed', file.originalname);
          const outputPath = path.join(paths.compressed, outputFilename);
          const previewFilename = createMp4Filename('preview', file.originalname);
          const previewPath = path.join(paths.previews, previewFilename);
          const thumbnailFilename = createJpgFilename('thumb', file.originalname);
          const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);
          const rawRetentionInfo = buildRawRetentionInfo(rawRetentionDays);

          ensureFolderExists(paths.compressed);
          ensureFolderExists(paths.previews);
          ensureFolderExists(paths.thumbnails);

          const ffmpegCodec = mapCodec(req.body.codec);
          const resolutionValue = mapResolution(req.body.resolution);
          const bitrateKbps = getBitrateKbps(req.body.bitrate);
          const frameRate = getFrameRate(req.body.framerate);

          await writeRawUploadManifest(rawVideoPath, {
            uploadKind: 'raw-ingest',
            originalFilename: file.originalname,
            uploaderId: req.user.id,
            uploaderUsername: req.user.username,
            uploaderRole: req.user.role,
            event: tagEvent,
            location: tagLocation,
            tagDate,
            status: 'raw',
            processingMode: 'transcode',
          });

          const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;
          const sourceMetadata = await inspectSourceMedia(rawVideoPath);

          const videoDoc = new Video({
            filename: outputFilename,
            filepath: outputPath,
            originalFilename: file.originalname,

            rawPath: rawVideoPath,
            compressedPath: outputPath,
            previewPath,
            thumbnailPath,

            uploader: req.user.id,
            event: tagEvent,
            location: tagLocation,
            tagDate: new Date(tagDate),

            status: 'raw',
            processingStatus: 'queued',
            processingMode: 'transcode',
            processingProgress: 0,

            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrate: bitrateKbps,
            framerate: frameRate,
            ...sourceMetadata,

            sizeOriginal: inputStats ? inputStats.size : null,
            sizeCompressed: null,
            sizePreview: null,
            sizeThumbnail: null,
            duration: sourceMetadata.sourceDuration,

            rawRetentionDays: rawRetentionInfo.rawRetentionDays,
            rawExpiresAt: rawRetentionInfo.rawExpiresAt,
            rawDeleted: false,
            rawDeletedAt: null,

            uploadDate: new Date(),
          });

          await videoDoc.save();
          const enqueueResult = await enqueueOrMarkFailed(videoDoc);
          videosProcessed.push(videoDoc);
          if (enqueueResult.error) {
            queueFailures.push({
              originalFilename: file.originalname,
              error: enqueueResult.error,
            });
          }

          auditDetails.push({
            originalFilename: file.originalname,
            storedFilename: outputFilename,
            previewFilename,
            thumbnailFilename,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
            sourceFormat: sourceMetadata.sourceFormat,
            sourceCodec: sourceMetadata.sourceCodec,
            sourceResolution: sourceMetadata.sourceResolution,
            sourceFramerate: sourceMetadata.sourceFramerate,
            rawRetentionDays: rawRetentionInfo.rawRetentionDays,
            rawExpiresAt: rawRetentionInfo.rawExpiresAt,
            processingJobId: enqueueResult.job?.id?.toString() || null,
            processingError: enqueueResult.error || null,
          });
        }

        await AuditLog.create({
          action: 'Bulk Raw Video Upload & Tagging',
          performedBy: req.user.id,
          details: {
            count: req.files.length,
            tags: {
              event: tagEvent,
              location: tagLocation,
              date: tagDate,
            },
            files: auditDetails,
          },
        });
      } else if (['Editor', 'VideoEditor'].includes(req.user.role)) {
        let rawVideoIds = req.body.rawVideoIds;

        if (rawVideoIds && typeof rawVideoIds === 'string') {
          rawVideoIds = rawVideoIds.split(',').map((s) => s.trim());
        }

        if (rawVideoIds && rawVideoIds.length > 0) {
          if (rawVideoIds.length !== req.files.length) {
            return res.status(400).json({
              message: 'Mismatch between number of files and provided rawVideoIds.',
            });
          }

          for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const rawVideoId = rawVideoIds[i];
            const rawVideo = await Video.findById(rawVideoId);

            if (!rawVideo) {
              return res.status(404).json({
                message: `Raw video not found for id ${rawVideoId}`,
              });
            }

            const rawVideoPath = file.path;
            const outputFilename = createMp4Filename('compressed', file.originalname);
            const outputPath = path.join(paths.compressed, outputFilename);
            const previewFilename = createMp4Filename('preview', file.originalname);
            const previewPath = path.join(paths.previews, previewFilename);
            const thumbnailFilename = createJpgFilename('thumb', file.originalname);
            const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);
            const rawRetentionInfo = buildRawRetentionInfo(rawRetentionDays);

            ensureFolderExists(paths.compressed);
            ensureFolderExists(paths.previews);
            ensureFolderExists(paths.thumbnails);

            const ffmpegCodec = mapCodec(req.body.codec);
            const resolutionValue = mapResolution(req.body.resolution);
            const bitrateKbps = getBitrateKbps(req.body.bitrate);
            const frameRate = getFrameRate(req.body.framerate);

            await writeRawUploadManifest(rawVideoPath, {
              uploadKind: 'edited-from-raw',
              originalFilename: file.originalname,
              uploaderId: req.user.id,
              uploaderUsername: req.user.username,
              uploaderRole: req.user.role,
              event: rawVideo.event,
              location: rawVideo.location,
              tagDate: rawVideo.tagDate,
              rawVideoId,
              status: 'edited',
              processingMode: 'transcode',
            });

            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;
            const sourceMetadata = await inspectSourceMedia(rawVideoPath);

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              originalFilename: file.originalname,

              rawPath: rawVideoPath,
              compressedPath: outputPath,
              previewPath,
              thumbnailPath,

              uploader: req.user.id,
              reporter: rawVideo.reporter || rawVideo.uploader || null,
              editor: req.user.id,
              event: rawVideo.event,
              location: rawVideo.location,
              tagDate: rawVideo.tagDate,

              status: 'edited',
              processingStatus: 'queued',
              processingMode: 'transcode',
              processingProgress: 0,

              codec: ffmpegCodec,
              resolution: resolutionValue,
              bitrate: bitrateKbps,
              framerate: frameRate,
              ...sourceMetadata,

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: null,
              sizePreview: null,
              sizeThumbnail: null,
              duration: sourceMetadata.sourceDuration,

              rawRetentionDays: rawRetentionInfo.rawRetentionDays,
              rawExpiresAt: rawRetentionInfo.rawExpiresAt,
              rawDeleted: false,
              rawDeletedAt: null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            const enqueueResult = await enqueueOrMarkFailed(videoDoc);
            videosProcessed.push(videoDoc);
            if (enqueueResult.error) {
              queueFailures.push({
                originalFilename: file.originalname,
                error: enqueueResult.error,
              });
            }

            auditDetails.push({
              originalFilename: file.originalname,
              rawVideoId,
              storedFilename: outputFilename,
              previewFilename,
              thumbnailFilename,
              sourceFormat: sourceMetadata.sourceFormat,
              sourceCodec: sourceMetadata.sourceCodec,
              sourceResolution: sourceMetadata.sourceResolution,
              sourceFramerate: sourceMetadata.sourceFramerate,
              rawRetentionDays: rawRetentionInfo.rawRetentionDays,
              processingJobId: enqueueResult.job?.id?.toString() || null,
              processingError: enqueueResult.error || null,
            });
          }

          await AuditLog.create({
            action: 'Bulk Edited Video Upload & Tagging',
            performedBy: req.user.id,
            details: {
              count: req.files.length,
              rawVideoIds,
              files: auditDetails,
            },
          });
        } else {
          const tagEvent = req.body.event;
          const tagLocation = req.body.location || '';
          const tagDate = req.body.date;

          if (!tagEvent || !tagDate) {
            return res.status(400).json({
              message: 'Missing required tags: event or date.',
            });
          }

          const finalCategory = req.body.finalCategory || 'video-report';
          const keywords = req.body.keywords
            ? req.body.keywords.split(',').map((s) => s.trim())
            : [];

          const finalFolder = path.join(paths.final, finalCategory);
          ensureFolderExists(finalFolder);
          ensureFolderExists(paths.previews);
          ensureFolderExists(paths.thumbnails);

          for (const file of req.files) {
            const rawVideoPath = file.path;
            const outputFilename = createStoredFilename('final', file.originalname);
            const outputPath = path.join(finalFolder, outputFilename);
            const previewFilename = createMp4Filename('preview', file.originalname);
            const previewPath = path.join(paths.previews, previewFilename);
            const thumbnailFilename = createJpgFilename('thumb', file.originalname);
            const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);

            await writeRawUploadManifest(rawVideoPath, {
              uploadKind: 'final-upload',
              originalFilename: file.originalname,
              uploaderId: req.user.id,
              uploaderUsername: req.user.username,
              uploaderRole: req.user.role,
              event: tagEvent,
              location: tagLocation,
              tagDate,
              finalCategory,
              keywords,
              status: 'edited',
              processingMode: 'finalize',
            });

            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;
            const sourceMetadata = await inspectSourceMedia(rawVideoPath);

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              originalFilename: file.originalname,

              rawPath: rawVideoPath,
              compressedPath: outputPath,
              previewPath,
              thumbnailPath,

              uploader: req.user.id,
              reporter: null,
              editor: req.user.id,
              event: tagEvent,
              location: tagLocation,
              tagDate: new Date(tagDate),

              status: 'edited',
              processingStatus: 'queued',
              processingMode: 'finalize',
              processingProgress: 0,
              qcStatus: 'passed',
              qcNotes: 'Direct editor QA upload.',
              qcCheckedBy: req.user.id,
              qcCheckedAt: new Date(),
              broadcastStatus: 'qc_pending',

              finalCategory,
              finalApprovalStatus: 'approved',
              finalApprovedBy: req.user.id,
              finalApprovedAt: new Date(),
              finalApprovalRole: req.user.role,
              qaResponsible: req.user.id,
              qaResponsibilityType: 'direct_editor',
              keywords,
              ...sourceMetadata,

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: null,
              sizePreview: null,
              sizeThumbnail: null,
              duration: sourceMetadata.sourceDuration,

              rawRetentionDays: 0,
              rawExpiresAt: null,
              rawDeleted: false,
              rawDeletedAt: null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            const enqueueResult = await enqueueOrMarkFailed(videoDoc);
            videosProcessed.push(videoDoc);
            if (enqueueResult.error) {
              queueFailures.push({
                originalFilename: file.originalname,
                error: enqueueResult.error,
              });
            }

            auditDetails.push({
              originalFilename: file.originalname,
              storedFilename: outputFilename,
              previewFilename,
              thumbnailFilename,
              finalCategory,
              sourceFormat: sourceMetadata.sourceFormat,
              sourceCodec: sourceMetadata.sourceCodec,
              sourceResolution: sourceMetadata.sourceResolution,
              sourceFramerate: sourceMetadata.sourceFramerate,
              processingJobId: enqueueResult.job?.id?.toString() || null,
              processingError: enqueueResult.error || null,
            });
          }

          await AuditLog.create({
            action: 'Bulk Final Video Upload & Tagging',
            performedBy: req.user.id,
            details: {
              count: req.files.length,
              tags: {
                event: tagEvent,
                location: tagLocation,
                date: tagDate,
              },
              finalCategory,
              files: auditDetails,
            },
          });
        }
      }

      return res.status(queueFailures.length > 0 ? 207 : 202).json({
        message: queueFailures.length > 0
          ? `Upload saved ${videosProcessed.length} file(s), but ${queueFailures.length} processing job(s) could not be queued. Use Retry Processing after the queue is available.`
          : 'Upload accepted. Video processing has been queued.',
        videos: videosProcessed,
        queueFailures,
      });
    } catch (error) {
      console.error('Upload error:', error);

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: `File is too large. Maximum allowed file size is ${MAX_UPLOAD_SIZE_GB} GB.`,
        });
      }

      return res.status(error.statusCode || 500).json({
        message: error.statusCode ? error.message : 'Server error during file upload.',
        error: error.message,
      });
    }
  }
);

module.exports = router;
