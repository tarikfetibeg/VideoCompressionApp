const express = require('express');
const Video = require('../models/Video');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Get All Videos
router.get(
  '/',
  authenticateToken,
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter']),
  async (req, res) => {
    const { event } = req.query;
    const filter = event ? { events: event } : {};
    const videos = await Video.find(filter).populate('uploader', 'username');
    res.json(videos);
  }
);

// Get Video Stream (for playback)
router.get('/stream/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  // Optional: Check user roles if needed
  if (!['Reporter', 'Editor', 'VideoEditor', 'Producer'].includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    // Proceed with streaming logic
    const video = await Video.findById(videoId);

    if (!video) return res.status(404).json({ message: 'Video not found' });

    const videoPath = path.resolve(video.filepath);

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ message: 'Video file not found on server' });
    }

    const stat = fs.statSync(videoPath);
    const total = stat.size;
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(videoPath).pipe(res);
    } else {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;

      const file = fs.createReadStream(videoPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      file.pipe(res);
    }
  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Add a timecode to a video
router.post(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(['Editor', 'Producer', 'Reporter']),
  async (req, res) => {
    const { videoId } = req.params;
    const { description, timestamp } = req.body;

    try {
      const video = await Video.findById(videoId);
      video.timecodes.push({ description, timestamp });
      await video.save();
      res.status(200).json({ message: 'Timecode added successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add timecode' });
    }
  }
);

// Download Video
router.get(
  '/download/:videoId',
  authenticateToken,
  authorize(['Reporter', 'Editor', 'VideoEditor', 'Producer']),
  async (req, res) => {
    const { videoId } = req.params;
    const video = await Video.findById(videoId);

    if (!video) return res.status(404).json({ message: 'Video not found' });

    const videoPath = path.resolve(video.filepath);

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ message: 'Video file not found on server' });
    }

    // Send the video file as attachment
    res.download(videoPath, video.originalFilename, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ message: 'Error downloading video' });
      }
    });
  }
);


// Get timecodes for a video
router.get(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter']),
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const video = await Video.findById(videoId).select('timecodes');
      res.status(200).json(video.timecodes);
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve timecodes' });
    }
  }
);

// Bulk Download
router.post(
  '/download',
  authenticateToken,
  authorize(['Reporter', 'Editor', 'VideoEditor', 'Producer']),
  async (req, res) => {
    const { videoIds } = req.body;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ message: 'No videos selected' });
    }

    const archiver = require('archiver');
    const zip = archiver('zip');
    const timestamp = Date.now();
    const zipFilename = `videos_${timestamp}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${zipFilename}`);

    zip.pipe(res);

    for (const videoId of videoIds) {
      const video = await Video.findById(videoId);
      if (video && fs.existsSync(video.filepath)) {
        zip.file(video.filepath, { name: video.originalFilename || video.filename });
      }
    }

    zip.finalize();
  }
);


module.exports = router;