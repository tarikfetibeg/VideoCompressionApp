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
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter', 'Admin']),
  async (req, res) => {
    const { event } = req.query;
    let filter = {};
    if (event) {
      filter.event = event;
    }
    // Only filter by uploader for Reporters
    if (req.user.role === 'Reporter') {
      filter.uploader = req.user.id;
    }
    try {
      const videos = await Video.find(filter).populate('uploader', 'username');
      res.json(videos);
    } catch (err) {
      res.status(500).json({ message: 'Error retrieving videos' });
    }
  }
);

router.delete('/:videoId', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });
    // Allow deletion if the requester is Admin OR the owner of the video
    if (req.user.role !== 'Admin' && video.uploader.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Access Forbidden: You can only delete your own videos.' });
    }
    if (fs.existsSync(video.filepath)) {
      fs.unlinkSync(video.filepath);
    }
    await Video.findByIdAndDelete(req.params.videoId);
    await AuditLog.create({
      action: 'Delete Video',
      performedBy: req.user.id,
      details: { videoId: req.params.videoId, filename: video.filename }
    });
    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ message: 'Error deleting video' });
  }
});

// Get Video Stream (for playback)
router.get('/stream/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  // Optional: Check user roles if needed
  if (!['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin'].includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    const videoPath = path.resolve(video.filepath);
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
  authorize(['Editor', 'Producer', 'Reporter', 'Admin']),
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
  authorize(['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']),
  async (req, res) => {
    const { videoId } = req.params;
    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });
      const videoPath = path.resolve(video.filepath);
      if (!fs.existsSync(videoPath)) {
        return res.status(404).json({ message: 'Video file not found on server' });
      }
      res.download(videoPath, video.originalFilename, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).json({ message: 'Error downloading video' });
        }
      });
    } catch (err) {
      res.status(500).json({ message: 'Error downloading video' });
    }
  }
);

// Get timecodes for a video
router.get(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter', 'Admin']),
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
  authorize(['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']),
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

// NEW ROUTE: Get Single Video Details
router.get(
  '/details/:videoId',
  authenticateToken,
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter', 'Admin']),
  async (req, res) => {
    try {
      const video = await Video.findById(req.params.videoId).populate('uploader', 'username');
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }
      res.json(video);
    } catch (err) {
      console.error('Error fetching video details:', err);
      res.status(500).json({ message: 'Error retrieving video details' });
    }
  }
);

// NEW ROUTE: Get Single Video Details with extended debug logging
router.get(
  '/details/:videoId',
  authenticateToken,
  authorize(['Editor', 'Producer', 'VideoEditor', 'Reporter', 'Admin']),
  async (req, res) => {
    console.log("DEBUG: In GET /details/:videoId route, req.user:", req.user);
    try {
      const video = await Video.findById(req.params.videoId).populate('uploader', 'username');
      if (!video) {
        console.log("DEBUG: Video not found for ID:", req.params.videoId);
        return res.status(404).json({ message: 'Video not found' });
      }
      console.log("DEBUG: Retrieved video details:", video);
      res.json(video);
    } catch (err) {
      console.error('Error fetching video details:', err);
      res.status(500).json({ message: 'Error retrieving video details' });
    }
  }
);


module.exports = router;
