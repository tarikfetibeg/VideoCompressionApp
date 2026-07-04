// backend/routes/admin.js

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
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
const {
  buildScrubPreviewForVideo,
  hasUsableScrubPreview,
  removeScrubPreviewFolderForVideo,
} = require('../services/videoProcessingService');
const {
  hasReadyHlsPreview,
  removeHlsPreviewFolder,
} = require('../services/hlsPreviewService');
const { enqueueHlsPreview } = require('../queues/hlsQueue');
const {
  getFfmpegCapabilities,
  runNvencProbe,
} = require('../services/ffmpegCapabilityService');
const {
  cleanupEligiblePreviews,
  scanPreviewRetention,
} = require('../services/previewRetentionService');
const {
  getStorageOverview,
  getSettings: getStorageSettings,
  refreshStorageOverview,
  updateStorageSettings,
} = require('../services/storageOverviewService');
const {
  applyProfileVersions,
  getEffectiveMediaSettings,
  getMediaSettings,
  normalizeMediaSettingsUpdate,
} = require('../services/mediaProfileService');
const { enqueuePreviewMaintenance } = require('../queues/previewMaintenanceQueue');
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

function parseWorkspacePagination(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
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

function buildAuditLogFilter(query = {}) {
  const {
    action,
    userId,
    dateFrom,
    dateTo,
  } = query;
  const filter = {};

  if (action && action !== 'all') {
    filter.action = action;
  }

  if (userId && userId !== 'all') {
    filter.performedBy = userId;
  }

  if (dateFrom || dateTo) {
    filter.timestamp = {};
    if (dateFrom) filter.timestamp.$gte = new Date(dateFrom);
    if (dateTo) filter.timestamp.$lte = new Date(dateTo);
  }

  return filter;
}

function enhanceAuditLog(log) {
  return {
    ...log,
    severity: classifyAuditSeverity(log.action),
    entity: inferAuditEntity(log.details),
  };
}

function filterEnhancedAuditLogs(logs, query = {}) {
  const role = query.role || 'all';
  const severity = query.severity || 'all';
  const rawSearchTerm = String(query.q || query.search || '').trim().toLowerCase();
  const searchTerm = rawSearchTerm.length >= 2 ? rawSearchTerm : '';

  return logs.filter((log) => {
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
}

function summarizeAuditLogs(logs) {
  return logs.reduce((summary, log) => {
    summary.total += 1;
    summary[log.severity] = (summary[log.severity] || 0) + 1;
    if (log.entity?.type) {
      summary.entities[log.entity.type] = (summary.entities[log.entity.type] || 0) + 1;
    }
    return summary;
  }, {
    total: 0,
    critical: 0,
    warning: 0,
    info: 0,
    entities: {},
  });
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

function parseScrubPreviewLimit(value, fallback = 10, max = 50) {
  return Math.min(Math.max(parseInt(value, 10) || fallback, 1), max);
}

function parseScrubPreviewMaxScan(value, fallback = 1000, max = 5000) {
  return Math.min(Math.max(parseInt(value, 10) || fallback, 100), max);
}

function videoHasScrubPreviewSource(video) {
  return [video?.previewPath, video?.compressedPath, video?.filepath]
    .filter(Boolean)
    .some((candidatePath) => fs.existsSync(path.resolve(candidatePath)));
}

async function getScrubPreviewInventory(maxScan = 5000) {
  const [totalCompleted, videos] = await Promise.all([
    Video.countDocuments({ processingStatus: 'completed' }),
    Video.find({ processingStatus: 'completed' })
      .select('filename originalFilename finalTitle previewPath compressedPath filepath scrubPreview uploadDate')
      .sort({ uploadDate: -1 })
      .limit(maxScan),
  ]);

  const summary = {
    totalCompleted,
    scanned: videos.length,
    withPreview: 0,
    missingPreview: 0,
    errored: 0,
    sourceMissing: 0,
    maxScan,
  };

  videos.forEach((video) => {
    const available = hasUsableScrubPreview(video);
    if (available) {
      summary.withPreview += 1;
    } else {
      summary.missingPreview += 1;
    }

    if (video.scrubPreview?.error) {
      summary.errored += 1;
    }

    if (!videoHasScrubPreviewSource(video)) {
      summary.sourceMissing += 1;
    }
  });

  return summary;
}

async function getHlsPreviewInventory(maxScan = 5000) {
  const [totalCompleted, videos] = await Promise.all([
    Video.countDocuments({ processingStatus: 'completed' }),
    Video.find({ processingStatus: 'completed' })
      .select('filename originalFilename finalTitle previewPath compressedPath filepath hlsPreview uploadDate')
      .sort({ uploadDate: -1 })
      .limit(maxScan),
  ]);
  const summary = {
    totalCompleted,
    scanned: videos.length,
    ready: 0,
    missing: 0,
    queued: 0,
    processing: 0,
    failed: 0,
    rebuildFailed: 0,
    sourceMissing: 0,
    totalBytes: 0,
    nvencReady: 0,
    cpuReady: 0,
    cpuFallbacks: 0,
    averageProcessingMs: 0,
    maxScan,
  };
  let totalProcessingMs = 0;
  let timedBuilds = 0;
  videos.forEach((video) => {
    const status = video.hlsPreview?.status || 'missing';
    if (hasReadyHlsPreview(video)) summary.ready += 1;
    else if (status === 'queued') summary.queued += 1;
    else if (status === 'processing') summary.processing += 1;
    else if (status === 'failed') summary.failed += 1;
    else summary.missing += 1;
    if (video.hlsPreview?.buildStatus === 'failed') summary.rebuildFailed += 1;
    summary.totalBytes += Number(video.hlsPreview?.size || 0);
    if (video.hlsPreview?.encoderUsed === 'h264_nvenc') summary.nvencReady += 1;
    if (video.hlsPreview?.encoderUsed === 'libx264') summary.cpuReady += 1;
    if (video.hlsPreview?.cpuFallbackUsed) summary.cpuFallbacks += 1;
    if (Number(video.hlsPreview?.processingMs) > 0) {
      totalProcessingMs += Number(video.hlsPreview.processingMs);
      timedBuilds += 1;
    }
    if (!videoHasScrubPreviewSource(video)) summary.sourceMissing += 1;
  });
  summary.averageProcessingMs = timedBuilds > 0
    ? Math.round(totalProcessingMs / timedBuilds)
    : 0;
  return summary;
}

function getPreviewAssetState(video, assetType, settings) {
  if (assetType === 'mp4') {
    if (video.mp4Preview?.error) return 'failed';
    const available = (
      video.mp4Preview?.encoderUsed === 'source'
      || (video.previewPath && fs.existsSync(path.resolve(video.previewPath)))
    );
    if (!available) return 'missing';
    return Number(video.mp4Preview?.profileVersion) === Number(settings.mp4PreviewProfileVersion)
      ? 'ready'
      : 'outdated';
  }
  if (assetType === 'thumbnail') {
    if (video.thumbnail?.error) return 'failed';
    if (!video.thumbnailPath || !fs.existsSync(path.resolve(video.thumbnailPath))) return 'missing';
    return Number(video.thumbnail?.profileVersion) === Number(settings.thumbnailProfileVersion)
      ? 'ready'
      : 'outdated';
  }
  if (assetType === 'scrub') {
    if (video.scrubPreview?.error) return 'failed';
    if (!hasUsableScrubPreview(video)) return 'missing';
    return Number(video.scrubPreview?.profileVersion) === Number(settings.scrubProfileVersion)
      ? 'ready'
      : 'outdated';
  }
  if (assetType === 'hls') {
    if (video.hlsPreview?.buildStatus === 'failed' || video.hlsPreview?.status === 'failed') return 'failed';
    if (!hasReadyHlsPreview(video)) return 'missing';
    return Number(video.hlsPreview?.profileVersion) === Number(settings.hlsProfileVersion)
      ? 'ready'
      : 'outdated';
  }
  return 'missing';
}

async function getMediaPreviewInventory(maxScan = 5000) {
  const [settings, totalCompleted, videos] = await Promise.all([
    getMediaSettings(),
    Video.countDocuments({ processingStatus: 'completed' }),
    Video.find({ processingStatus: 'completed' })
      .select([
        '_id',
        'previewPath',
        'thumbnailPath',
        'mp4Preview',
        'thumbnail',
        'scrubPreview',
        'hlsPreview',
        'previewMaintenance',
        'uploadDate',
      ].join(' '))
      .sort({ uploadDate: -1 })
      .limit(maxScan),
  ]);
  const assets = {};
  ['mp4', 'hls', 'thumbnail', 'scrub'].forEach((assetType) => {
    assets[assetType] = { ready: 0, missing: 0, outdated: 0, failed: 0 };
  });
  let processing = 0;
  let queued = 0;
  videos.forEach((video) => {
    Object.keys(assets).forEach((assetType) => {
      assets[assetType][getPreviewAssetState(video, assetType, settings)] += 1;
    });
    if (
      video.previewMaintenance?.status === 'processing'
      || video.hlsPreview?.buildStatus === 'processing'
    ) processing += 1;
    if (
      video.previewMaintenance?.status === 'queued'
      || video.hlsPreview?.buildStatus === 'queued'
    ) queued += 1;
  });
  return {
    totalCompleted,
    scanned: videos.length,
    maxScan,
    assets,
    processing,
    queued,
    profileVersions: {
      mp4: settings.mp4PreviewProfileVersion,
      hls: settings.hlsProfileVersion,
      thumbnail: settings.thumbnailProfileVersion,
      scrub: settings.scrubProfileVersion,
    },
  };
}

async function ensureDefaultContentTypes() {
  const count = await BroadcastContentType.countDocuments();
  if (count === 0) {
    await BroadcastContentType.insertMany(defaultContentTypes.map((type) => ({ ...type, active: true })));
    return;
  }
  await Promise.all(defaultContentTypes.map((type) =>
    BroadcastContentType.updateOne(
      { slug: type.slug, jobSlaHours: { $exists: false } },
      {
        $set: {
          jobSlaHours: type.jobSlaHours,
          jobGraceHours: type.jobGraceHours,
          autoExpireJobs: true,
        },
      }
    )
  ));
}

function deleteFileIfExists(filePath) {
  if (!filePath) return;

  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

function normalizeFfmpegSettingsUpdate(update) {
  return normalizeMediaSettingsUpdate(update);
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

/* ----- Storage capacity and inventory ----- */

router.get('/storage/overview', async (req, res) => {
  try {
    res.json(await getStorageOverview());
  } catch (error) {
    console.error('Storage overview failed:', error);
    res.status(500).json({ message: 'Storage pregled nije moguće učitati.' });
  }
});

router.post('/storage/overview/refresh', async (req, res) => {
  try {
    const refresh = refreshStorageOverview();
    await AuditLog.create({
      action: 'Refresh Storage Overview',
      performedBy: req.user.id,
      details: { started: refresh.started },
    });
    res.status(202).json({
      message: refresh.started
        ? 'Storage scan je pokrenut u pozadini.'
        : 'Storage scan je već u toku.',
      started: refresh.started,
    });
  } catch (error) {
    console.error('Storage refresh failed:', error);
    res.status(500).json({ message: 'Storage scan nije moguće pokrenuti.' });
  }
});

router.get('/storage/settings', async (req, res) => {
  try {
    res.json(await getStorageSettings());
  } catch (error) {
    console.error('Storage settings load failed:', error);
    res.status(500).json({ message: 'Storage pragove nije moguće učitati.' });
  }
});

router.put('/storage/settings', async (req, res) => {
  try {
    const settings = await updateStorageSettings(req.body || {});
    await AuditLog.create({
      action: 'Update Storage Alert Settings',
      performedBy: req.user.id,
      details: {
        warningFreePercent: settings.warningFreePercent,
        criticalFreePercent: settings.criticalFreePercent,
      },
    });
    res.json({ message: 'Storage pragovi su sačuvani.', settings });
  } catch (error) {
    console.error('Storage settings update failed:', error);
    res.status(error.statusCode || 500).json({
      message: error.statusCode ? error.message : 'Storage pragove nije moguće sačuvati.',
    });
  }
});

/* ----- FFmpeg / NVENC Capability ----- */

router.get('/ffmpeg-capabilities', async (req, res) => {
  try {
    const [capabilities, settings] = await Promise.all([
      getFfmpegCapabilities(),
      FfmpegSettings.findOne({}).lean(),
    ]);
    res.json({
      ...capabilities,
      configuredEncoder: settings?.hlsEncoder || 'libx264',
      configuredPreset: settings?.hlsNvencPreset || 'p5',
      savedProbe: settings?.nvencProbe || null,
    });
  } catch (error) {
    console.error('FFmpeg capability check failed:', error);
    res.status(500).json({ message: 'FFmpeg capability podatke nije moguće učitati.' });
  }
});

router.post('/ffmpeg-capabilities/probe', async (req, res) => {
  try {
    const preset = ['p2', 'p3', 'p4', 'p5', 'p6'].includes(req.body?.preset)
      ? req.body.preset
      : 'p5';
    const result = await runNvencProbe({ preset });
    let settings = await FfmpegSettings.findOne({});
    if (!settings) settings = new FfmpegSettings();
    settings.nvencProbe = {
      ok: result.ok,
      checkedAt: result.checkedAt,
      ffmpegVersion: result.ffmpegVersion,
      gpuName: result.gpuName,
      driverVersion: result.driverVersion,
      error: result.error,
    };
    await settings.save();
    await AuditLog.create({
      action: 'Probe FFmpeg NVENC Capability',
      performedBy: req.user.id,
      details: {
        ok: result.ok,
        preset,
        processingMs: result.processingMs,
        gpuName: result.gpuName,
        driverVersion: result.driverVersion,
        error: result.error,
      },
    });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    console.error('NVENC probe failed:', error);
    res.status(500).json({ message: 'NVENC probe nije moguće završiti.' });
  }
});

/* ----- Conditional MP4 Preview Retention ----- */

router.post('/preview-retention/scan', async (req, res) => {
  try {
    const result = await scanPreviewRetention({
      limit: req.body?.limit,
      videoIds: req.body?.videoIds,
    });
    res.json({
      message: `${result.eligibleCount} preview fajlova ispunjava sigurnosne uslove.`,
      result,
    });
  } catch (error) {
    console.error('Preview retention scan failed:', error);
    res.status(500).json({ message: 'Preview dry-run nije moguće završiti.' });
  }
});

router.post('/preview-retention/cleanup', async (req, res) => {
  try {
    const result = await cleanupEligiblePreviews({
      limit: req.body?.limit,
      videoIds: req.body?.videoIds,
    });
    await AuditLog.create({
      action: 'Cleanup Redundant MP4 Previews',
      performedBy: req.user.id,
      details: {
        scanned: result.scanned,
        deleted: result.deleted,
        skipped: result.skipped,
        reclaimedBytes: result.reclaimedBytes,
      },
    });
    res.json({
      message: `Obrisano ${result.deleted.length} redundantnih MP4 preview fajlova.`,
      result,
    });
  } catch (error) {
    console.error('Preview retention cleanup failed:', error);
    res.status(500).json({ message: 'Preview cleanup nije moguće završiti.' });
  }
});

/* ----- Versioned media preview maintenance ----- */

router.get('/media-previews/summary', async (req, res) => {
  try {
    const maxScan = parseScrubPreviewMaxScan(req.query.maxScan);
    res.json(await getMediaPreviewInventory(maxScan));
  } catch (error) {
    console.error('Media preview summary failed:', error);
    res.status(500).json({ message: 'Media preview pregled nije moguće učitati.' });
  }
});

router.post('/media-previews/rebuild', async (req, res) => {
  try {
    const assetTypes = Array.from(new Set(Array.isArray(req.body?.assetTypes) ? req.body.assetTypes : []))
      .filter((assetType) => ['mp4', 'hls', 'thumbnail', 'scrub'].includes(assetType));
    const scope = ['selected', 'missing', 'outdated'].includes(req.body?.scope)
      ? req.body.scope
      : 'outdated';
    const limit = Math.min(Math.max(parseInt(req.body?.limit, 10) || 10, 1), 50);
    if (assetTypes.length === 0) {
      return res.status(400).json({ message: 'Odaberi najmanje jedan preview tip.' });
    }

    let query = { processingStatus: 'completed' };
    if (scope === 'selected') {
      const videoIds = Array.isArray(req.body?.videoIds)
        ? req.body.videoIds.filter((id) => mongoose.isValidObjectId(id)).slice(0, 50)
        : [];
      if (videoIds.length === 0) {
        return res.status(400).json({ message: 'Selected rebuild zahtijeva validne video ID-eve.' });
      }
      query = { ...query, _id: { $in: videoIds } };
    }

    const [settings, videos] = await Promise.all([
      getMediaSettings(),
      Video.find(query)
        .select([
          '_id',
          'filename',
          'originalFilename',
          'previewPath',
          'compressedPath',
          'filepath',
          'rawPath',
          'thumbnailPath',
          'mp4Preview',
          'thumbnail',
          'scrubPreview',
          'hlsPreview',
          'uploadDate',
        ].join(' '))
        .sort({ uploadDate: -1 })
        .limit(scope === 'selected' ? 50 : 5000),
    ]);

    const queued = [];
    const skipped = [];
    for (const video of videos) {
      if (queued.length >= limit) break;
      const requestedForVideo = scope === 'selected'
        ? assetTypes
        : assetTypes.filter((assetType) => getPreviewAssetState(video, assetType, settings) === scope);
      if (requestedForVideo.length === 0) continue;
      if (!videoHasScrubPreviewSource(video)) {
        skipped.push({ videoId: video._id, reason: 'source_missing' });
        continue;
      }

      const nonHlsTypes = requestedForVideo.filter((assetType) => assetType !== 'hls');
      const jobs = {};
      if (nonHlsTypes.length > 0) {
        const job = await enqueuePreviewMaintenance(video._id, nonHlsTypes);
        jobs.previewJobId = job.id;
      }
      if (requestedForVideo.includes('hls')) {
        const job = await enqueueHlsPreview(video._id, { force: true });
        jobs.hlsJobId = job.id;
      }
      queued.push({
        videoId: video._id,
        filename: video.originalFilename || video.filename,
        assetTypes: requestedForVideo,
        jobs,
      });
    }

    await AuditLog.create({
      action: 'Queue Media Preview Rebuild',
      performedBy: req.user.id,
      details: { scope, limit, assetTypes, queued, skipped },
    });
    res.status(202).json({
      message: `${queued.length} klipova je poslano u preview rebuild.`,
      result: { scope, assetTypes, queued, skipped },
    });
  } catch (error) {
    console.error('Media preview rebuild failed:', error);
    res.status(500).json({ message: 'Preview rebuild nije moguće pokrenuti.' });
  }
});

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
      storageOverview,
    ] = await Promise.all([
      Video.countDocuments({ processingStatus: 'failed' }),
      Feedback.countDocuments({ status: { $in: ['new', 'reviewing', 'planned'] } }),
      AuditLog.countDocuments({
        action: { $regex: /(delete|failed|reject|cleanup|remove|reset|orphan|replace)/i },
      }),
      User.countDocuments({}),
      findRawOrphans(),
      listRawManifestFiles(),
      EditJob.countDocuments({ 'changeLog.0': { $exists: true } }),
      ShowDay.countDocuments({ 'downloadStates.0': { $exists: true } }),
      getStorageOverview({ refreshIfStale: false }),
    ]);
    const storageVolume = (storageOverview.volumes || [])
      .find((volume) => String(volume.role).includes('storage'))
      || storageOverview.volumes?.[0]
      || {};

    res.json({
      failedProcessing,
      pendingFeedback,
      criticalLogs,
      activeUsers,
      rawOrphans: rawOrphans.length,
      rawManifestOrphans: rawManifests.filter((manifest) => manifest.orphan).length,
      jobsWithUpdates,
      showsChangedAfterDownload,
      diskFreeBytes: storageVolume.freeBytes || 0,
      diskTotalBytes: storageVolume.totalBytes || 0,
      diskFreePercent: storageVolume.freePercent || 0,
      diskStatus: storageVolume.status || 'unknown',
      mediaStorageBytes: storageOverview.groups?.media?.bytes || 0,
      applicationStorageBytes: storageOverview.groups?.application?.bytes || 0,
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

/* ----- Scrub Preview Maintenance ----- */

router.get('/scrub-previews/summary', async (req, res) => {
  try {
    const maxScan = parseScrubPreviewMaxScan(req.query.maxScan);
    const summary = await getScrubPreviewInventory(maxScan);
    res.json(summary);
  } catch (err) {
    console.error('Error loading scrub preview summary:', err);
    res.status(500).json({ message: 'Error loading scrub preview summary' });
  }
});

router.post('/scrub-previews/build-missing', async (req, res) => {
  const limit = parseScrubPreviewLimit(req.body?.limit);
  const maxScan = parseScrubPreviewMaxScan(req.body?.maxScan);

  try {
    const videos = await Video.find({ processingStatus: 'completed' })
      .select('filename originalFilename finalTitle previewPath compressedPath filepath duration scrubPreview uploadDate')
      .sort({ uploadDate: -1 })
      .limit(maxScan);

    const result = {
      limit,
      maxScan,
      scanned: 0,
      processedMissing: 0,
      skippedExisting: 0,
      built: [],
      skipped: [],
      failed: [],
    };

    for (const video of videos) {
      result.scanned += 1;

      if (hasUsableScrubPreview(video)) {
        result.skippedExisting += 1;
        continue;
      }

      if (result.processedMissing >= limit) {
        continue;
      }

      result.processedMissing += 1;
      const buildResult = await buildScrubPreviewForVideo(video, { force: false });
      const item = {
        videoId: video._id,
        filename: video.originalFilename || video.finalTitle || video.filename,
        reason: buildResult.reason || buildResult.status,
        frameCount: buildResult.frameCount || 0,
      };

      if (buildResult.status === 'built') {
        result.built.push(item);
      } else if (buildResult.status === 'failed') {
        result.failed.push(item);
      } else {
        result.skipped.push(item);
      }
    }

    await AuditLog.create({
      action: 'Build Missing Scrub Previews',
      performedBy: req.user.id,
      details: {
        limit,
        maxScan,
        scanned: result.scanned,
        built: result.built.length,
        skippedExisting: result.skippedExisting,
        skipped: result.skipped.length,
        failed: result.failed.length,
      },
    });

    res.json({
      message: `Built ${result.built.length} scrub preview(s).`,
      result,
      summary: await getScrubPreviewInventory(maxScan),
    });
  } catch (err) {
    console.error('Error building scrub previews:', err);
    res.status(500).json({ message: 'Error building scrub previews' });
  }
});

/* ----- HLS Preview Maintenance ----- */

router.get('/hls-previews/summary', async (req, res) => {
  try {
    const maxScan = parseScrubPreviewMaxScan(req.query.maxScan);
    res.json(await getHlsPreviewInventory(maxScan));
  } catch (error) {
    console.error('Error loading HLS preview summary:', error);
    res.status(500).json({ message: 'HLS preview summary nije moguće učitati.' });
  }
});

router.post('/hls-previews/build-missing', async (req, res) => {
  try {
    const limit = parseScrubPreviewLimit(req.body?.limit, 5, 20);
    const maxScan = parseScrubPreviewMaxScan(req.body?.maxScan);
    const retryFailed = req.body?.retryFailed === true;
    const statusFilter = retryFailed
      ? { $in: ['missing', 'failed', null] }
      : { $in: ['missing', null] };
    const videos = await Video.find({
      processingStatus: 'completed',
      $or: [
        { 'hlsPreview.status': statusFilter },
        ...(retryFailed ? [{ 'hlsPreview.buildStatus': 'failed' }] : []),
        { hlsPreview: { $exists: false } },
      ],
    })
      .select('_id filename originalFilename finalTitle previewPath compressedPath filepath hlsPreview')
      .sort({ uploadDate: -1 })
      .limit(maxScan);
    const queued = [];
    const skipped = [];

    for (const video of videos) {
      if (queued.length >= limit) break;
      if (!videoHasScrubPreviewSource(video)) {
        skipped.push({ videoId: video._id, reason: 'source_missing' });
        continue;
      }
      const job = await enqueueHlsPreview(video._id, { force: retryFailed });
      queued.push({ videoId: video._id, queueJobId: job.id });
    }

    await AuditLog.create({
      action: 'Build Missing HLS Previews',
      performedBy: req.user.id,
      details: { limit, retryFailed, queued, skipped },
    });
    res.status(202).json({
      message: `${queued.length} HLS preview taskova je poslano u obradu.`,
      result: { queued, skipped },
      summary: await getHlsPreviewInventory(maxScan),
    });
  } catch (error) {
    console.error('Error queueing HLS previews:', error);
    res.status(500).json({ message: 'HLS preview taskove nije moguće pokrenuti.' });
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
    removeScrubPreviewFolderForVideo(video);
    removeHlsPreviewFolder(video._id);

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
  const {
    name,
    slug,
    description = '',
    active = true,
    autoExpireJobs = true,
    jobSlaHours = 72,
    jobGraceHours = 4,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Content type name is required.' });
  }

  try {
    const type = await BroadcastContentType.create({
      name: name.trim(),
      slug: createSlug(slug || name),
      description,
      active: active !== false,
      autoExpireJobs: autoExpireJobs !== false,
      jobSlaHours: Math.min(Math.max(Number(jobSlaHours) || 72, 1), 720),
      jobGraceHours: Math.min(Math.max(Number(jobGraceHours) || 0, 0), 168),
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
  const {
    name,
    slug,
    description = '',
    active = true,
    autoExpireJobs = true,
    jobSlaHours = 72,
    jobGraceHours = 4,
  } = req.body;

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
        autoExpireJobs: autoExpireJobs !== false,
        jobSlaHours: Math.min(Math.max(Number(jobSlaHours) || 72, 1), 720),
        jobGraceHours: Math.min(Math.max(Number(jobGraceHours) || 0, 0), 168),
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
    let settings = await FfmpegSettings.findOne({});
    const previousSettings = getEffectiveMediaSettings(settings);
    const normalized = normalizeFfmpegSettingsUpdate(req.body);
    const { update, changedGroups } = applyProfileVersions(settings, normalized);
    const requestsNvenc = update.hlsEncoder === 'h264_nvenc'
      || update.mp4PreviewEncoder === 'h264_nvenc'
      || ['h264_nvenc', 'hevc_nvenc'].includes(update.codec);
    if (requestsNvenc && settings?.nvencProbe?.ok !== true) {
      return res.status(409).json({
        message: 'Prije uključivanja NVENC HLS-a pokreni uspješan Admin capability probe.',
      });
    }

    if (!settings) {
      settings = await FfmpegSettings.create(update);
    } else {
      settings = await FfmpegSettings.findByIdAndUpdate(
        settings._id,
        update,
        { new: true, runValidators: true }
      );
    }

    await AuditLog.create({
      action: 'Update FFmpeg Settings',
      performedBy: req.user.id,
      details: {
        changedGroups,
        changes: Object.fromEntries(
          Object.entries(update)
            .filter(([field]) => !field.endsWith('ProfileVersion'))
            .map(([field, value]) => [
              field,
              { from: previousSettings[field], to: value },
            ])
        ),
      },
    });

    res.json({
      message: 'FFmpeg i media profile postavke su sačuvane.',
      settings,
      changedGroups,
    });
  } catch (err) {
    console.error('Error updating FFmpeg settings:', err);

    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }

    res.status(500).json({ message: 'Error updating FFmpeg settings' });
  }
});

/* ----- Audit Logs Endpoint ----- */

router.get('/audit-logs/workspace', async (req, res) => {
  try {
    const { page, limit, skip } = parseWorkspacePagination(req.query);
    const filter = buildAuditLogFilter(req.query);
    const maxScan = Math.min(Math.max(parseInt(req.query.maxScan, 10) || 5000, 500), 10000);

    const rawLogs = await AuditLog.find(filter)
      .populate('performedBy', 'username role')
      .sort({ timestamp: -1 })
      .limit(maxScan)
      .lean();

    const filteredLogs = filterEnhancedAuditLogs(rawLogs.map(enhanceAuditLog), req.query);
    const total = filteredLogs.length;

    res.json({
      items: filteredLogs.slice(skip, skip + limit),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary: summarizeAuditLogs(filteredLogs),
      facets: {
        scanned: rawLogs.length,
        maxScan,
      },
    });
  } catch (err) {
    console.error('Error retrieving audit log workspace:', err);
    res.status(500).json({ message: 'Error retrieving audit log workspace' });
  }
});

router.get('/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 250, 1), 1000);
    const filter = buildAuditLogFilter(req.query);

    const logs = await AuditLog.find(filter)
      .populate('performedBy', 'username role')
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const enhancedLogs = filterEnhancedAuditLogs(logs.map(enhanceAuditLog), req.query);

    res.json(enhancedLogs);
  } catch (err) {
    console.error('Error retrieving audit logs:', err);
    res.status(500).json({ message: 'Error retrieving audit logs' });
  }
});

router.delete('/audit-logs', async (req, res) => {
  try {
    const query = req.body || {};
    const filter = buildAuditLogFilter(query);
    const maxScan = Math.min(Math.max(parseInt(query.maxScan, 10) || 10000, 100), 20000);

    const rawLogs = await AuditLog.find(filter)
      .populate('performedBy', 'username role')
      .sort({ timestamp: -1 })
      .limit(maxScan)
      .lean();

    const matchingLogs = filterEnhancedAuditLogs(rawLogs.map(enhanceAuditLog), query)
      .filter((log) => log.action !== 'Delete Audit Logs');
    const logIds = matchingLogs.map((log) => log._id);

    if (logIds.length === 0) {
      return res.json({ message: 'No audit logs matched the selected filters.', deletedCount: 0 });
    }

    const result = await AuditLog.deleteMany({ _id: { $in: logIds } });

    await AuditLog.create({
      action: 'Delete Audit Logs',
      performedBy: req.user.id,
      details: {
        deletedCount: result.deletedCount || 0,
        filters: query,
        scanned: rawLogs.length,
      },
    });

    res.json({
      message: `Deleted ${result.deletedCount || 0} audit log(s).`,
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    console.error('Error deleting audit logs:', err);
    res.status(500).json({ message: 'Error deleting audit logs' });
  }
});

module.exports = router;
