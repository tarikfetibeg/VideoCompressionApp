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
  console.log(
    `File Filter: Received file ${file.originalname} with mimetype ${file.mimetype}`
  );

  if (allowedMimetypes.includes(file.mimetype)) {
    return cb(null, true);
  }

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExtensions.includes(ext)) {
    return cb(null, true);
  }

  return cb(
    new Error(`Unsupported file type: ${file.mimetype} or extension ${ext}`),
    false
  );
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

function convertVideo({
  inputPath,
  outputPath,
  codec,
  resolution,
  bitrateKbps,
  frameRate,
}) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec(codec)
      .size(resolution)
      .videoBitrate(bitrateKbps)
      .fps(frameRate)
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
          const outputFilename = createStoredFilename(
            'compressed',
            file.originalname
          );
          const outputPath = path.join(paths.compressed, outputFilename);

          const ffmpegCodec = mapCodec(req.body.codec);
          const resolutionValue = mapResolution(req.body.resolution);
          const bitrateKbps = getBitrateKbps(req.body.bitrate);
          const frameRate = getFrameRate(req.body.framerate);

          console.log(`Starting FFmpeg conversion for ${file.originalname}`);
          console.log('Using codec:', ffmpegCodec);
          console.log('Using resolution:', resolutionValue);
          console.log('Using bitrate:', bitrateKbps);
          console.log('Using framerate:', frameRate);

          await convertVideo({
            inputPath: rawVideoPath,
            outputPath,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
          });

          const outputStats = fs.existsSync(outputPath)
            ? fs.statSync(outputPath)
            : null;

          const videoDoc = new Video({
            filename: outputFilename,
            filepath: outputPath,
            uploader: req.user.id,
            event: tagEvent,
            location: tagLocation,
            tagDate: new Date(tagDate),
            status: 'raw',
            originalFilename: file.originalname,
            uploadDate: new Date(),
          });

          await videoDoc.save();
          videosProcessed.push(videoDoc);

          auditDetails.push({
            originalFilename: file.originalname,
            storedFilename: outputFilename,
            codec: ffmpegCodec,
            resolution: resolutionValue,
            bitrateKbps,
            frameRate,
            outputSize: outputStats ? outputStats.size : null,
          });

          // Current behavior: delete raw file after successful conversion.
          // Later, we can change this if you want to preserve originals.
          removeFileIfExists(rawVideoPath);
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
              message:
                'Mismatch between number of files and provided rawVideoIds.',
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
            const outputFilename = createStoredFilename(
              'compressed',
              file.originalname
            );
            const outputPath = path.join(paths.compressed, outputFilename);

            const ffmpegCodec = mapCodec(req.body.codec);
            const resolutionValue = mapResolution(req.body.resolution);
            const bitrateKbps = getBitrateKbps(req.body.bitrate);
            const frameRate = getFrameRate(req.body.framerate);

            console.log(`Starting FFmpeg conversion for ${file.originalname}`);

            await convertVideo({
              inputPath: rawVideoPath,
              outputPath,
              codec: ffmpegCodec,
              resolution: resolutionValue,
              bitrateKbps,
              frameRate,
            });

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              uploader: req.user.id,
              event: rawVideo.event,
              location: rawVideo.location,
              tagDate: rawVideo.tagDate,
              status: 'edited',
              originalFilename: file.originalname,
              uploadDate: new Date(),
            });

            await videoDoc.save();
            videosProcessed.push(videoDoc);
            removeFileIfExists(rawVideoPath);

            auditDetails.push({
              originalFilename: file.originalname,
              rawVideoId,
              storedFilename: outputFilename,
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

          if (!fs.existsSync(finalFolder)) {
            fs.mkdirSync(finalFolder, { recursive: true });
          }

          for (const file of req.files) {
            const rawVideoPath = file.path;
            const outputFilename = createStoredFilename(
              'final',
              file.originalname
            );
            const outputPath = path.join(finalFolder, outputFilename);

            fs.renameSync(rawVideoPath, outputPath);

            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              uploader: req.user.id,
              event: tagEvent,
              location: tagLocation,
              tagDate: new Date(tagDate),
              status: 'edited',
              finalCategory,
              keywords,
              originalFilename: file.originalname,
              uploadDate: new Date(),
            });

            await videoDoc.save();
            videosProcessed.push(videoDoc);

            auditDetails.push({
              originalFilename: file.originalname,
              storedFilename: outputFilename,
              finalCategory,
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

      return res.status(200).json({
        message: 'Upload, compression, and tagging successful',
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