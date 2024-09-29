const express = require('express');
const multer = require('multer');
const Video = require('../models/Video');
const authenticateToken = require('../middleware/auth');
const authorize = require('../middleware/authorize');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const storage = multer.diskStorage({
  destination: 'uploads/raw/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});

const upload = multer({ storage });

// Upload Video Route
router.post(
  '/',
  authenticateToken,
  authorize(['Reporter']),
  upload.single('video'),
  async (req, res) => {
    try {
      const { events, codec, resolution, bitrate } = req.body;
      const framerate = 30; // Fixed framerate

      const rawVideoPath = req.file.path;
      const outputFilename = `compressed_${Date.now()}_${req.file.originalname}`;
      const outputPath = path.join('uploads/compressed/', outputFilename);

      // Create the compressed directory if it doesn't exist
      if (!fs.existsSync('uploads/compressed/')) {
        fs.mkdirSync('uploads/compressed/', { recursive: true });
      }

      // Set FFmpeg codec options
      let ffmpegCodec;
      switch (codec) {
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

      // Set resolution
      let resolutionValue;
      switch (resolution) {
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

      // Convert bitrate from Mbps to Kbps
      const bitrateKbps = parseInt(bitrate) * 1000;

      // Perform video compression using FFmpeg
      ffmpeg(rawVideoPath)
        .videoCodec(ffmpegCodec)
        .size(resolutionValue)
        .videoBitrate(bitrateKbps)
        .fps(framerate)
        .on('end', async () => {
          // Save video info to the database after compression
          const video = new Video({
            filename: outputFilename,
            filepath: outputPath,
            uploader: req.user.id,
            events: events ? events.split(',').map((e) => e.trim()) : [],
            originalFilename: req.file.originalname,
            uploadDate: new Date(),
          });

          await video.save();

          // Delete the original uploaded file
          fs.unlinkSync(rawVideoPath);

          res.status(200).json({ message: 'Upload and compression successful', videoId: video._id });
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          res.status(500).json({ message: 'Error during compression' });
        })
        .save(outputPath);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ message: 'Server error during file upload.' });
    }
  }
);

module.exports = router;
