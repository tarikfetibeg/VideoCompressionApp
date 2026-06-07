// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt'); // Needed for hashing new passwords
const User = require('../models/User');
const Video = require('../models/Video');
const FfmpegSettings = require('../models/FfmpegSettings');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');

/* --- Public Endpoint for FFmpeg Default Settings ---
   This endpoint returns the default FFmpeg settings.
   It only requires that the requester is authenticated,
   making it accessible to reporters (and others) without needing admin rights.
*/
router.get('/ffmpeg-settings-default', authenticateToken, async (req, res) => {
  try {
    let settings = await FfmpegSettings.findOne({});
    if (!settings) {
      settings = await FfmpegSettings.create({
        codec: 'libx264',
        resolution: '1920x1080',
        bitrate: 1500, // in Kbps
        framerate: 30,
      });
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching default FFmpeg settings' });
  }
});

/* --- Protect all subsequent routes with Admin role --- */
router.use(authenticateToken);
router.use(authorize(['Admin']));

/* ----- User Management ----- */

// Get all users (excluding passwords)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving users' });
  }
});

// Update user permissions (role)
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
    // Log the role update
    await AuditLog.create({
      action: 'Update User Role',
      performedBy: req.user.id,
      details: { userId: req.params.id, newRole: role }
    });
    res.json({ message: 'User role updated successfully', user: updatedUser });
  } catch (err) {
    res.status(500).json({ message: 'Error updating user role' });
  }
});

// Reset user password endpoint
router.put('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ message: 'New password is required.' });
  }
  try {
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword },
      { new: true }
    );
    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }
    // Log the password reset action
    await AuditLog.create({
      action: 'Reset User Password',
      performedBy: req.user.id,
      details: { userId: req.params.id }
    });
    res.json({ message: 'User password reset successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error resetting password' });
  }
});

/* ----- Video Management ----- */

// Delete a video by its ID
router.delete('/videos/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }
    // Delete the file from the file system if it exists
    if (fs.existsSync(video.filepath)) {
      fs.unlinkSync(video.filepath);
    }
    // Remove the video document
    await Video.findByIdAndDelete(req.params.id);
    // Log the deletion
    await AuditLog.create({
      action: 'Delete Video',
      performedBy: req.user.id,
      details: { videoId: req.params.id, filename: video.filename }
    });
    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting video' });
  }
});

/* ----- FFmpeg Settings Management ----- */

// Get current FFmpeg settings
router.get('/ffmpeg-settings', async (req, res) => {
  try {
    let settings = await FfmpegSettings.findOne({});
    if (!settings) {
      settings = await FfmpegSettings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving FFmpeg settings' });
  }
});

// Update FFmpeg settings
router.put('/ffmpeg-settings', async (req, res) => {
  try {
    const update = req.body;
    let settings = await FfmpegSettings.findOne({});
    if (!settings) {
      settings = await FfmpegSettings.create(update);
    } else {
      settings = await FfmpegSettings.findByIdAndUpdate(settings._id, update, { new: true });
    }
    // Log the settings update
    await AuditLog.create({
      action: 'Update FFmpeg Settings',
      performedBy: req.user.id,
      details: update
    });
    res.json({ message: 'FFmpeg settings updated successfully', settings });
  } catch (err) {
    res.status(500).json({ message: 'Error updating FFmpeg settings' });
  }
});

/* ----- Audit Logs Endpoint ----- */

// Retrieve all audit logs
router.get('/audit-logs', async (req, res) => {
  try {
    // Populate performedBy with username for clarity and sort by most recent first
    const logs = await AuditLog.find({})
      .populate('performedBy', 'username')
      .sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: 'Error retrieving audit logs' });
  }
});

module.exports = router;
