// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Video = require('../models/Video');
const EditJob = require('../models/EditJob');
const Feedback = require('../models/Feedback');
const ShowDay = require('../models/ShowDay');
const FfmpegSettings = require('../models/FfmpegSettings');
const AuditLog = require('../models/AuditLog');
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { defaultContentTypes } = require('../config/broadcastDefaults');
const { cleanupExpiredRawFiles } = require('../services/rawRetentionService');
const { findRawOrphans, importRawOrphans } = require('../services/rawOrphanService');
const { paths, ensureFolderExists } = require('../utils/storagePaths');

const allowedRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];

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

function isPathInside(parentPath, candidatePath) {
  if (!candidatePath) return false;
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return null;
  return Number(bytes) || 0;
}

function classifyAuditSeverity(action = '') {
  const value = String(action).toLowerCase();
  if (/(delete|failed|reject|cleanup|remove|reset|orphan|replace)/.test(value)) return 'critical';
  if (/(retry|update|approve|import|download|claim|join)/.test(value)) return 'warning';
  return 'info';
}

function inferAuditEntity(details = {}) {
  if (!details || typeof details !== 'object') return null;
  if (details.videoId) return { type: 'video', id: details.videoId };
  if (details.jobId) return { type: 'job', id: details.jobId };
  if (details.showDayId) return { type: 'showDay', id: details.showDayId };
  if (details.feedbackId) return { type: 'feedback', id: details.feedbackId };
  if (details.userId) return { type: 'user', id: details.userId };
  return null;
}

async function listRawManifestFiles() {
  ensureFolderExists(paths.rawManifests);

  const entries = await fs.promises.readdir(paths.rawManifests, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const manifestPath = path.join(paths.rawManifests, entry.name);
    const stats = await fs.promises.stat(manifestPath);
    let manifest = null;
    let parseError = '';

    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    } catch (error) {
      parseError = error.message;
    }

    const rawFilename = entry.name.replace(/\.json$/i, '');
    const rawPath = manifest?.rawPath || path.join(paths.raw, rawFilename);
    const rawExists = rawPath ? fs.existsSync(path.resolve(rawPath)) : false;
    const dbRecordExists = rawPath
      ? Boolean(await Video.exists({ rawPath }))
      : false;

    manifests.push({
      filename: entry.name,
      path: manifestPath,
      rawPath,
      rawExists,
      dbRecordExists,
      orphan: !rawExists || !dbRecordExists,
      size: stats.size,
      modifiedAt: stats.mtime,
      parseError,
      manifest,
    });
  }

  return manifests.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
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

/* ----- Admin Overview ----- */

router.get('/overview-metrics', async (req, res) => {
  try {
    const [
      failedProcessing,
      pendingFeedback,
      criticalLogs,
      activeUsers,
      rawOrphans,
      rawManifests,
      jobsWithUpdates,
      showsChangedAfterDownload,
    ] = await Promise.all([
      Video.countDocuments({ processingStatus: 'failed' }),
      Feedback.countDocuments({ status: { $in: ['new', 'reviewing'] } }),
      AuditLog.countDocuments({
        action: { $regex: /(delete|failed|reject|cleanup|remove|reset|orphan|replace)/i },
      }),
      User.countDocuments({}),
      findRawOrphans(),
      listRawManifestFiles(),
      EditJob.countDocuments({ 'changeLog.0': { $exists: true } }),
      ShowDay.countDocuments({ 'downloadStates.0': { $exists: true } }),
    ]);

    res.json({
      failedProcessing,
      pendingFeedback,
      criticalLogs,
      activeUsers,
      rawOrphans: rawOrphans.length,
      rawManifestOrphans: rawManifests.filter((manifest) => manifest.orphan).length,
      jobsWithUpdates,
      showsChangedAfterDownload,
    });
  } catch (err) {
    console.error('Error loading admin overview metrics:', err);
    res.status(500).json({ message: 'Error loading overview metrics' });
  }
});

/* ----- OFF Audio Maintenance ----- */

router.get('/off-files', async (req, res) => {
  try {
    const jobs = await EditJob.find({ 'offFiles.0': { $exists: true } })
      .populate('reporter', 'username role')
      .populate('assignedEditor', 'username role')
      .sort({ updatedAt: -1 });

    const offFiles = [];

    jobs.forEach((job) => {
      (job.offFiles || []).forEach((offFile) => {
        const storagePath = offFile.storagePath || offFile.path;
        const exists = storagePath ? fs.existsSync(path.resolve(storagePath)) : false;
        let size = offFile.size || null;

        if (exists) {
          try {
            size = fs.statSync(path.resolve(storagePath)).size;
          } catch (error) {
            size = offFile.size || null;
          }
        }

        offFiles.push({
          jobId: job._id,
          jobTitle: job.title,
          reporter: job.reporter,
          assignedEditor: job.assignedEditor,
          offFileId: offFile._id,
          originalName: offFile.originalName,
          filename: offFile.filename,
          storagePath,
          mimetype: offFile.mimetype,
          size: formatFileSize(size),
          uploadedAt: offFile.uploadedAt,
          exists,
        });
      });
    });

    res.json(offFiles);
  } catch (err) {
    console.error('Error listing OFF files:', err);
    res.status(500).json({ message: 'Error listing OFF files' });
  }
});

router.delete('/off-files/:jobId/:offFileId', async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found.' });

    const offFile = job.offFiles.id(req.params.offFileId);
    if (!offFile) return res.status(404).json({ message: 'OFF file not found.' });

    const storagePath = offFile.storagePath || offFile.path;
    const resolvedPath = storagePath ? path.resolve(storagePath) : '';

    if (resolvedPath && !isPathInside(paths.offAudio, resolvedPath)) {
      return res.status(400).json({ message: 'OFF file path is outside off-audio storage.' });
    }

    if (resolvedPath && fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
    }

    const deletedInfo = {
      jobId: job._id,
      jobTitle: job.title,
      offFileId: offFile._id,
      originalName: offFile.originalName,
      storagePath,
    };

    offFile.deleteOne();
    await job.save();

    await AuditLog.create({
      action: 'Delete OFF Audio',
      performedBy: req.user.id,
      details: deletedInfo,
    });

    res.json({ message: 'OFF audio deleted.', deleted: deletedInfo });
  } catch (err) {
    console.error('Error deleting OFF file:', err);
    res.status(500).json({ message: 'Error deleting OFF file' });
  }
});

/* ----- Raw Manifest Maintenance ----- */

router.get('/raw-manifests', async (req, res) => {
  try {
    const manifests = await listRawManifestFiles();
    res.json({
      count: manifests.length,
      orphanCount: manifests.filter((manifest) => manifest.orphan).length,
      manifests,
    });
  } catch (err) {
    console.error('Error listing raw manifests:', err);
    res.status(500).json({ message: 'Error listing raw manifests' });
  }
});

router.delete('/raw-manifests/:filename', async (req, res) => {
  try {
    const filename = path.basename(req.params.filename);
    if (!filename.endsWith('.json')) {
      return res.status(400).json({ message: 'Invalid raw manifest filename.' });
    }

    const manifestPath = path.join(paths.rawManifests, filename);
    const resolvedPath = path.resolve(manifestPath);

    if (!isPathInside(paths.rawManifests, resolvedPath)) {
      return res.status(400).json({ message: 'Raw manifest path is outside manifest storage.' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ message: 'Raw manifest not found.' });
    }

    fs.unlinkSync(resolvedPath);

    await AuditLog.create({
      action: 'Delete Raw Manifest',
      performedBy: req.user.id,
      details: { filename, path: resolvedPath },
    });

    res.json({ message: 'Raw manifest deleted.', filename });
  } catch (err) {
    console.error('Error deleting raw manifest:', err);
    res.status(500).json({ message: 'Error deleting raw manifest' });
  }
});

router.post('/raw-manifests/cleanup-orphans', async (req, res) => {
  try {
    const manifests = await listRawManifestFiles();
    const deleted = [];
    const skipped = [];

    for (const manifest of manifests.filter((item) => item.orphan)) {
      const resolvedPath = path.resolve(manifest.path);

      if (!isPathInside(paths.rawManifests, resolvedPath)) {
        skipped.push({ filename: manifest.filename, reason: 'outside manifest storage' });
        continue;
      }

      try {
        fs.unlinkSync(resolvedPath);
        deleted.push({ filename: manifest.filename, path: resolvedPath });
      } catch (error) {
        skipped.push({ filename: manifest.filename, reason: error.message });
      }
    }

    await AuditLog.create({
      action: 'Cleanup Orphan Raw Manifests',
      performedBy: req.user.id,
      details: { deleted, skipped },
    });

    res.json({
      message: `Deleted ${deleted.length} orphan raw manifest(s).`,
      deleted,
      skipped,
    });
  } catch (err) {
    console.error('Error cleaning raw manifests:', err);
    res.status(500).json({ message: 'Error cleaning raw manifests' });
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
    )
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('correctionReportedBy', 'username role')
      .populate('program')
      .populate('contentType');

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

router.patch('/videos/:id/content-type', async (req, res) => {
  const { contentTypeId } = req.body;

  if (!contentTypeId) {
    return res.status(400).json({ message: 'contentTypeId is required.' });
  }

  try {
    const contentType = await BroadcastContentType.findById(contentTypeId);
    if (!contentType || !contentType.active) {
      return res.status(404).json({ message: 'Active content type not found.' });
    }

    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    const previousContentTypeId = video.contentType || null;
    const previousFinalCategory = video.finalCategory || null;

    video.contentType = contentType._id;
    video.finalCategory = contentType.slug;
    video.keywords = Array.from(new Set([
      ...(Array.isArray(video.keywords) ? video.keywords : []),
      contentType.name,
    ].filter(Boolean)));

    await video.save();

    await AuditLog.create({
      action: 'Update Video Content Type',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        filename: video.filename,
        previousContentTypeId,
        previousFinalCategory,
        contentTypeId: contentType._id,
        contentTypeName: contentType.name,
      },
    });

    const populatedVideo = await Video.findById(video._id)
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('correctionReportedBy', 'username role')
      .populate('program')
      .populate('contentType');

    res.json({ message: 'Video content type updated successfully', video: populatedVideo });
  } catch (err) {
    console.error('Error updating video content type:', err);
    res.status(500).json({ message: 'Error updating video content type' });
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
    const {
      action,
      userId,
      role,
      severity,
      dateFrom,
      dateTo,
      search,
    } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 250, 1), 1000);
    const filter = {};

    if (action && action !== 'all') {
      filter.action = { $regex: String(action).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    if (userId && userId !== 'all') {
      filter.performedBy = userId;
    }

    if (dateFrom || dateTo) {
      filter.timestamp = {};
      if (dateFrom) filter.timestamp.$gte = new Date(dateFrom);
      if (dateTo) filter.timestamp.$lte = new Date(dateTo);
    }

    const logs = await AuditLog.find(filter)
      .populate('performedBy', 'username role')
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const searchTerm = String(search || '').trim().toLowerCase();
    const enhancedLogs = logs
      .map((log) => ({
        ...log,
        severity: classifyAuditSeverity(log.action),
        entity: inferAuditEntity(log.details),
      }))
      .filter((log) => {
        const matchesRole = !role || role === 'all' || log.performedBy?.role === role;
        const matchesSeverity = !severity || severity === 'all' || log.severity === severity;
        const matchesSearch = !searchTerm || [
          log.action,
          log.performedBy?.username,
          log.performedBy?.role,
          JSON.stringify(log.details || {}),
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(searchTerm));

        return matchesRole && matchesSeverity && matchesSearch;
      });

    res.json(enhancedLogs);
  } catch (err) {
    console.error('Error retrieving audit logs:', err);
    res.status(500).json({ message: 'Error retrieving audit logs' });
  }
});

module.exports = router;
