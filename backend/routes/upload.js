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
  // Check file extension if mimetype is not in allowed list
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
  authorize(['Reporter', 'Editor']),
  upload.array('videos', 50), // Allow up to 50 files per upload
  async (req, res) => {
    try {
      let videosProcessed = [];
      let auditDetails = [];
      
      if (req.user.role === 'Reporter') {
        // For Reporters, require tags from the request body.
        const tagEvent = req.body.event;
        const tagLocation = req.body.location;
        const tagDate = req.body.date; // Expected as a date string
        if (!tagEvent || !tagLocation || !tagDate) {
          return res.status(400).json({ message: 'Missing required tags: event, location, or date.' });
        }
        // Process each uploaded file
        for (const file of req.files) {
          // Use absolute paths for both input and output.
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
                // Check output file size
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
                // Remove the raw file after processing
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
      } else if (req.user.role === 'Editor') {
        // For Editors, expect rawVideoIds to copy tags from raw videos.
        let rawVideoIds = req.body.rawVideoIds;
        if (typeof rawVideoIds === 'string') {
          rawVideoIds = rawVideoIds.split(',').map(s => s.trim());
        }
        if (!rawVideoIds || rawVideoIds.length !== req.files.length) {
          return res.status(400).json({ message: 'Mismatch between number of files and provided rawVideoIds.' });
        }
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
      }
      res.status(200).json({ message: 'Upload, compression, and tagging successful', videos: videosProcessed });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: 'Server error during file upload.' });
    }
  }
);

module.exports = router;
