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
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { defaultContentTypes } = require('../config/broadcastDefaults');
const { cleanupExpiredRawFiles } = require('../services/rawRetentionService');
const { findRawOrphans, importRawOrphans } = require('../services/rawOrphanService');

const allowedRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Admin'];

function createSlug(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'content';
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
  )).sort((a, b) => a - b);
}

async function ensureDefaultContentTypes() {
  const count = await BroadcastContentType.countDocuments();
  if (count > 0) return;
  await BroadcastContentType.insertMany(defaultContentTypes.map((type) => ({ ...type, active: true })));
}

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

router.get('/raw-orphans', async (req, res) => {
  try {
    const orphans = await findRawOrphans();

    res.json({
      count: orphans.length,
      files: orphans,
    });
  } catch (err) {
    console.error('Raw orphan scan error:', err);
    res.status(500).json({ message: 'Error scanning raw orphan files' });
  }
});

router.post('/raw-orphans/import', async (req, res) => {
  const body = req.body || {};
  const { uploaderId } = body;

  try {
    if (uploaderId) {
      const uploader = await User.findById(uploaderId).select('_id');
      if (!uploader) {
        return res.status(404).json({ message: 'Recovery owner not found.' });
      }
    }

    const importOptions = {
      userId: uploaderId || undefined,
      fallbackUserId: req.user.id,
    };

    if (Object.prototype.hasOwnProperty.call(body, 'event')) {
      importOptions.event = body.event;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'date')) {
      importOptions.date = body.date;
    }

    const result = await importRawOrphans(importOptions);

    await AuditLog.create({
      action: 'Import Raw Orphan Files',
      performedBy: req.user.id,
      details: result,
    });

    res.status(201).json({
      message: `Imported ${result.imported.length} orphan raw file(s).`,
      result,
    });
  } catch (err) {
    console.error('Raw orphan import error:', err);
    res.status(500).json({ message: 'Error importing raw orphan files' });
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

router.post('/users', async (req, res) => {
  const { username, password, role = 'Reporter' } = req.body;

  if (!username || !password || password.length < 8) {
    return res.status(400).json({
      message: 'Username and password with at least 8 characters are required.',
    });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid user role.' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already taken.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      role,
    });

    await AuditLog.create({
      action: 'Create User',
      performedBy: req.user.id,
      details: { userId: user._id, username: user.username, role: user.role },
    });

    res.status(201).json({
      message: 'User created successfully.',
      user: {
        _id: user._id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ message: 'Error creating user' });
  }
});

router.put('/users/:id', async (req, res) => {
  const { role } = req.body;

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: 'Invalid user role.' });
  }

  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select('-password');

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

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: 'New password with at least 8 characters is required.' });
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

router.patch('/videos/:id/owner', async (req, res) => {
  const { uploaderId } = req.body;

  if (!uploaderId) {
    return res.status(400).json({ message: 'uploaderId is required.' });
  }

  try {
    const uploader = await User.findById(uploaderId).select('_id username role');
    if (!uploader) {
      return res.status(404).json({ message: 'Uploader not found.' });
    }

    const video = await Video.findByIdAndUpdate(
      req.params.id,
      { uploader: uploader._id },
      { new: true }
    ).populate('uploader', 'username role');

    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    await AuditLog.create({
      action: 'Update Video Owner',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        filename: video.filename,
        uploaderId: uploader._id,
        uploaderUsername: uploader.username,
      },
    });

    res.json({ message: 'Video owner updated successfully', video });
  } catch (err) {
    console.error('Error updating video owner:', err);
    res.status(500).json({ message: 'Error updating video owner' });
  }
});

/* ----- Broadcast Programs & Content Types ----- */

router.get('/broadcast-programs', async (req, res) => {
  try {
    const programs = await BroadcastProgram.find({}).sort({ active: -1, name: 1 });
    res.json(programs);
  } catch (err) {
    console.error('Error retrieving broadcast programs:', err);
    res.status(500).json({ message: 'Error retrieving broadcast programs' });
  }
});

router.post('/broadcast-programs', async (req, res) => {
  const { name, description = '', defaultTime = '', daysOfWeek = [], active = true } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Program name is required.' });
  }

  try {
    const program = await BroadcastProgram.create({
      name: name.trim(),
      description,
      defaultTime,
      daysOfWeek: normalizeDaysOfWeek(daysOfWeek),
      active: active !== false,
    });

    await AuditLog.create({
      action: 'Create Broadcast Program',
      performedBy: req.user.id,
      details: { programId: program._id, name: program.name },
    });

    res.status(201).json({ message: 'Broadcast program created.', program });
  } catch (err) {
    console.error('Error creating broadcast program:', err);
    res.status(400).json({ message: err.code === 11000 ? 'Program name already exists.' : 'Error creating broadcast program' });
  }
});

router.put('/broadcast-programs/:id', async (req, res) => {
  const { name, description = '', defaultTime = '', daysOfWeek = [], active = true } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Program name is required.' });
  }

  try {
    const program = await BroadcastProgram.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        description,
        defaultTime,
        daysOfWeek: normalizeDaysOfWeek(daysOfWeek),
        active: active !== false,
      },
      { new: true }
    );

    if (!program) return res.status(404).json({ message: 'Broadcast program not found.' });

    await AuditLog.create({
      action: 'Update Broadcast Program',
      performedBy: req.user.id,
      details: { programId: program._id, name: program.name },
    });

    res.json({ message: 'Broadcast program updated.', program });
  } catch (err) {
    console.error('Error updating broadcast program:', err);
    res.status(400).json({ message: err.code === 11000 ? 'Program name already exists.' : 'Error updating broadcast program' });
  }
});

router.get('/broadcast-content-types', async (req, res) => {
  try {
    await ensureDefaultContentTypes();
    const types = await BroadcastContentType.find({}).sort({ active: -1, name: 1 });
    res.json(types);
  } catch (err) {
    console.error('Error retrieving broadcast content types:', err);
    res.status(500).json({ message: 'Error retrieving content types' });
  }
});

router.post('/broadcast-content-types', async (req, res) => {
  const { name, slug, description = '', active = true } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Content type name is required.' });
  }

  try {
    const type = await BroadcastContentType.create({
      name: name.trim(),
      slug: createSlug(slug || name),
      description,
      active: active !== false,
    });

    await AuditLog.create({
      action: 'Create Broadcast Content Type',
      performedBy: req.user.id,
      details: { typeId: type._id, name: type.name },
    });

    res.status(201).json({ message: 'Content type created.', type });
  } catch (err) {
    console.error('Error creating broadcast content type:', err);
    res.status(400).json({ message: err.code === 11000 ? 'Content type already exists.' : 'Error creating content type' });
  }
});

router.put('/broadcast-content-types/:id', async (req, res) => {
  const { name, slug, description = '', active = true } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Content type name is required.' });
  }

  try {
    const type = await BroadcastContentType.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        slug: createSlug(slug || name),
        description,
        active: active !== false,
      },
      { new: true }
    );

    if (!type) return res.status(404).json({ message: 'Content type not found.' });

    await AuditLog.create({
      action: 'Update Broadcast Content Type',
      performedBy: req.user.id,
      details: { typeId: type._id, name: type.name },
    });

    res.json({ message: 'Content type updated.', type });
  } catch (err) {
    console.error('Error updating broadcast content type:', err);
    res.status(400).json({ message: err.code === 11000 ? 'Content type already exists.' : 'Error updating content type' });
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
