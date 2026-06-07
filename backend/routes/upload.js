const express = require('express');
const multer = require('multer');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Supported MIME types and file extensions for videos (including MXF)
const allowedMimetypes = [
  'video/mp4',
  'video/quicktime',  // mov
  'video/x-msvideo',  // avi
  'video/x-matroska', // mkv
  'video/webm',
  'video/mxf',
  'application/mxf'
];
const allowedExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.mxf'];

// Multer storage configuration
const storage = multer.diskStorage({
  destination: 'uploads/raw/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

// File filter for supported video formats
const fileFilter = (req, file, cb) => {
  console.log(`File Filter: Received file ${file.originalname} with mimetype ${file.mimetype}`);
  if (allowedMimetypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    return cb(null, true);
  }
  cb(new Error('Unsupported file type: ' + file.mimetype + ' or extension ' + ext), false);
};

const upload = multer({ storage, fileFilter });

// Upload Video Route - supports multiple files
router.post(
  '/',
  authenticateToken,
  authorize(['Reporter', 'Editor', 'Admin']),
  upload.array('videos', 50),
  async (req, res) => {
    try {
      let videosProcessed = [];
      let auditDetails = [];
      
      // Reporter and Admin branch: These users must supply tags.
      if (req.user.role === 'Reporter' || req.user.role === 'Admin') {
        const tagEvent = req.body.event;
        const tagLocation = req.body.location;
        const tagDate = req.body.date;
        if (!tagEvent || !tagLocation || !tagDate) {
          return res.status(400).json({ message: 'Missing required tags: event, location, or date.' });
        }
        for (const file of req.files) {
          const rawVideoPath = path.join(process.cwd(), file.path);
          const outputFilename = `compressed_${Date.now()}_${file.originalname}`;
          const outputDir = path.join(process.cwd(), 'uploads', 'compressed');
          const outputPath = path.join(outputDir, outputFilename);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }
          // Determine dynamic FFmpeg parameters:
          let ffmpegCodec;
          switch(req.body.codec) {
            case 'h264':
              ffmpegCodec = 'libx264';
              break;
            case 'h265':
              ffmpegCodec = 'libx265';
              break;
            case 'h264_nvenc':
              ffmpegCodec = 'h264_nvenc';
              break;
            case 'h265_nvenc':
              ffmpegCodec = 'hevc_nvenc';
              break;
            default:
              ffmpegCodec = 'libx264';
          }
          console.log("Using codec:", ffmpegCodec);
          let resolutionValue;
          switch(req.body.resolution) {
            case '720':
              resolutionValue = '1280x720';
              break;
            case '1080':
              resolutionValue = '1920x1080';
              break;
            case '1440':
              resolutionValue = '2560x1440';
              break;
            case '2160':
              resolutionValue = '3840x2160';
              break;
            default:
              resolutionValue = '1920x1080';
          }
          const bitrateKbps = parseInt(req.body.bitrate) * 1000 || 1500;
          const frameRate = parseInt(req.body.framerate) || 30;
          await new Promise((resolve, reject) => {
            console.log(`Starting ffmpeg conversion for ${file.originalname}`);
            ffmpeg(rawVideoPath)
              .videoCodec(ffmpegCodec)
              .size(resolutionValue)
              .videoBitrate(bitrateKbps)
              .fps(frameRate)
              .on('start', (cmd) => {
                console.log('FFmpeg started with command:', cmd);
              })
              .on('end', async () => {
                console.log(`FFmpeg finished conversion for ${file.originalname}`);
                try {
                  const stats = fs.statSync(outputPath);
                  console.log(`Output file size for ${file.originalname}: ${stats.size} bytes`);
                } catch (err) {
                  console.error(`Error checking file size for ${file.originalname}:`, err);
                }
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
                fs.unlinkSync(rawVideoPath);
                resolve();
              })
              .on('error', (err) => {
                console.error('FFmpeg error for file', file.originalname, err);
                reject(err);
              })
              .save(outputPath);
          });
          auditDetails.push({ originalFilename: file.originalname });
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
      // Editor branch (only "Editor" role now)
      else if (req.user.role === 'Editor') {
        // Attempt to retrieve rawVideoIds, if provided.
        let rawVideoIds = req.body.rawVideoIds;
        if (rawVideoIds && typeof rawVideoIds === 'string') {
          rawVideoIds = rawVideoIds.split(',').map(s => s.trim());
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
            const rawVideoPath = path.join(process.cwd(), file.path);
            const outputFilename = `compressed_${Date.now()}_${file.originalname}`;
            const outputDir = path.join(process.cwd(), 'uploads', 'compressed');
            const outputPath = path.join(outputDir, outputFilename);
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }
            await new Promise((resolve, reject) => {
              console.log(`Starting ffmpeg conversion for ${file.originalname}`);
              ffmpeg(rawVideoPath)
                .videoCodec('libx264')
                .size('1920x1080')
                .videoBitrate(parseInt(req.body.bitrate) * 1000 || 1500)
                .fps(30)
                .on('start', (cmd) => {
                  console.log('FFmpeg started with command:', cmd);
                })
                .on('end', async () => {
                  console.log(`FFmpeg finished conversion for ${file.originalname}`);
                  try {
                    const stats = fs.statSync(outputPath);
                    console.log(`Output file size for ${file.originalname}: ${stats.size} bytes`);
                  } catch (err) {
                    console.error(`Error checking file size for ${file.originalname}:`, err);
                  }
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
                  fs.unlinkSync(rawVideoPath);
                  resolve();
                })
                .on('error', (err) => {
                  console.error('FFmpeg error for file', file.originalname, err);
                  reject(err);
                })
                .save(outputPath);
            });
            auditDetails.push({ originalFilename: file.originalname, rawVideoId });
          }
          await AuditLog.create({
            action: 'Bulk Edited Video Upload & Tagging',
            performedBy: req.user.id,
            details: { count: req.files.length, rawVideoIds: rawVideoIds, files: auditDetails },
          });
        } else {
          // Final upload branch: rawVideoIds nije prazno
          const tagEvent = req.body.event;
          const tagLocation = req.body.location;
          const tagDate = req.body.date;
          if (!tagEvent || !tagLocation || !tagDate) {
            return res.status(400).json({ message: 'Missing required tags: event, location, or date.' });
          }
          const finalCategory = req.body.finalCategory || 'video report';
          const keywords = req.body.keywords ? req.body.keywords.split(',').map(s => s.trim()) : [];
          
          for (const file of req.files) {
            const rawVideoPath = path.join(process.cwd(), file.path);
            const outputFilename = `final_${Date.now()}_${file.originalname}`;
            const baseFinalFolder = path.join(process.cwd(), 'uploads', 'final');
            const finalFolder = path.join(baseFinalFolder, finalCategory);
            const outputPath = path.join(finalFolder, outputFilename);
            if (!fs.existsSync(finalFolder)) {
              fs.mkdirSync(finalFolder, { recursive: true });
            }
            fs.renameSync(rawVideoPath, outputPath);
            const videoDoc = new Video({
              filename: outputFilename,
              filepath: outputPath,
              uploader: req.user.id,
              event: tagEvent,
              location: tagLocation,
              tagDate: new Date(tagDate),
              status: 'edited',
              finalCategory: finalCategory,
              keywords: keywords,
              originalFilename: file.originalname,
              uploadDate: new Date(),
            });
            await videoDoc.save();
            videosProcessed.push(videoDoc);
          }
          await AuditLog.create({
            action: 'Bulk Final Video Upload & Tagging',
            performedBy: req.user.id,
            details: {
              count: req.files.length,
              tags: { event: req.body.event, location: req.body.location, date: req.body.date },
              finalCategory: finalCategory,
            },
          });
        }
      }
      res.status(200).json({ message: 'Upload, compression, and tagging successful', videos: videosProcessed });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: 'Server error during file upload.' });
    }
  }
);

module.exports = router;
