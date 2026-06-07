const express = require('express');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const path = require('path');
const fs = require('fs');

const router = express.Router();

const allowedVideoRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin'];

function getUploaderId(video) {
  if (!video || !video.uploader) return null;

  if (video.uploader._id) {
    return video.uploader._id.toString();
  }

  return video.uploader.toString();
}

function userCanAccessVideo(user, video) {
  if (!user || !video) return false;
  if (user.role === 'Admin') return true;

  if (user.role === 'Reporter') {
    return getUploaderId(video) === user.id;
  }

  return ['Editor', 'VideoEditor', 'Producer'].includes(user.role);
}

function resolveExistingPath(...candidatePaths) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue;

    const resolvedPath = path.resolve(candidatePath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function deleteFileIfExists(filePath) {
  if (!filePath) return;

  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

function sendVideoFile(req, res, videoPath, contentType = 'video/mp4') {
  const stat = fs.statSync(videoPath);
  const total = stat.size;
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });

    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= total || end >= total) {
    res.writeHead(416, {
      'Content-Range': `bytes */${total}`,
    });
    res.end();
    return;
  }

  const chunkSize = end - start + 1;
  const file = fs.createReadStream(videoPath, { start, end });

  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunkSize,
    'Content-Type': contentType,
  });

  file.pipe(res);
}

router.get(
  '/',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    const { event } = req.query;
    const filter = {};

    if (event) {
      filter.event = event;
    }

    if (req.user.role === 'Reporter') {
      filter.uploader = req.user.id;
    }

    try {
      const videos = await Video.find(filter).populate('uploader', 'username');
      res.json(videos);
    } catch (err) {
      console.error('Error retrieving videos:', err);
      res.status(500).json({ message: 'Error retrieving videos' });
    }
  }
);

router.delete('/:videoId', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (req.user.role !== 'Admin' && getUploaderId(video) !== req.user.id) {
      return res.status(403).json({ message: 'Access Forbidden: You can only delete your own videos.' });
    }

    const pathsToDelete = Array.from(new Set([
      video.filepath,
      video.compressedPath,
      video.previewPath,
      video.thumbnailPath,
      video.rawPath,
    ].filter(Boolean)));

    pathsToDelete.forEach(deleteFileIfExists);

    await Video.findByIdAndDelete(req.params.videoId);

    await AuditLog.create({
      action: 'Delete Video',
      performedBy: req.user.id,
      details: { videoId: req.params.videoId, filename: video.filename },
    });

    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ message: 'Error deleting video' });
  }
});

router.get('/preview/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedVideoRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanAccessVideo(user, video)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const previewPath = resolveExistingPath(video.previewPath, video.compressedPath, video.filepath);

    if (!previewPath) {
      return res.status(404).json({ message: 'Preview file not found on server' });
    }

    return sendVideoFile(req, res, previewPath, 'video/mp4');
  } catch (error) {
    console.error('Error streaming preview:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/thumbnail/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedVideoRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanAccessVideo(user, video)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const thumbnailPath = resolveExistingPath(video.thumbnailPath);

    if (!thumbnailPath) {
      return res.status(404).json({ message: 'Thumbnail file not found on server' });
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    });

    fs.createReadStream(thumbnailPath).pipe(res);
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/stream/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedVideoRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanAccessVideo(user, video)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const videoPath = resolveExistingPath(video.compressedPath, video.filepath);

    if (!videoPath) {
      return res.status(404).json({ message: 'Video file not found on server' });
    }

    return sendVideoFile(req, res, videoPath, 'video/mp4');
  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(['Editor', 'Producer', 'Reporter', 'Admin']),
  async (req, res) => {
    const { videoId } = req.params;
    const { description, timestamp } = req.body;

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanAccessVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      video.timecodes.push({ description, timestamp });
      await video.save();

      res.status(200).json({ message: 'Timecode added successfully' });
    } catch (error) {
      console.error('Failed to add timecode:', error);
      res.status(500).json({ error: 'Failed to add timecode' });
    }
  }
);

router.get(
  '/download/:videoId',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanAccessVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      const videoPath = resolveExistingPath(video.compressedPath, video.filepath);

      if (!videoPath) {
        return res.status(404).json({ message: 'Video file not found on server' });
      }

      res.download(videoPath, video.originalFilename || video.filename, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Error downloading video' });
          }
        }
      });
    } catch (err) {
      console.error('Error downloading video:', err);
      res.status(500).json({ message: 'Error downloading video' });
    }
  }
);

router.get(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const video = await Video.findById(videoId).select('timecodes uploader');
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanAccessVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      res.status(200).json(video.timecodes);
    } catch (error) {
      console.error('Failed to retrieve timecodes:', error);
      res.status(500).json({ error: 'Failed to retrieve timecodes' });
    }
  }
);

router.post(
  '/download',
  authenticateToken,
  authorize(allowedVideoRoles),
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

    zip.on('error', (err) => {
      console.error('ZIP archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error creating ZIP archive' });
      }
    });

    zip.pipe(res);

    for (const videoId of videoIds) {
      const video = await Video.findById(videoId);
      if (!video || !userCanAccessVideo(req.user, video)) continue;

      const videoPath = resolveExistingPath(video.compressedPath, video.filepath);
      if (videoPath) {
        zip.file(videoPath, { name: video.originalFilename || video.filename });
      }
    }

    zip.finalize();
  }
);

router.get(
  '/details/:videoId',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    try {
      const video = await Video.findById(req.params.videoId).populate('uploader', 'username');
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }

      if (!userCanAccessVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      res.json(video);
    } catch (err) {
      console.error('Error fetching video details:', err);
      res.status(500).json({ message: 'Error retrieving video details' });
    }
  }
);

module.exports = router;