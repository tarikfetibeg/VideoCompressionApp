const express = require('express');
const multer = require('multer');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const FfmpegSettings = require('../models/FfmpegSettings');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const path = require('path');
const fs = require('fs');
const {
  paths,
  ensureFolderExists,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
} = require('../utils/storagePaths');
const { enqueueVideoProcessing } = require('../queues/videoQueue');

const router = express.Router();

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

const allowedMimetypes = [
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
  'video/webm',
  'video/mxf',
  'application/mxf',
];

const allowedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf'];

const storage = multer.diskStorage({
  destination: paths.raw,
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('raw', file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  if (allowedMimetypes.includes(file.mimetype)) {
    return cb(null, true);
  }

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    return cb(null, true);
  }

  return cb(new Error(`Unsupported file type: ${file.mimetype} or extension ${ext}`), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 50,
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

async function enqueueOrMarkFailed(videoDoc) {
  try {
    const job = await enqueueVideoProcessing(videoDoc._id);
    videoDoc.processingJobId = job.id.toString();
    return job;
  } catch (error) {
    videoDoc.processingStatus = 'failed';
    videoDoc.processingError = `Failed to queue video processing: ${error.message}`;
    videoDoc.processingCompletedAt = new Date();
    await videoDoc.save();
    throw error;
  }
}

router.post(
  '/',
  authenticateToken,
  authorize(['Reporter', 'Editor', 'Admin']),
  upload.array('videos', 50),
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded.' });
      }

      const videosProcessed = [];
      const auditDetails = [];
      const rawRetentionDays = await getRawRetentionDays();

      if (req.user.role === 'Reporter' || req.user.role === 'Admin') {
        const tagEvent = req.body.event;
        const tagLocation = req.body.location;
        const tagDate = req.body.date;

        if (!tagEvent || !tagLocation || !tagDate) {
          return res.status(400).json({
            message: 'Missing required tags: event, location, or date.',
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

          const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

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

            sizeOriginal: inputStats ? inputStats.size : null,
            sizeCompressed: null,
            sizePreview: null,
            sizeThumbnail: null,

            rawRetentionDays: rawRetentionInfo.rawRetentionDays,
            rawExpiresAt: rawRetentionInfo.rawExpiresAt,
            rawDeleted: false,
            rawDeletedAt: null,

            uploadDate: new Date(),
          });

          await videoDoc.save();
          const job = await enqueueOrMarkFailed(videoDoc);
          videosProcessed.push(videoDoc);

          auditDetails.push({
            originalFilename: file.originalname,
            storedFilename: outputFilename,
            previewFilename,
            thumbnailFilename,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
            rawRetentionDays: rawRetentionInfo.rawRetentionDays,
            rawExpiresAt: rawRetentionInfo.rawExpiresAt,
            processingJobId: job.id.toString(),
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
      } else if (req.user.role === 'Editor') {
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
            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              originalFilename: file.originalname,

              rawPath: rawVideoPath,
              compressedPath: outputPath,
              previewPath,
              thumbnailPath,

              uploader: req.user.id,
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

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: null,
              sizePreview: null,
              sizeThumbnail: null,

              rawRetentionDays: rawRetentionInfo.rawRetentionDays,
              rawExpiresAt: rawRetentionInfo.rawExpiresAt,
              rawDeleted: false,
              rawDeletedAt: null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            const job = await enqueueOrMarkFailed(videoDoc);
            videosProcessed.push(videoDoc);

            auditDetails.push({
              originalFilename: file.originalname,
              rawVideoId,
              storedFilename: outputFilename,
              previewFilename,
              thumbnailFilename,
              rawRetentionDays: rawRetentionInfo.rawRetentionDays,
              processingJobId: job.id.toString(),
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
          const tagLocation = req.body.location;
          const tagDate = req.body.date;

          if (!tagEvent || !tagLocation || !tagDate) {
            return res.status(400).json({
              message: 'Missing required tags: event, location, or date.',
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

            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

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

              status: 'edited',
              processingStatus: 'queued',
              processingMode: 'finalize',
              processingProgress: 0,

              finalCategory,
              keywords,

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: null,
              sizePreview: null,
              sizeThumbnail: null,

              rawRetentionDays: 0,
              rawExpiresAt: null,
              rawDeleted: false,
              rawDeletedAt: null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            const job = await enqueueOrMarkFailed(videoDoc);
            videosProcessed.push(videoDoc);

            auditDetails.push({
              originalFilename: file.originalname,
              storedFilename: outputFilename,
              previewFilename,
              thumbnailFilename,
              finalCategory,
              processingJobId: job.id.toString(),
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

      return res.status(202).json({
        message: 'Upload accepted. Video processing has been queued.',
        videos: videosProcessed,
      });
    } catch (error) {
      console.error('Upload error:', error);

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          message: 'File is too large. Maximum allowed file size is 5 GB.',
        });
      }

      return res.status(500).json({
        message: 'Server error during file upload.',
        error: error.message,
      });
    }
  }
);

module.exports = router;
