// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Video = require('../models/Video');
const FfmpegSettings = require('../models/FfmpegSettings');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { cleanupExpiredRawFiles } = require('../services/rawRetentionService');

function deleteFileIfExists(filePath) {
  if (!filePath) return;

  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

function normalizeFfmpegSettingsUpdate(update) {
  const normalized = { ...update };

  if (Object.prototype.hasOwnProperty.call(normalized, 'rawRetentionDays')) {
    const rawRetentionDays = Number(normalized.rawRetentionDays);

    if (
      !Number.isInteger(rawRetentionDays) ||
      rawRetentionDays < 0 ||
      rawRetentionDays > 365
    ) {
      const error = new Error('rawRetentionDays must be an integer between 0 and 365.');
      error.statusCode = 400;
      throw error;
    }

    normalized.rawRetentionDays = rawRetentionDays;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'bitrate')) {
    const bitrate = Number(normalized.bitrate);

    if (!Number.isFinite(bitrate) || bitrate <= 0) {
      const error = new Error('bitrate must be a positive number.');
      error.statusCode = 400;
      throw error;
    }

    normalized.bitrate = bitrate;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'framerate')) {
    const framerate = Number(normalized.framerate);

    if (!Number.isFinite(framerate) || framerate <= 0) {
      const error = new Error('framerate must be a positive number.');
      error.statusCode = 400;
      throw error;
    }

    normalized.framerate = framerate;
  }

  return normalized;
}

/* --- Public Endpoint for FFmpeg Default Settings ---
   This endpoint returns the default FFmpeg settings.
   It only requires that the requester is authenticated,
   making it accessible to reporters and other authenticated roles.
*/
router.get('/ffmpeg-settings-default', authenticateToken, async (req, res) => {
  try {
    let settings = await FfmpegSettings.findOne({});
    if (!settings) {
      settings = await FfmpegSettings.create({});
    }
    res.json(settings);
  } catch (err) {
    console.error('Error fetching default FFmpeg settings:', err);
    res.status(500).json({ message: 'Error fetching default FFmpeg settings' });
  }
});

/* --- Protect all subsequent routes with Admin role --- */
router.use(authenticateToken);
router.use(authorize(['Admin']));

/* ----- Raw Retention Cleanup ----- */

router.post('/cleanup-raw', async (req, res) => {
  try {
    const result = await cleanupExpiredRawFiles();

    await AuditLog.create({
      action: 'Manual Raw Retention Cleanup',
      performedBy: req.user.id,
      details: result,
    });

    res.json({
      message: 'Raw retention cleanup completed',
      result,
    });
  } catch (err) {
    console.error('Manual raw cleanup error:', err);
    res.status(500).json({ message: 'Error running raw cleanup' });
  }
});

/* ----- User Management ----- */

router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (err) {
    console.error('Error retrieving users:', err);
    res.status(500).json({ message: 'Error retrieving users' });
  }
});

router.put('/users/:id', async (req, res) => {
  const { role } = req.body;

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    await AuditLog.create({
      action: 'Update User Role',
      performedBy: req.user.id,
      details: { userId: req.params.id, newRole: role },
    });

    res.json({ message: 'User role updated successfully', user: updatedUser });
  } catch (err) {
    console.error('Error updating user role:', err);
    res.status(500).json({ message: 'Error updating user role' });
  }
});

router.put('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ message: 'New password is required.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    await AuditLog.create({
      action: 'Reset User Password',
      performedBy: req.user.id,
      details: { userId: req.params.id },
    });

    res.json({ message: 'User password reset successfully' });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ message: 'Error resetting password' });
  }
});

/* ----- Video Management ----- */

router.delete('/videos/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    const pathsToDelete = Array.from(new Set([
      video.filepath,
      video.compressedPath,
      video.previewPath,
      video.thumbnailPath,
      video.rawPath,
    ].filter(Boolean)));

    pathsToDelete.forEach(deleteFileIfExists);

    await Video.findByIdAndDelete(req.params.id);

    await AuditLog.create({
      action: 'Delete Video',
      performedBy: req.user.id,
      details: { videoId: req.params.id, filename: video.filename },
    });

    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ message: 'Error deleting video' });
  }
});

/* ----- FFmpeg Settings Management ----- */

router.get('/ffmpeg-settings', async (req, res) => {
  try {
    let settings = await FfmpegSettings.findOne({});
    if (!settings) {
      settings = await FfmpegSettings.create({});
    }
    res.json(settings);
  } catch (err) {
    console.error('Error retrieving FFmpeg settings:', err);
    res.status(500).json({ message: 'Error retrieving FFmpeg settings' });
  }
});

router.put('/ffmpeg-settings', async (req, res) => {
  try {
    const update = normalizeFfmpegSettingsUpdate(req.body);

    let settings = await FfmpegSettings.findOne({});

    if (!settings) {
      settings = await FfmpegSettings.create(update);
    } else {
      settings = await FfmpegSettings.findByIdAndUpdate(
        settings._id,
        update,
        { new: true }
      );
    }

    await AuditLog.create({
      action: 'Update FFmpeg Settings',
      performedBy: req.user.id,
      details: update,
    });

    res.json({ message: 'FFmpeg settings updated successfully', settings });
  } catch (err) {
    console.error('Error updating FFmpeg settings:', err);

    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }

    res.status(500).json({ message: 'Error updating FFmpeg settings' });
  }
});

/* ----- Audit Logs Endpoint ----- */

router.get('/audit-logs', async (req, res) => {
  try {
    const logs = await AuditLog.find({})
      .populate('performedBy', 'username')
      .sort({ timestamp: -1 });

    res.json(logs);
  } catch (err) {
    console.error('Error retrieving audit logs:', err);
    res.status(500).json({ message: 'Error retrieving audit logs' });
  }
});

module.exports = router;