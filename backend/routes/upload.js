const express = require('express');
const multer = require('multer');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { paths, createStoredFilename } = require('../utils/storagePaths');

const router = express.Router();

const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

// Supported MIME types and file extensions for videos, including MXF.
const allowedMimetypes = [
  'video/mp4',
  'video/quicktime', // mov
  'video/x-msvideo', // avi
  'video/x-matroska', // mkv
  'video/webm',
  'video/mxf',
  'application/mxf',
];

const allowedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf'];

// Multer storage configuration. Raw uploads are stored temporarily in storage/raw.
const storage = multer.diskStorage({
  destination: paths.raw,
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('raw', file.originalname));
  },
});

// File filter for supported video formats.
const fileFilter = (req, file, cb) => {
  console.log(`File Filter: Received file ${file.originalname} with mimetype ${file.mimetype}`);

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

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function ensureFolderExists(folderPath) {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}

function createMp4PreviewFilename(originalName) {
  const parsed = path.parse(originalName);
  const safeBaseName = parsed.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `preview_${Date.now()}_${safeBaseName}.mp4`;
}

function convertVideo({
  inputPath,
  outputPath,
  codec,
  resolution,
  bitrateKbps,
  frameRate,
}) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(inputPath)
      .videoCodec(codec)
      .audioCodec('aac')
      .size(resolution)
      .videoBitrate(bitrateKbps)
      .audioBitrate('128k')
      .fps(frameRate)
      .outputOptions([
        '-pix_fmt yuv420p',
        '-movflags +faststart',
      ]);

    command
      .on('start', (cmd) => {
        console.log('FFmpeg started with command:', cmd);
      })
      .on('end', () => {
        console.log(`FFmpeg finished conversion: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

function convertPreviewVideo({ inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size('1280x720')
      .videoBitrate(2000)
      .audioBitrate('128k')
      .fps(30)
      .outputOptions([
        '-pix_fmt yuv420p',
        '-movflags +faststart',
        '-preset veryfast',
      ])
      .on('start', (cmd) => {
        console.log('FFmpeg preview started with command:', cmd);
      })
      .on('end', () => {
        console.log(`FFmpeg preview finished: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error('FFmpeg preview error:', err);
        reject(err);
      })
      .save(outputPath);
  });
}

// Upload Video Route - supports multiple files.
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

      // Reporter and Admin branch: These users must supply tags.
      if (req.user.role === 'Reporter' || req.user.role === 'Admin') {
        const tagEvent = req.body.event;
        const tagLocation = req.body.location;
        const tagDate = req.body.date;

        if (!tagEvent || !tagLocation || !tagDate) {
          return res.status(400).json({ message: 'Missing required tags: event, location, or date.' });
        }

        for (const file of req.files) {
          const rawVideoPath = file.path;
          const outputFilename = createStoredFilename('compressed', file.originalname);
          const outputPath = path.join(paths.compressed, outputFilename);
          const previewFilename = createMp4PreviewFilename(file.originalname);
          const previewPath = path.join(paths.previews, previewFilename);

          ensureFolderExists(paths.compressed);
          ensureFolderExists(paths.previews);

          const ffmpegCodec = mapCodec(req.body.codec);
          const resolutionValue = mapResolution(req.body.resolution);
          const bitrateKbps = getBitrateKbps(req.body.bitrate);
          const frameRate = getFrameRate(req.body.framerate);

          console.log(`Starting FFmpeg conversion for ${file.originalname}`);
          console.log('Using codec:', ffmpegCodec);
          console.log('Using resolution:', resolutionValue);
          console.log('Using bitrate:', bitrateKbps);
          console.log('Using framerate:', frameRate);

          const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

          await convertVideo({
            inputPath: rawVideoPath,
            outputPath,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
          });

          await convertPreviewVideo({
            inputPath: rawVideoPath,
            outputPath: previewPath,
          });

          const outputStats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
          const previewStats = fs.existsSync(previewPath) ? fs.statSync(previewPath) : null;

          const videoDoc = new Video({
            filename: outputFilename,
            filepath: outputPath,
            originalFilename: file.originalname,

            rawPath: rawVideoPath,
            compressedPath: outputPath,
            previewPath,

            uploader: req.user.id,
            event: tagEvent,
            location: tagLocation,
            tagDate: new Date(tagDate),

            status: 'raw',
            processingStatus: 'completed',

            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrate: bitrateKbps,
            framerate: frameRate,

            sizeOriginal: inputStats ? inputStats.size : null,
            sizeCompressed: outputStats ? outputStats.size : null,

            uploadDate: new Date(),
          });

          await videoDoc.save();
          videosProcessed.push(videoDoc);

          auditDetails.push({
            originalFilename: file.originalname,
            storedFilename: outputFilename,
            previewFilename,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
            outputSize: outputStats ? outputStats.size : null,
            previewSize: previewStats ? previewStats.size : null,
          });

          // Current behavior: delete raw file after successful conversion and preview generation.
          removeFileIfExists(rawVideoPath);
        }

        await AuditLog.create({
          action: 'Bulk Raw Video Upload & Tagging',
          performedBy: req.user.id,
          details: {
            count: req.files.length,
            tags: { event: tagEvent, location: tagLocation, date: tagDate },
            files: auditDetails,
          },
        });
      }

      // Editor branch.
      else if (req.user.role === 'Editor') {
        let rawVideoIds = req.body.rawVideoIds;

        if (rawVideoIds && typeof rawVideoIds === 'string') {
          rawVideoIds = rawVideoIds.split(',').map((s) => s.trim());
        }

        if (rawVideoIds && rawVideoIds.length > 0) {
          if (rawVideoIds.length !== req.files.length) {
            return res.status(400).json({ message: 'Mismatch between number of files and provided rawVideoIds.' });
          }

          // Conversion branch: Use tags from raw videos.
          for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const rawVideoId = rawVideoIds[i];
            const rawVideo = await Video.findById(rawVideoId);

            if (!rawVideo) {
              return res.status(404).json({ message: `Raw video not found for id ${rawVideoId}` });
            }

            const rawVideoPath = file.path;
            const outputFilename = createStoredFilename('compressed', file.originalname);
            const outputPath = path.join(paths.compressed, outputFilename);
            const previewFilename = createMp4PreviewFilename(file.originalname);
            const previewPath = path.join(paths.previews, previewFilename);

            ensureFolderExists(paths.compressed);
            ensureFolderExists(paths.previews);

            const ffmpegCodec = mapCodec(req.body.codec);
            const resolutionValue = mapResolution(req.body.resolution);
            const bitrateKbps = getBitrateKbps(req.body.bitrate);
            const frameRate = getFrameRate(req.body.framerate);
            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

            console.log(`Starting FFmpeg conversion for ${file.originalname}`);

            await convertVideo({
              inputPath: rawVideoPath,
              outputPath,
              codec: ffmpegCodec,
              resolution: resolutionValue,
              bitrateKbps,
              frameRate,
            });

            await convertPreviewVideo({
              inputPath: rawVideoPath,
              outputPath: previewPath,
            });

            const outputStats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
            const previewStats = fs.existsSync(previewPath) ? fs.statSync(previewPath) : null;

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              originalFilename: file.originalname,

              rawPath: rawVideoPath,
              compressedPath: outputPath,
              previewPath,

              uploader: req.user.id,
              event: rawVideo.event,
              location: rawVideo.location,
              tagDate: rawVideo.tagDate,

              status: 'edited',
              processingStatus: 'completed',

              codec: ffmpegCodec,
              resolution: resolutionValue,
              bitrate: bitrateKbps,
              framerate: frameRate,

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: outputStats ? outputStats.size : null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            videosProcessed.push(videoDoc);
            removeFileIfExists(rawVideoPath);

            auditDetails.push({
              originalFilename: file.originalname,
              rawVideoId,
              storedFilename: outputFilename,
              previewFilename,
              outputSize: outputStats ? outputStats.size : null,
              previewSize: previewStats ? previewStats.size : null,
            });
          }

          await AuditLog.create({
            action: 'Bulk Edited Video Upload & Tagging',
            performedBy: req.user.id,
            details: { count: req.files.length, rawVideoIds, files: auditDetails },
          });
        } else {
          // Final upload branch: rawVideoIds not provided or empty.
          const tagEvent = req.body.event;
          const tagLocation = req.body.location;
          const tagDate = req.body.date;

          if (!tagEvent || !tagLocation || !tagDate) {
            return res.status(400).json({ message: 'Missing required tags: event, location, or date.' });
          }

          const finalCategory = req.body.finalCategory || 'video-report';
          const keywords = req.body.keywords ? req.body.keywords.split(',').map((s) => s.trim()) : [];
          const finalFolder = path.join(paths.final, finalCategory);

          ensureFolderExists(finalFolder);
          ensureFolderExists(paths.previews);

          for (const file of req.files) {
            const rawVideoPath = file.path;
            const outputFilename = createStoredFilename('final', file.originalname);
            const outputPath = path.join(finalFolder, outputFilename);
            const previewFilename = createMp4PreviewFilename(file.originalname);
            const previewPath = path.join(paths.previews, previewFilename);
            const inputStats = fs.existsSync(rawVideoPath) ? fs.statSync(rawVideoPath) : null;

            await convertPreviewVideo({
              inputPath: rawVideoPath,
              outputPath: previewPath,
            });

            fs.renameSync(rawVideoPath, outputPath);

            const outputStats = fs.existsSync(outputPath) ? fs.statSync(outputPath) : null;
            const previewStats = fs.existsSync(previewPath) ? fs.statSync(previewPath) : null;

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              originalFilename: file.originalname,

              rawPath: outputPath,
              compressedPath: outputPath,
              previewPath,

              uploader: req.user.id,
              event: tagEvent,
              location: tagLocation,
              tagDate: new Date(tagDate),

              status: 'edited',
              processingStatus: 'completed',

              finalCategory,
              keywords,

              sizeOriginal: inputStats ? inputStats.size : null,
              sizeCompressed: outputStats ? outputStats.size : null,

              uploadDate: new Date(),
            });

            await videoDoc.save();
            videosProcessed.push(videoDoc);

            auditDetails.push({
              originalFilename: file.originalname,
              storedFilename: outputFilename,
              previewFilename,
              finalCategory,
              outputSize: outputStats ? outputStats.size : null,
              previewSize: previewStats ? previewStats.size : null,
            });
          }

          await AuditLog.create({
            action: 'Bulk Final Video Upload & Tagging',
            performedBy: req.user.id,
            details: {
              count: req.files.length,
              tags: { event: tagEvent, location: tagLocation, date: tagDate },
              finalCategory,
              files: auditDetails,
            },
          });
        }
      }

      return res.status(200).json({
        message: 'Upload, compression, preview generation, and tagging successful',
        videos: videosProcessed,
      });
    } catch (error) {
      console.error('Upload error:', error);

      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'File is too large. Maximum allowed file size is 5 GB.' });
      }

      return res.status(500).json({
        message: 'Server error during file upload.',
        error: error.message,
      });
    }
  }
);

module.exports = router;