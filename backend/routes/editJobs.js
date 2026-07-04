const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const multer = require('multer');
const mammoth = require('mammoth');
const EditJob = require('../models/EditJob');
const Video = require('../models/Video');
const CorrectionRequest = require('../models/CorrectionRequest');
const ShowDay = require('../models/ShowDay');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const {
  paths,
  ensureFolderExists,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
  createRawManifestPath,
} = require('../utils/storagePaths');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { probeMedia } = require('../services/videoProcessingService');
const {
  allowedVideoExtensions,
  allowedVideoMimetypes,
  supportedVideoFormatSummary,
} = require('../config/mediaFormats');
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const { getQueueErrorMessage } = require('../utils/queueErrors');
const { addTextSearchFilter } = require('../utils/searchText');
const { setDownloadHeaders } = require('../utils/downloadHeaders');
const { buildApprovedArchiveEligibilityCondition } = require('../utils/archiveEligibility');
const { streamEditPackage, streamOffFile } = require('../services/downloadService');
const {
  createCommentNotifications,
  getCommentRecipientIds,
  markJobNotificationsRead,
} = require('../services/jobNotificationService');
const {
  applySlaToJob,
  calculateJobSchedule,
  getDeadlineState,
} = require('../services/editJobLifecycleService');

const router = express.Router();

const allowedJobRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin'];
const productionRoles = ['Editor', 'VideoEditor', 'Producer', 'Admin'];
const allowedStatuses = [
  'draft',
  'submitted',
  'claimed',
  'in_edit',
  'needs_info',
  'ready_for_qc',
  'approved',
  'aired',
  'archived',
];
const allowedPriorities = ['low', 'normal', 'high', 'urgent'];
const allowedWorkspaceStates = ['active', 'expired', 'closed', 'cancelled'];
const allowedJobKinds = ['standard', 'correction'];
const allowedSegmentTypes = [
  'sot',
  'broll',
  'standup',
  'nat_sound',
  'cutaway',
  'graphic',
  'lower_third',
  'do_not_use',
  'other',
];
const allowedOffAudioExtensions = ['.wav', '.wave', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma'];
const allowedOffAudioMimetypes = [
  'audio/aac',
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/wave',
  'audio/x-m4a',
  'audio/x-ms-wma',
  'audio/x-wav',
];
const MAX_OFF_FILES = parseInt(process.env.MAX_OFF_FILES || '12', 10) || 12;
const MAX_OFF_FILE_SIZE_MB = Number(process.env.MAX_OFF_FILE_SIZE_MB) > 0
  ? Number(process.env.MAX_OFF_FILE_SIZE_MB)
  : 500;
const MAX_OFF_FILE_SIZE_BYTES = MAX_OFF_FILE_SIZE_MB * 1024 * 1024;
const allowedBriefImportExtensions = ['.docx', '.txt', '.md', '.rtf'];
const MAX_BRIEF_IMPORT_SIZE_MB = Number(process.env.MAX_BRIEF_IMPORT_SIZE_MB) > 0
  ? Number(process.env.MAX_BRIEF_IMPORT_SIZE_MB)
  : 25;
const MAX_BRIEF_IMPORT_SIZE_BYTES = MAX_BRIEF_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_JOB_MATERIAL_FILES = parseInt(process.env.MAX_JOB_MATERIAL_FILES || '20', 10) || 20;
const MAX_UPLOAD_SIZE_GB = Number(process.env.MAX_UPLOAD_SIZE_GB) > 0
  ? Number(process.env.MAX_UPLOAD_SIZE_GB)
  : 25;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_GB * 1024 * 1024 * 1024;

const offAudioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureFolderExists(paths.offAudio);
    cb(null, paths.offAudio);
  },
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('off', file.originalname));
  },
});

const offAudioFileFilter = (req, file, cb) => {
  const mimetype = String(file.mimetype || '').toLowerCase();
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (allowedOffAudioMimetypes.includes(mimetype) || allowedOffAudioExtensions.includes(extension)) {
    return cb(null, true);
  }

  return cb(
    new Error(`Unsupported OFF audio file: ${file.originalname}. Supported formats: WAV, MP3, M4A, AAC, FLAC, OGG, OPUS, WMA.`),
    false
  );
};

const offAudioUpload = multer({
  storage: offAudioStorage,
  fileFilter: offAudioFileFilter,
  limits: {
    fileSize: MAX_OFF_FILE_SIZE_BYTES,
    files: MAX_OFF_FILES,
  },
});

const briefImportUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (allowedBriefImportExtensions.includes(extension)) {
      return cb(null, true);
    }

    return cb(
      new Error('Unsupported brief document. Supported formats: DOCX, TXT, MD, RTF.'),
      false
    );
  },
  limits: {
    fileSize: MAX_BRIEF_IMPORT_SIZE_BYTES,
    files: 1,
  },
});

const finalVideoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureFolderExists(paths.temp);
    cb(null, paths.temp);
  },
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('final_source', file.originalname));
  },
});

const finalVideoUpload = multer({
  storage: finalVideoStorage,
  fileFilter: (req, file, cb) => {
    const mimetype = String(file.mimetype || '').toLowerCase();
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (allowedVideoMimetypes.includes(mimetype) || allowedVideoExtensions.includes(extension)) {
      return cb(null, true);
    }

    return cb(
      new Error(`Unsupported final video format. Supported: ${supportedVideoFormatSummary}.`),
      false
    );
  },
  limits: {
    fileSize: (Number(process.env.MAX_UPLOAD_SIZE_GB) || 25) * 1024 * 1024 * 1024,
    files: 1,
  },
});

const jobMaterialStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureFolderExists(paths.raw);
    cb(null, paths.raw);
  },
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('job_source', file.originalname));
  },
});

const jobMaterialUpload = multer({
  storage: jobMaterialStorage,
  fileFilter: (req, file, cb) => {
    const mimetype = String(file.mimetype || '').toLowerCase();
    const extension = path.extname(file.originalname || '').toLowerCase();

    if (allowedVideoMimetypes.includes(mimetype) || allowedVideoExtensions.includes(extension)) {
      return cb(null, true);
    }

    return cb(
      new Error(`Unsupported job material format. Supported: ${supportedVideoFormatSummary}.`),
      false
    );
  },
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: MAX_JOB_MATERIAL_FILES,
  },
});

router.use(authenticateToken);
router.use(authorize(allowedJobRoles));

function getObjectIdString(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function canAccessJob(user, job) {
  if (!user || !job) return false;
  if (user.role === 'Admin') return true;
  if (productionRoles.includes(user.role)) return true;
  const reporterId = getObjectIdString(job.reporter);
  return reporterId === user.id;
}

function canDownloadJobPackage(user, job) {
  if (!user || !job || !productionRoles.includes(user.role)) return false;
  if (['Admin', 'Producer'].includes(user.role)) return true;

  const assignedEditorId = getObjectIdString(job.assignedEditor);
  return assignedEditorId && assignedEditorId === user.id;
}

function isProductionUser(user) {
  return Boolean(user && productionRoles.includes(user.role));
}

function canReporterUpdateJob(user, job) {
  if (!user || !job) return false;
  if (user.role === 'Admin') return true;
  if (user.role !== 'Reporter') return false;
  return getObjectIdString(job.reporter) === user.id;
}

function buildAppendableVideoFilter(user, videoIds) {
  const filter = { _id: { $in: videoIds } };
  if (user?.role === 'Admin') return filter;

  return {
    ...filter,
    $or: [
      { uploader: user.id },
      buildApprovedArchiveEligibilityCondition(),
    ],
  };
}

function canUploadFinalForJob(user, job) {
  if (!user || !job) return false;
  if (user.role === 'Admin') return true;
  if (!['Editor', 'VideoEditor'].includes(user.role)) return false;
  const assignedEditorId = getObjectIdString(job.assignedEditor);
  return !assignedEditorId || assignedEditorId === user.id;
}

function getViewerLastViewedAt(job, user) {
  if (!job || !user) return null;
  const viewerState = (job.viewerStates || []).find(
    (entry) => getObjectIdString(entry.user) === user.id
  );

  return viewerState?.lastViewedAt || null;
}

function getJobDownloadState(job, user) {
  if (!job || !user) return null;

  return (job.downloadStates || []).find(
    (entry) => getObjectIdString(entry.user) === user.id
  ) || null;
}

function buildObjectIdSet(values = []) {
  return new Set((values || []).map(getObjectIdString).filter(Boolean));
}

function getJobDownloadMeta(job, user) {
  if (!isProductionUser(user)) return null;

  const downloadState = getJobDownloadState(job, user);
  const downloadedSegmentIds = buildObjectIdSet(downloadState?.downloadedSegmentIds);
  const downloadedOffFileIds = buildObjectIdSet(downloadState?.downloadedOffFileIds);
  const segmentIds = (job.segments || []).map((segment) => getObjectIdString(segment._id)).filter(Boolean);
  const offFileIds = (job.offFiles || []).map((offFile) => getObjectIdString(offFile._id)).filter(Boolean);
  const missingSegmentIds = segmentIds.filter((segmentId) => !downloadedSegmentIds.has(segmentId));
  const missingOffFileIds = offFileIds.filter((offFileId) => !downloadedOffFileIds.has(offFileId));

  return {
    lastDownloadedAt: downloadState?.lastDownloadedAt || null,
    downloadCount: Number(downloadState?.downloadCount || 0),
    downloadedSegmentCount: segmentIds.length - missingSegmentIds.length,
    downloadedOffFileCount: offFileIds.length - missingOffFileIds.length,
    totalSegmentCount: segmentIds.length,
    totalOffFileCount: offFileIds.length,
    missingSegmentCount: missingSegmentIds.length,
    missingOffFileCount: missingOffFileIds.length,
    hasMissingFiles: missingSegmentIds.length > 0 || missingOffFileIds.length > 0,
    missingSegmentIds,
    missingOffFileIds,
  };
}

function getUnreadChangeCount(job, user) {
  if (!user || !canAccessJob(user, job)) return 0;

  const lastViewedAt = getViewerLastViewedAt(job, user);
  const lastViewedTimestamp = lastViewedAt ? new Date(lastViewedAt).getTime() : 0;

  return (job.changeLog || []).filter((change) => {
    if (change.type === 'job_created') return false;
    if (getObjectIdString(change.author) === user.id) return false;

    const recipientIds = buildObjectIdSet(change.recipientUsers);
    if (recipientIds.size > 0 && !recipientIds.has(user.id)) return false;
    if (user.role === 'Reporter' && recipientIds.size === 0) return false;

    const changeTimestamp = change.createdAt ? new Date(change.createdAt).getTime() : 0;
    return changeTimestamp > lastViewedTimestamp;
  }).length;
}

function serializeJob(job, user) {
  const data = typeof job.toObject === 'function' ? job.toObject() : job;
  const lastViewedAt = getViewerLastViewedAt(job, user);
  const unreadChangeCount = getUnreadChangeCount(job, user);
  const downloadMeta = getJobDownloadMeta(job, user);

  return {
    ...data,
    viewerMeta: {
      lastViewedAt,
      unreadChangeCount,
      hasUnreadChanges: unreadChangeCount > 0,
    },
    downloadMeta,
    deadlineState: getDeadlineState(data),
  };
}

async function markJobViewed(job, user) {
  if (!user || !canAccessJob(user, job)) return;

  const now = new Date();
  const existingState = (job.viewerStates || []).find(
    (entry) => getObjectIdString(entry.user) === user.id
  );

  if (existingState) {
    await EditJob.updateOne(
      { _id: job._id, 'viewerStates.user': user.id },
      { $set: { 'viewerStates.$.lastViewedAt': now } }
    );
    return;
  }

  await EditJob.updateOne(
    { _id: job._id },
    { $push: { viewerStates: { user: user.id, lastViewedAt: now } } }
  );
}

function addJobChange(job, user, type, summary, details = {}, recipientUsers = []) {
  const changeTime = new Date();

  job.changeLog.push({
    type,
    summary,
    author: user.id,
    actorRole: user.role,
    recipientUsers,
    details,
    createdAt: changeTime,
  });

  if (user.role === 'Reporter' || type !== 'status_updated') {
    job.lastReporterChangeAt = changeTime;
  }
}

function mergeObjectIds(existingIds = [], nextIds = []) {
  const ids = buildObjectIdSet(existingIds);

  nextIds.map(getObjectIdString).filter(Boolean).forEach((id) => ids.add(id));
  return Array.from(ids);
}

function removeObjectIdFromDownloadStates(job, fieldName, idToRemove) {
  const targetId = getObjectIdString(idToRemove);
  if (!targetId) return;

  (job.downloadStates || []).forEach((state) => {
    state[fieldName] = (state[fieldName] || []).filter(
      (storedId) => getObjectIdString(storedId) !== targetId
    );
  });
}

async function markJobPackageDownloaded(jobId, user, segmentIds = [], offFileIds = []) {
  const downloadTime = new Date();
  const mutableJob = await EditJob.findById(jobId);
  if (!mutableJob) return;

  const existingState = (mutableJob.downloadStates || []).find(
    (entry) => getObjectIdString(entry.user) === user.id
  );

  if (existingState) {
    existingState.downloadedSegmentIds = mergeObjectIds(existingState.downloadedSegmentIds, segmentIds);
    existingState.downloadedOffFileIds = mergeObjectIds(existingState.downloadedOffFileIds, offFileIds);
    existingState.lastDownloadedAt = downloadTime;
    existingState.downloadCount = Number(existingState.downloadCount || 0) + 1;
  } else {
    mutableJob.downloadStates.push({
      user: user.id,
      downloadedSegmentIds: mergeObjectIds([], segmentIds),
      downloadedOffFileIds: mergeObjectIds([], offFileIds),
      lastDownloadedAt: downloadTime,
      downloadCount: 1,
    });
  }

  await mutableJob.save();
}

function handleOffAudioUpload(req, res, next) {
  offAudioUpload.array('offFiles', MAX_OFF_FILES)(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `OFF audio file is too large. Maximum allowed size is ${MAX_OFF_FILE_SIZE_MB} MB per file.`,
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        message: `Too many OFF audio files. Maximum allowed count is ${MAX_OFF_FILES}.`,
      });
    }

    return res.status(400).json({ message: error.message || 'OFF audio upload failed.' });
  });
}

function handleBriefImportUpload(req, res, next) {
  briefImportUpload.single('briefDocument')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `Brief document is too large. Maximum allowed size is ${MAX_BRIEF_IMPORT_SIZE_MB} MB.`,
      });
    }

    return res.status(400).json({ message: error.message || 'Brief import failed.' });
  });
}

function handleFinalVideoUpload(req, res, next) {
  finalVideoUpload.single('finalVideo')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Final video file is too large.' });
    }

    return res.status(400).json({ message: error.message || 'Final video upload failed.' });
  });
}

function handleJobMaterialUpload(req, res, next) {
  jobMaterialUpload.array('videos', MAX_JOB_MATERIAL_FILES)(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: `Video fajl je prevelik. Maksimalno je ${MAX_UPLOAD_SIZE_GB} GB po fajlu.`,
      });
    }

    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        message: `Previše video fajlova. Maksimalno je ${MAX_JOB_MATERIAL_FILES} po jobu.`,
      });
    }

    return res.status(400).json({ message: error.message || 'Upload materijala nije uspio.' });
  });
}

async function removeUploadedFiles(files = []) {
  await Promise.all(
    files.map((file) =>
      fs.promises.unlink(file.path).catch((error) => {
        console.warn(`Could not remove uploaded file "${file.path}":`, error.message);
      })
    )
  );
}

function buildSourceMetadata(mediaProbe = {}) {
  return {
    sourceFormat: mediaProbe.container || null,
    sourceCodec: mediaProbe.codec || null,
    sourceResolution: mediaProbe.resolution || null,
    sourceBitrate: mediaProbe.bitrate || null,
    sourceFramerate: mediaProbe.framerate || null,
    sourceDuration: mediaProbe.duration || null,
    sourceAudioCodec: mediaProbe.audioCodec || null,
    sourceAudioChannels: mediaProbe.audioChannels || null,
    sourceAudioSampleRate: mediaProbe.audioSampleRate || null,
  };
}

async function inspectSourceMedia(rawVideoPath) {
  try {
    const mediaProbe = await probeMedia(rawVideoPath);
    return buildSourceMetadata(mediaProbe);
  } catch (error) {
    console.warn(`Could not probe source media "${rawVideoPath}":`, error.message);
    return buildSourceMetadata();
  }
}

async function enqueueOrMarkFailed(videoDoc) {
  try {
    const queueJob = await enqueueVideoProcessing(videoDoc._id);
    videoDoc.processingJobId = queueJob.id.toString();
    await videoDoc.save();
    return { job: queueJob, error: null };
  } catch (error) {
    const queueMessage = getQueueErrorMessage(error);
    videoDoc.processingStatus = 'failed';
    videoDoc.processingError = queueMessage;
    videoDoc.processingCompletedAt = new Date();
    await videoDoc.save();
    return { job: null, error: queueMessage };
  }
}

async function writeRawUploadManifest(rawVideoPath, manifest) {
  try {
    ensureFolderExists(paths.rawManifests);
    await fs.promises.writeFile(
      createRawManifestPath(rawVideoPath),
      JSON.stringify(
        {
          ...manifest,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn('Could not write job material upload manifest:', error.message);
  }
}

function stripRtfToText(value) {
  return String(value || '')
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractBriefText(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return {
      text: String(result.value || '').trim(),
      warnings: (result.messages || []).map((message) => message.message).filter(Boolean),
    };
  }

  const rawText = file.buffer.toString('utf8');

  if (extension === '.rtf') {
    return {
      text: stripRtfToText(rawText),
      warnings: [],
    };
  }

  return {
    text: rawText.trim(),
    warnings: [],
  };
}

function createBriefSummary(text) {
  const cleanedText = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

  if (!cleanedText) return '';
  return cleanedText.length > 280 ? `${cleanedText.slice(0, 277)}...` : cleanedText;
}

function parseSegmentsField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      throw new Error('Segments must be an array.');
    }
    return parsed;
  }

  throw new Error('Segments must be an array.');
}

function parseOptionalArrayField(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return trimmed.split(',').map((item) => item.trim());
    }
  }

  return [];
}

function getPrimaryJobVideo(job) {
  return (job?.segments || []).map((segment) => segment.video).find(Boolean) || null;
}

function getJobMaterialContext(job, body = {}) {
  const primaryVideo = getPrimaryJobVideo(job);
  const dateValue = body.date || primaryVideo?.tagDate || new Date();
  const parsedDate = new Date(dateValue);

  return {
    event: String(body.event || primaryVideo?.event || job.title || 'Job material').trim(),
    location: String(body.location || primaryVideo?.location || '').trim(),
    tagDate: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
  };
}

function sanitizeFilename(value, fallback = 'untitled') {
  const sanitized = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

  return sanitized || fallback;
}

function padOrder(value) {
  return String(value).padStart(2, '0');
}

function formatTime(seconds) {
  const totalSeconds = Math.max(0, Number(seconds) || 0);
  const wholeSeconds = Math.floor(totalSeconds);
  const milliseconds = Math.round((totalSeconds - wholeSeconds) * 1000);
  const date = new Date(0);
  date.setSeconds(wholeSeconds);
  return `${date.toISOString().substr(11, 8)}.${String(milliseconds).padStart(3, '0')}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toISOString();
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

function getVideoSourcePath(video) {
  if (!video) return null;
  return resolveExistingPath(video.rawPath, video.filepath, video.compressedPath, video.previewPath);
}

function getVideoFilename(video, sourcePath) {
  const fallback = sourcePath ? path.basename(sourcePath) : 'source_video';
  return video?.originalFilename || video?.filename || fallback;
}

function buildSegmentFolderName(segment, index) {
  const videoName = getVideoFilename(segment.video, '');
  const title = segment.title || segment.notes || videoName;
  return `${padOrder(index + 1)}_${sanitizeFilename(title)}`;
}

const segmentTypeLabels = {
  sot: 'Izjava / SOT',
  broll: 'Pokrivalica / B-roll',
  standup: 'Standup',
  nat_sound: 'Prirodni ton',
  cutaway: 'Insert / cutaway',
  graphic: 'Grafika',
  lower_third: 'Potpis / lower third',
  do_not_use: 'Ne koristiti',
  other: 'Ostalo',
};

const jobStatusLabels = {
  draft: 'Nacrt',
  submitted: 'Poslano montazi',
  claimed: 'Preuzeto',
  in_edit: 'U montazi',
  needs_info: 'Treba dopuna',
  ready_for_qc: 'Spremno za QC',
  approved: 'Odobreno',
  aired: 'Emitovano',
  archived: 'Arhivirano',
};

const priorityLabels = {
  low: 'Nizak',
  normal: 'Normalan',
  high: 'Visok',
  urgent: 'Hitno',
};

const processingStatusLabels = {
  queued: 'Ceka obradu',
  processing: 'Obrada u toku',
  completed: 'Spremno',
  failed: 'Greska u obradi',
};

function labelFromMap(map, value, fallback = 'N/A') {
  if (!value) return fallback;
  return map[value] || String(value).replace(/_/g, ' ');
}

function formatPackageDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('bs-BA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSegmentRange(entry) {
  return entry.end ? `${entry.start} - ${entry.end}` : `${entry.start} - do kraja / point`;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return 'N/A';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = Number(bytes) || 0;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function buildReporterScriptText(job) {
  return [
    `Prilog: ${job.title}`,
    `Reporter: ${job.reporter?.username || 'N/A'}`,
    `Program: ${job.program || 'N/A'}`,
    `Rok: ${formatPackageDate(job.deadline)}`,
    '',
    'BRIEF / REPORTERSKI TEKST',
    '',
    job.scriptText || job.description || 'Nema unesenog briefa.',
    '',
    'KRATKA UPUTA / SAZETAK',
    '',
    job.description || 'N/A',
    '',
  ].join('\n');
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createDocxParagraph(text) {
  const isHeading = /^[A-ZČĆŽŠĐ /-]+$/.test(String(text || '').trim()) && String(text || '').trim().length > 0;
  const runs = isHeading
    ? `<w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r>`
    : `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

  return `<w:p>${runs}</w:p>`;
}

function createBriefDocxBuffer(job) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    const paragraphs = buildReporterScriptText(job)
      .split(/\r?\n/)
      .map(createDocxParagraph)
      .join('');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, { name: '[Content_Types].xml' });

    archive.append(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`, { name: '_rels/.rels' });

    archive.append(documentXml, { name: 'word/document.xml' });
    archive.finalize();
  });
}

function buildOffAudioEntries(job, offFiles = job.offFiles || []) {
  return (offFiles || []).map((offFile, index) => {
    const sourcePath = resolveExistingPath(offFile.storagePath || offFile.path);
    const extension = path.extname(offFile.originalName || offFile.filename || '');
    const safeExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
    const baseName = sanitizeFilename(
      path.basename(offFile.originalName || offFile.filename || `off_${index + 1}`, extension),
      `off_${index + 1}`
    );
    const packagePath = `OFF/${padOrder(index + 1)}_${baseName}${safeExtension || ''}`;

    return {
      order: index + 1,
      id: offFile._id?.toString() || '',
      originalName: offFile.originalName || offFile.filename || `OFF ${index + 1}`,
      packagePath,
      mimetype: offFile.mimetype || 'audio',
      size: offFile.size || null,
      sizeLabel: formatBytes(offFile.size),
      uploadedAt: formatPackageDate(offFile.uploadedAt),
      sourceAvailable: Boolean(sourcePath),
      sourcePath,
    };
  });
}

function buildSegmentNotes(job, segment, index, sourceZipPath) {
  return [
    `Prilog: ${job.title}`,
    `Segment broj: ${index + 1}`,
    `Naziv segmenta: ${segment.title || 'N/A'}`,
    `Tip segmenta: ${labelFromMap(segmentTypeLabels, segment.type, 'Ostalo')}`,
    `Obavezan: ${segment.required !== false ? 'Da' : 'Ne'}`,
    `Vrijeme pocetka: ${formatTime(segment.startTime)}`,
    `Vrijeme kraja: ${segment.endTime === null || segment.endTime === undefined ? 'N/A' : formatTime(segment.endTime)}`,
    `Fajl u paketu: ${sourceZipPath || 'FAJL NIJE PRONADJEN'}`,
    `Event: ${segment.video?.event || 'N/A'}`,
    `Datum: ${formatPackageDate(segment.video?.tagDate)}`,
    '',
    'Napomena reportera:',
    segment.notes || 'N/A',
    '',
    'Brief / uputa za prilog:',
    job.description || 'N/A',
    '',
  ].join('\n');
}

function escapeCsv(value, delimiter = ';') {
  const text = String(value ?? '');
  if (text.includes(delimiter) || /[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildSegmentsCsv(entries) {
  const header = [
    'Redni broj',
    'Naziv segmenta',
    'Tip segmenta',
    'Vrijeme pocetka',
    'Vrijeme kraja',
    'Raspon',
    'Fajl u paketu',
    'Status fajla',
    'Status obrade',
    'Napomena reportera',
  ];

  const rows = entries.map((entry) => [
    entry.order,
    entry.title,
    labelFromMap(segmentTypeLabels, entry.type, 'Ostalo'),
    entry.start,
    entry.end || 'Do kraja / point',
    formatSegmentRange(entry),
    entry.sourceFile || 'Fajl nije pronadjen',
    entry.sourceAvailable ? 'OK' : 'Nedostaje',
    labelFromMap(processingStatusLabels, entry.processingStatus, entry.processingStatus || 'N/A'),
    entry.notes || '',
  ]);

  return ['\uFEFFsep=;', header, ...rows]
    .map((row) => (Array.isArray(row) ? row.map((value) => escapeCsv(value, ';')).join(';') : row))
    .join('\n');
}

function buildPackageReadme(job, entries, offAudioEntries = []) {
  return [
    `Edit paket: ${job.title}`,
    `Program: ${job.program || 'N/A'}`,
    `Reporter: ${job.reporter?.username || 'N/A'}`,
    `Montazer: ${job.assignedEditor?.username || 'N/A'}`,
    `Rok: ${formatPackageDate(job.deadline)}`,
    `Prioritet: ${labelFromMap(priorityLabels, job.priority, 'Normalan')}`,
    '',
    'Kako koristiti paket:',
    '1. Otvori segments.csv za pregled svih trazenih dijelova u redoslijedu montaze.',
    '2. Svaki numerisani folder je jedan trazeni segment.',
    '3. Video fajl u folderu je puni dostupni master/source fajl.',
    '4. Za tacan in/out koristi Vrijeme pocetka i Vrijeme kraja u segments.csv ili segment_notes.txt.',
    '5. Ako pise "Fajl nije pronadjen", izvorni video nije bio dostupan na serveru u trenutku skidanja paketa.',
    '6. BRIEF_REPORTER.txt sadrzi puni reporterski tekst/brief za prilog.',
    '7. Folder OFF sadrzi tonske OFF fajlove koje je reporter poslao.',
    '8. CHANGELOG_JOB.txt prikazuje naknadne izmjene joba.',
    '',
    'Segmenti:',
    ...entries.map((entry) => `${entry.order}. ${entry.title} / ${formatSegmentRange(entry)} / ${entry.sourceFile || 'FAJL NIJE PRONADJEN'}`),
    '',
    'OFF fajlovi:',
    ...(offAudioEntries.length > 0
      ? offAudioEntries.map((entry) => `${entry.order}. ${entry.originalName} / ${entry.packagePath} / ${entry.sizeLabel}`)
      : ['Nema OFF fajlova u paketu.']),
    '',
  ].join('\n');
}

function buildReadableManifest(job, entries, offAudioEntries = []) {
  return {
    'Opis paketa': 'Pregled edit joba za montazu. Isti podaci su dostupni i u segments.csv za lakse otvaranje u Excelu.',
    Prilog: {
      Naziv: job.title,
      Program: job.program || 'N/A',
      Reporter: job.reporter?.username || 'N/A',
      Montazer: job.assignedEditor?.username || 'Nije dodijeljen',
      Rok: formatPackageDate(job.deadline),
      Prioritet: labelFromMap(priorityLabels, job.priority, 'Normalan'),
      Status: labelFromMap(jobStatusLabels, job.status, job.status || 'N/A'),
      Brief: job.description || 'N/A',
      'Brief / reporterski tekst': job.scriptText || job.description || 'N/A',
    },
    'Upute za montazu': [
      'Segmenti su poredani redoslijedom kojim ih je reporter poslao.',
      'Vrijeme pocetka i Vrijeme kraja govore koji dio fajla reporter trazi.',
      'Ako je Fajl u paketu prazan ili pise da nedostaje, taj izvorni fajl nije pronadjen na serveru.',
      'Napomena reportera je prakticna uputa za konkretan segment.',
      'BRIEF_REPORTER.txt sadrzi puni reporterski tekst/brief.',
      'OFF fajlovi su u folderu OFF.',
    ],
    'OFF fajlovi': offAudioEntries.map((entry) => ({
      'Redni broj': entry.order,
      'Originalni naziv': entry.originalName,
      'Fajl u paketu': entry.packagePath,
      Velicina: entry.sizeLabel,
      'Status fajla': entry.sourceAvailable ? 'OK' : 'Nedostaje',
    })),
    'Naknadne izmjene': (job.changeLog || []).map((change) => ({
      Vrijeme: formatPackageDate(change.createdAt),
      Autor: change.author?.username || 'N/A',
      Tip: labelFromMap(changeTypeLabels, change.type, change.type || 'N/A'),
      Opis: change.summary || 'N/A',
    })),
    'Segmenti za montazu': entries.map((entry) => ({
      'Redni broj': entry.order,
      'Naziv segmenta': entry.title,
      'Tip segmenta': labelFromMap(segmentTypeLabels, entry.type, 'Ostalo'),
      'Vrijeme pocetka': entry.start,
      'Vrijeme kraja': entry.end || 'Do kraja / point',
      Raspon: formatSegmentRange(entry),
      'Fajl u paketu': entry.sourceFile || 'Fajl nije pronadjen',
      'Status fajla': entry.sourceAvailable ? 'OK' : 'Nedostaje',
      'Status obrade': labelFromMap(processingStatusLabels, entry.processingStatus, entry.processingStatus || 'N/A'),
      'Napomena reportera': entry.notes || 'N/A',
    })),
    'Tehnicki podaci': {
      'Job ID': String(job._id),
      'Broj segmenata': entries.length,
    },
  };
}

const changeTypeLabels = {
  job_created: 'Job kreiran',
  brief_updated: 'Brief promijenjen',
  segments_added: 'Materijal dodan',
  segment_removed: 'Materijal uklonjen',
  segment_replaced: 'Materijal zamijenjen',
  off_added: 'OFF dodan',
  reporter_note_added: 'Napomena dodana',
  final_uploaded: 'Finalni prilog uploadovan',
  final_approved: 'Final odobren',
  final_rejected: 'Final odbijen',
  status_updated: 'Status promijenjen',
};

function buildChangeLogText(job) {
  const changes = job.changeLog || [];

  return [
    `Prilog: ${job.title}`,
    '',
    'HISTORIJA IZMJENA JOBA',
    '',
    ...(changes.length > 0
      ? changes.map((change, index) => [
          `${index + 1}. ${formatPackageDate(change.createdAt)}`,
          `Tip: ${labelFromMap(changeTypeLabels, change.type, change.type || 'N/A')}`,
          `Autor: ${change.author?.username || 'N/A'}`,
          `Opis: ${change.summary || 'N/A'}`,
        ].join('\n'))
      : ['Nema zabiljezenih izmjena.']),
    '',
  ].join('\n\n');
}

function normalizeSegment(segment, index) {
  const startTime = Number(segment.startTime);
  const endTime = segment.endTime === null || segment.endTime === undefined
    ? null
    : Number(segment.endTime);

  if (!mongoose.Types.ObjectId.isValid(segment.video)) {
    throw new Error('Invalid segment video id.');
  }

  if (!Number.isFinite(startTime) || startTime < 0) {
    throw new Error('Segment start time must be a valid positive number.');
  }

  if (endTime !== null && (!Number.isFinite(endTime) || endTime < startTime)) {
    throw new Error('Segment end time must be greater than start time.');
  }

  const type = allowedSegmentTypes.includes(segment.type) ? segment.type : 'other';

  return {
    video: segment.video,
    order: Number.isFinite(Number(segment.order)) ? Number(segment.order) : index,
    title: segment.title || '',
    notes: segment.notes || '',
    type,
    startTime,
    endTime,
    sourceInMarker: segment.sourceInMarker || '',
    sourceOutMarker: segment.sourceOutMarker || '',
    required: segment.required !== false,
  };
}

function parsePagination(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function buildJobFilter(query = {}, user) {
  const filter = {};
  const andConditions = [];

  if (user.role === 'Reporter') {
    filter.reporter = user.id;
  }

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.priority && query.priority !== 'all') {
    filter.priority = query.priority;
  }

  if (query.workspaceState === 'history') {
    filter.workspaceState = { $in: ['expired', 'closed', 'cancelled'] };
  } else if (query.workspaceState && query.workspaceState !== 'all') {
    filter.workspaceState = query.workspaceState;
  } else if (query.includeClosed !== 'true') {
    andConditions.push({
      $or: [
        { workspaceState: 'active' },
        { workspaceState: { $exists: false } },
      ],
    });
  }

  if (query.contentTypeId && query.contentTypeId !== 'all') {
    filter.contentType = query.contentTypeId;
  }

  if (query.assignedEditor && query.assignedEditor !== 'all') {
    if (query.assignedEditor === 'unassigned') {
      andConditions.push({
        $or: [
          { assignedEditor: { $exists: false } },
          { assignedEditor: null },
        ],
      });
    } else {
      filter.assignedEditor = query.assignedEditor;
    }
  }

  if (query.jobKind && query.jobKind !== 'all') {
    filter.jobKind = query.jobKind;
  }

  const now = new Date();
  if (query.deadlineState === 'overdue') {
    filter.deadline = { $lt: now };
  } else if (query.deadlineState === 'due_soon') {
    filter.deadline = { $gte: now, $lte: new Date(now.getTime() + 2 * 60 * 60 * 1000) };
  } else if (query.deadlineState === 'no_deadline') {
    andConditions.push({
      $or: [
        { deadline: { $exists: false } },
        { deadline: null },
      ],
    });
  }

  const search = String(query.q || '').trim();
  addTextSearchFilter(filter, search);

  if (andConditions.length > 0) {
    filter.$and = [...(filter.$and || []), ...andConditions];
  }

  return filter;
}

function buildJobSort(query = {}) {
  const sortBy = String(query.sortBy || 'updatedAt');
  const sortOrder = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1;
  const sortFields = {
    updatedAt: 'updatedAt',
    createdAt: 'createdAt',
    deadline: 'deadline',
    expiresAt: 'expiresAt',
    priority: 'priority',
    status: 'status',
    workspaceState: 'workspaceState',
    title: 'title',
  };
  const field = sortFields[sortBy] || 'updatedAt';
  return { [field]: sortOrder, updatedAt: -1, createdAt: -1 };
}

async function buildJobSummary(filter, user) {
  const [
    total,
    submitted,
    inEdit,
    needsInfo,
    ready,
    expired,
    closed,
    cancelled,
    overdue,
    dueSoon,
    corrections,
    sampleJobs,
  ] = await Promise.all([
    EditJob.countDocuments(filter),
    EditJob.countDocuments({ ...filter, status: { $in: ['submitted', 'draft'] } }),
    EditJob.countDocuments({ ...filter, status: { $in: ['claimed', 'in_edit'] } }),
    EditJob.countDocuments({ ...filter, status: 'needs_info' }),
    EditJob.countDocuments({ ...filter, status: { $in: ['ready_for_qc', 'approved'] } }),
    EditJob.countDocuments({ ...filter, workspaceState: 'expired' }),
    EditJob.countDocuments({ ...filter, workspaceState: 'closed' }),
    EditJob.countDocuments({ ...filter, workspaceState: 'cancelled' }),
    EditJob.countDocuments({ ...filter, workspaceState: 'active', deadline: { $lt: new Date() } }),
    EditJob.countDocuments({
      ...filter,
      workspaceState: 'active',
      deadline: { $gte: new Date(), $lte: new Date(Date.now() + 2 * 60 * 60 * 1000) },
    }),
    EditJob.countDocuments({ ...filter, jobKind: 'correction' }),
    populateJob(EditJob.find(filter).sort({ updatedAt: -1 }).limit(500)),
  ]);

  const serializedSample = sampleJobs.map((job) => serializeJob(job, user));

  return {
    total,
    submitted,
    inEdit,
    needsInfo,
    ready,
    expired,
    closed,
    cancelled,
    overdue,
    dueSoon,
    corrections,
    unreadUpdates: serializedSample.filter((job) => job.viewerMeta?.hasUnreadChanges).length,
    missingFiles: serializedSample.filter((job) => job.downloadMeta?.hasMissingFiles).length,
    sampledForSignals: serializedSample.length,
  };
}

async function populateJob(query) {
  return query
    .populate('reporter', 'username role')
    .populate('assignedEditor', 'username role')
    .populate('contentType', 'name slug autoExpireJobs jobSlaHours jobGraceHours')
    .populate('workspaceStateChangedBy', 'username role')
    .populate('parentJob', 'title status workspaceState')
    .populate('sourceVideo', 'filename originalFilename finalTitle correctionStatus')
    .populate('correctionRequest', 'status note timestamp')
    .populate('segments.video', 'filename originalFilename event location tagDate duration status processingStatus qcStatus broadcastStatus')
    .populate('comments.author', 'username role')
    .populate('changeLog.author', 'username role')
    .populate('viewerStates.user', 'username role')
    .populate('downloadStates.user', 'username role');
}

router.get('/workspace', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = buildJobFilter(req.query, req.user);
    const sort = buildJobSort(req.query);

    const [total, jobs, summary] = await Promise.all([
      EditJob.countDocuments(filter),
      populateJob(
        EditJob.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
      ),
      buildJobSummary(filter, req.user),
    ]);

    res.json({
      items: jobs.map((job) => serializeJob(job, req.user)),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary,
    });
  } catch (error) {
    console.error('Error fetching edit job workspace:', error);
    res.status(500).json({ message: 'Error fetching edit job workspace' });
  }
});

router.get('/', async (req, res) => {
  try {
    const filter = buildJobFilter(req.query, req.user);

    const jobs = await populateJob(
      EditJob.find(filter).sort({ updatedAt: -1, createdAt: -1 })
    );

    res.json(jobs.map((job) => serializeJob(job, req.user)));
  } catch (error) {
    console.error('Error fetching edit jobs:', error);
    res.status(500).json({ message: 'Error fetching edit jobs' });
  }
});

router.post('/admin/apply-sla', authorize(['Admin']), async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.body?.jobIds)
      ? req.body.jobIds.filter((id) => mongoose.Types.ObjectId.isValid(id)).slice(0, 500)
      : [];
    const filter = {
      workspaceState: { $in: ['active', null] },
      expiresAt: null,
    };
    if (requestedIds.length > 0) filter._id = { $in: requestedIds };

    const jobs = await EditJob.find(filter)
      .populate('contentType', 'name slug autoExpireJobs jobSlaHours jobGraceHours')
      .limit(500);
    let applied = 0;
    let skipped = 0;

    for (const job of jobs) {
      if (!job.contentType || job.contentType.autoExpireJobs === false) {
        skipped += 1;
        continue;
      }
      applySlaToJob(job, job.contentType, { deadline: job.deadline || null });
      job.workspaceState = job.workspaceState || 'active';
      await job.save();
      applied += 1;
    }

    await AuditLog.create({
      action: 'Apply Edit Job SLA',
      performedBy: req.user.id,
      details: {
        requestedCount: requestedIds.length,
        scanned: jobs.length,
        applied,
        skipped,
      },
    });

    res.json({ message: 'SLA je primijenjen na odabrane jobove.', scanned: jobs.length, applied, skipped });
  } catch (error) {
    console.error('Error applying edit job SLA:', error);
    res.status(500).json({ message: 'SLA nije moguće primijeniti.' });
  }
});

router.patch('/:jobId/admin', authorize(['Admin']), async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job nije pronadjen.' });

    const changes = [];
    if (req.body.status !== undefined) {
      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({ message: 'Neispravan workflow status.' });
      }
      changes.push(`status ${job.status} -> ${req.body.status}`);
      job.status = req.body.status;
    }

    if (req.body.workspaceState !== undefined) {
      if (!allowedWorkspaceStates.includes(req.body.workspaceState)) {
        return res.status(400).json({ message: 'Neispravno stanje radnog prostora.' });
      }
      changes.push(`workspace ${job.workspaceState || 'active'} -> ${req.body.workspaceState}`);
      job.workspaceState = req.body.workspaceState;
      job.workspaceStateChangedAt = new Date();
      job.workspaceStateChangedBy = req.user.id;
      job.workspaceStateReason = String(req.body.workspaceStateReason || '').trim();
    }

    if (req.body.priority !== undefined) {
      if (!allowedPriorities.includes(req.body.priority)) {
        return res.status(400).json({ message: 'Neispravan prioritet.' });
      }
      changes.push(`prioritet ${job.priority} -> ${req.body.priority}`);
      job.priority = req.body.priority;
    }

    if (req.body.assignedEditorId !== undefined) {
      const editorId = String(req.body.assignedEditorId || '').trim();
      if (editorId) {
        const editor = await User.findOne({
          _id: editorId,
          role: { $in: ['Editor', 'VideoEditor'] },
        }).select('_id username role');
        if (!editor) return res.status(400).json({ message: 'Odabrani montažer nije dostupan.' });
        job.assignedEditor = editor._id;
        if (['draft', 'submitted', 'needs_info'].includes(job.status)) job.status = 'claimed';
        changes.push(`montažer -> ${editor.username}`);
      } else {
        job.assignedEditor = null;
        changes.push('montažer uklonjen');
      }
    }

    let contentType = null;
    if (req.body.contentTypeId !== undefined) {
      contentType = await BroadcastContentType.findOne({
        _id: req.body.contentTypeId,
        active: true,
      });
      if (!contentType) return res.status(400).json({ message: 'Odabrana kategorija nije dostupna.' });
      job.contentType = contentType._id;
      changes.push(`kategorija -> ${contentType.name}`);
    } else if (job.contentType) {
      contentType = await BroadcastContentType.findById(job.contentType);
    }

    if (req.body.deadline !== undefined || req.body.contentTypeId !== undefined) {
      const deadline = req.body.deadline ? new Date(req.body.deadline) : job.deadline;
      if (req.body.deadline && Number.isNaN(deadline.getTime())) {
        return res.status(400).json({ message: 'Neispravan rok.' });
      }
      if (contentType) {
        applySlaToJob(job, contentType, { deadline: deadline || null });
      } else {
        job.deadline = deadline || null;
        job.expiresAt = null;
      }
      changes.push(`rok -> ${job.deadline ? job.deadline.toISOString() : 'bez roka'}`);
    }

    if (job.workspaceState === 'active' && job.expiresAt && new Date(job.expiresAt) <= new Date()) {
      job.expiresAt = contentType
        ? calculateJobSchedule(contentType, { createdAt: new Date(), deadline: null }).expiresAt
        : null;
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: 'Nema promjena za spremanje.' });
    }

    addJobChange(job, req.user, 'status_updated', `Admin izmjena: ${changes.join(', ')}`, {
      changes,
    });
    await job.save();

    await AuditLog.create({
      action: 'Admin Manage Edit Job',
      performedBy: req.user.id,
      details: { jobId: job._id, title: job.title, changes },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({ message: 'Job je ažuriran.', job: serializeJob(populatedJob, req.user) });
  } catch (error) {
    console.error('Error managing edit job:', error);
    res.status(500).json({ message: error.message || 'Job nije moguće ažurirati.' });
  }
});

router.post('/import-brief', handleBriefImportUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Brief document is required.' });
    }

    const result = await extractBriefText(req.file);

    if (!result.text) {
      return res.status(400).json({ message: 'No readable text was found in the selected document.' });
    }

    res.json({
      filename: req.file.originalname,
      text: result.text,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error('Error importing brief document:', error);
    res.status(400).json({ message: error.message || 'Brief document could not be imported.' });
  }
});

router.post('/', handleOffAudioUpload, async (req, res) => {
  const {
    title,
    description,
    scriptText,
    program,
    contentTypeId,
    deadline,
    priority = 'normal',
    status = 'submitted',
    comment,
  } = req.body;

  let segments = [];

  try {
    segments = parseSegmentsField(req.body.segments);
  } catch (error) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: error.message || 'Invalid segments payload.' });
  }

  if (!title || !title.trim()) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: 'Job title is required.' });
  }

  if (!allowedPriorities.includes(priority)) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: 'Invalid priority.' });
  }

  if (!allowedStatuses.includes(status)) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: 'Invalid job status.' });
  }

  if (!mongoose.Types.ObjectId.isValid(contentTypeId)) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: 'Aktivna kategorija joba je obavezna.' });
  }

  try {
    const contentType = await BroadcastContentType.findOne({
      _id: contentTypeId,
      active: true,
    });
    if (!contentType) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Aktivna kategorija joba je obavezna.' });
    }

    const normalizedSegments = segments.map(normalizeSegment);
    const videoIds = Array.from(new Set(normalizedSegments.map((segment) => segment.video.toString())));
    const videoCount = await Video.countDocuments({ _id: { $in: videoIds } });

    if (videoCount !== videoIds.length) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'One or more selected videos do not exist.' });
    }

    const offFiles = (req.files || []).map((file) => ({
      originalName: file.originalname,
      filename: file.filename,
      storagePath: file.path,
      mimetype: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
    }));
    const normalizedScriptText = scriptText || '';
    const normalizedDescription = description || createBriefSummary(normalizedScriptText);

    const job = new EditJob({
      title: title.trim(),
      description: normalizedDescription,
      scriptText: normalizedScriptText,
      offFiles,
      program: program || '',
      contentType: contentType._id,
      priority,
      status,
      workspaceState: 'active',
      jobKind: 'standard',
      reporter: req.user.id,
      segments: normalizedSegments,
      comments: comment
        ? [{
            body: comment,
            author: req.user.id,
          }]
        : [],
    });
    applySlaToJob(job, contentType, {
      deadline: deadline ? new Date(deadline) : null,
    });

    addJobChange(job, req.user, 'job_created', 'Job created and sent to production.', {
      segmentCount: normalizedSegments.length,
      offFileCount: offFiles.length,
      hasBriefText: Boolean(normalizedScriptText),
      contentTypeId: contentType._id,
      expiresAt: job.expiresAt,
    });

    await job.save();

    await AuditLog.create({
      action: 'Create Edit Job',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        segmentCount: job.segments.length,
        offFileCount: job.offFiles.length,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.status(201).json({
      message: 'Edit job created successfully',
      job: serializeJob(populatedJob, req.user),
    });
  } catch (error) {
    await removeUploadedFiles(req.files);
    console.error('Error creating edit job:', error);
    res.status(400).json({ message: error.message || 'Error creating edit job' });
  }
});

router.delete('/:jobId', async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId)
      .populate('reporter', 'username role')
      .populate('assignedEditor', 'username role');

    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canReporterUpdateJob(req.user, job)) {
      return res.status(403).json({ message: 'Only the job reporter or admin can delete this job.' });
    }

    if (
      ['aired', 'archived'].includes(job.status)
      || (job.workspaceState && job.workspaceState !== 'active' && req.user.role !== 'Admin')
    ) {
      return res.status(409).json({ message: 'Aired or archived jobs cannot be deleted.' });
    }

    const finalVideoCount = await Video.countDocuments({ sourceJob: job._id });
    if (finalVideoCount > 0) {
      return res.status(409).json({ message: 'This job has final videos attached and cannot be deleted safely.' });
    }

    const segmentVideoIds = (job.segments || []).map((segment) => segment.video).filter(Boolean);
    const rundownReferenceCount = segmentVideoIds.length > 0
      ? await ShowDay.countDocuments({ 'items.video': { $in: segmentVideoIds } })
      : 0;
    if (rundownReferenceCount > 0) {
      return res.status(409).json({ message: 'Job ima materijal povezan sa rundownom i ne može se sigurno obrisati.' });
    }

    const deletedInfo = {
      jobId: job._id,
      title: job.title,
      status: job.status,
      reporter: job.reporter
        ? {
          id: job.reporter._id,
          username: job.reporter.username,
        }
        : null,
      segmentCount: job.segments?.length || 0,
      offFileCount: job.offFiles?.length || 0,
    };

    await Promise.all((job.offFiles || []).map((offFile) => {
      const sourcePath = resolveExistingPath(offFile.storagePath || offFile.path);
      if (!sourcePath) return Promise.resolve();

      const resolvedOffRoot = path.resolve(paths.offAudio);
      const resolvedSource = path.resolve(sourcePath);
      if (
        resolvedSource !== resolvedOffRoot &&
        !resolvedSource.startsWith(`${resolvedOffRoot}${path.sep}`)
      ) {
        return Promise.resolve();
      }

      return fs.promises.unlink(resolvedSource).catch((error) => {
        console.warn(`Could not delete OFF file for deleted job "${job._id}":`, error.message);
      });
    }));

    await job.deleteOne();

    await AuditLog.create({
      action: 'Delete Edit Job',
      performedBy: req.user.id,
      details: deletedInfo,
    });

    res.json({ message: 'Edit job deleted.', deleted: deletedInfo });
  } catch (error) {
    console.error('Error deleting edit job:', error);
    res.status(500).json({ message: 'Error deleting edit job' });
  }
});

router.get('/:jobId/download-package', authorize(productionRoles), async (req, res) => {
  try {
    await streamEditPackage({
      user: req.user,
      payload: {
        jobId: req.params.jobId,
        scope: req.query.scope,
      },
      res,
    });
  } catch (error) {
    console.error('Error creating edit package:', error);
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ message: error.message || 'Error creating edit package' });
    }
  }
});

router.get('/:jobId/off-files/:fileId', async (req, res) => {
  try {
    await streamOffFile({
      user: req.user,
      payload: {
        jobId: req.params.jobId,
        fileId: req.params.fileId,
        inline: true,
      },
      res,
    });
  } catch (error) {
    console.error('Error serving OFF audio file:', error);
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ message: error.message || 'Error serving OFF audio file' });
    }
  }
});

router.get('/:jobId/final-videos', async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const videos = await Video.find({ sourceJob: job._id })
      .populate('program')
      .populate('contentType')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('finalApprovedBy', 'username role')
      .sort({ uploadDate: -1 });

    res.json(videos);
  } catch (error) {
    console.error('Error fetching job final videos:', error);
    res.status(500).json({ message: 'Error fetching job final videos' });
  }
});

router.post('/:jobId/material-upload', handleJobMaterialUpload, async (req, res) => {
  const uploadedFiles = req.files || [];
  const retainedSourcePaths = new Set();

  if (uploadedFiles.length === 0) {
    return res.status(400).json({ message: 'Odaberi barem jedan video fajl.' });
  }

  try {
    const job = await EditJob.findById(req.params.jobId)
      .populate('segments.video', 'event location tagDate duration');

    if (!job) {
      await removeUploadedFiles(uploadedFiles);
      return res.status(404).json({ message: 'Edit job nije pronadjen.' });
    }

    if (!canReporterUpdateJob(req.user, job)) {
      await removeUploadedFiles(uploadedFiles);
      return res.status(403).json({ message: 'Samo reporter ovog joba ili admin mogu dodati materijal.' });
    }

    if (
      ['aired', 'archived'].includes(job.status)
      || (job.workspaceState && job.workspaceState !== 'active' && req.user.role !== 'Admin')
    ) {
      await removeUploadedFiles(uploadedFiles);
      return res.status(409).json({ message: 'Emitovani ili arhivirani jobovi se ne mogu mijenjati.' });
    }

    const context = getJobMaterialContext(job, req.body);
    const notes = parseOptionalArrayField(req.body.notes);
    const types = parseOptionalArrayField(req.body.types);
    const existingOrders = (job.segments || []).map((item) => Number(item.order || 0));
    const baseOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;
    const createdVideoIds = [];
    const queueFailures = [];
    const auditFiles = [];

    ensureFolderExists(paths.compressed);
    ensureFolderExists(paths.previews);
    ensureFolderExists(paths.thumbnails);

    for (let index = 0; index < uploadedFiles.length; index += 1) {
      const file = uploadedFiles[index];
      const outputFilename = createMp4Filename('compressed', file.originalname);
      const outputPath = path.join(paths.compressed, outputFilename);
      const previewFilename = createMp4Filename('preview', file.originalname);
      const previewPath = path.join(paths.previews, previewFilename);
      const thumbnailFilename = createJpgFilename('thumb', file.originalname);
      const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);
      const inputStats = fs.existsSync(file.path) ? fs.statSync(file.path) : null;
      const sourceMetadata = await inspectSourceMedia(file.path);
      const segmentType = allowedSegmentTypes.includes(types[index]) ? types[index] : 'other';

      await writeRawUploadManifest(file.path, {
        uploadKind: 'job-material-upload',
        originalFilename: file.originalname,
        uploaderId: req.user.id,
        uploaderUsername: req.user.username,
        uploaderRole: req.user.role,
        jobId: job._id,
        event: context.event,
        location: context.location,
        tagDate: context.tagDate,
        status: 'raw',
        processingMode: 'transcode',
      });

      const videoDoc = new Video({
        filename: outputFilename,
        filepath: outputPath,
        originalFilename: file.originalname,

        rawPath: file.path,
        compressedPath: outputPath,
        previewPath,
        thumbnailPath,

        uploader: req.user.id,
        reporter: job.reporter,
        event: context.event,
        location: context.location,
        tagDate: context.tagDate,

        status: 'raw',
        processingStatus: 'queued',
        processingMode: 'transcode',
        processingProgress: 0,
        isBroll: segmentType === 'broll',
        ...sourceMetadata,

        sizeOriginal: inputStats ? inputStats.size : null,
        sizeCompressed: null,
        sizePreview: null,
        sizeThumbnail: null,
        duration: sourceMetadata.sourceDuration,

        rawRetentionDays: 0,
        rawExpiresAt: null,
        rawDeleted: false,
        rawDeletedAt: null,

        uploadDate: new Date(),
      });

      await videoDoc.save();
      retainedSourcePaths.add(file.path);
      const enqueueResult = await enqueueOrMarkFailed(videoDoc);
      if (enqueueResult.error) {
        queueFailures.push({
          originalFilename: file.originalname,
          error: enqueueResult.error,
        });
      }

      createdVideoIds.push(videoDoc._id);
      job.segments.push(normalizeSegment({
        video: videoDoc._id,
        order: baseOrder + index,
        title: file.originalname,
        notes: notes[index] || '',
        type: segmentType,
        startTime: 0,
        endTime: Number(sourceMetadata.sourceDuration) || null,
        required: true,
      }, baseOrder + index));

      auditFiles.push({
        originalFilename: file.originalname,
        storedFilename: outputFilename,
        previewFilename,
        thumbnailFilename,
        queueError: enqueueResult.error || null,
      });
    }

    addJobChange(job, req.user, 'segments_added', `Dodano ${createdVideoIds.length} novi(h) klip(ova) direktnim uploadom.`, {
      segmentCount: createdVideoIds.length,
      uploadMode: 'job-material-upload',
    });

    if (job.status === 'needs_info') {
      job.status = job.assignedEditor ? 'claimed' : 'submitted';
    }

    await job.save();

    await AuditLog.create({
      action: 'Upload Job Material',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        count: createdVideoIds.length,
        files: auditFiles,
      },
    });

    const [populatedJob, populatedVideos] = await Promise.all([
      populateJob(EditJob.findById(job._id)),
      Video.find({ _id: { $in: createdVideoIds } })
        .populate('uploader', 'username role')
        .populate('reporter', 'username role')
        .populate('editor', 'username role')
        .populate('qaResponsible', 'username role')
        .populate('program')
        .populate('contentType'),
    ]);

    res.status(202).json({
      message: queueFailures.length > 0
        ? `Materijal je dodan u job, ali ${queueFailures.length} fajl(ova) treba ponovo staviti u obradu.`
        : 'Materijal je uploadovan i dodan u job.',
      job: serializeJob(populatedJob, req.user),
      videos: populatedVideos,
      queueFailures,
    });
  } catch (error) {
    await removeUploadedFiles(uploadedFiles.filter((file) => !retainedSourcePaths.has(file.path)));
    console.error('Error uploading job material:', error);
    res.status(500).json({ message: error.message || 'Upload materijala u job nije uspio.' });
  }
});

router.post('/:jobId/final-upload', authorize(['Editor', 'VideoEditor', 'Admin']), handleFinalVideoUpload, async (req, res) => {
  const {
    programId,
    contentTypeId,
    airDate,
    finalTitle,
    notes = '',
  } = req.body;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Final video file is required.' });
    }

    const job = await EditJob.findById(req.params.jobId);
    if (!job) {
      await removeUploadedFiles([req.file]);
      return res.status(404).json({ message: 'Edit job not found.' });
    }

    if (!canUploadFinalForJob(req.user, job)) {
      await removeUploadedFiles([req.file]);
      return res.status(403).json({ message: 'Only the assigned editor can upload the final video for this job.' });
    }

    const program = await BroadcastProgram.findById(programId);
    if (!program || !program.active) {
      await removeUploadedFiles([req.file]);
      return res.status(400).json({ message: 'Active broadcast program is required.' });
    }

    const contentType = await BroadcastContentType.findById(contentTypeId);
    if (!contentType || !contentType.active) {
      await removeUploadedFiles([req.file]);
      return res.status(400).json({ message: 'Active content type is required.' });
    }

    const parsedAirDate = airDate ? new Date(`${airDate}T00:00:00.000Z`) : null;
    if (!parsedAirDate || Number.isNaN(parsedAirDate.getTime())) {
      await removeUploadedFiles([req.file]);
      return res.status(400).json({ message: 'Valid air date is required.' });
    }

    ensureFolderExists(paths.final);
    ensureFolderExists(paths.previews);
    ensureFolderExists(paths.thumbnails);

    const finalFilename = createStoredFilename('final', req.file.originalname);
    const finalPath = path.join(paths.final, finalFilename);
    const previewFilename = createMp4Filename('preview', req.file.originalname);
    const previewPath = path.join(paths.previews, previewFilename);
    const thumbnailFilename = createJpgFilename('thumb', req.file.originalname);
    const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);
    const inputStats = fs.existsSync(req.file.path) ? fs.statSync(req.file.path) : null;
    const title = finalTitle || job.title || req.file.originalname;

    const videoDoc = new Video({
      filename: finalFilename,
      filepath: finalPath,
      originalFilename: req.file.originalname,
      rawPath: req.file.path,
      compressedPath: finalPath,
      previewPath,
      thumbnailPath,
      uploader: req.user.id,
      reporter: job.reporter,
      editor: req.user.id,
      event: job.title,
      location: '',
      tagDate: parsedAirDate,
      status: 'edited',
      processingStatus: 'queued',
      processingMode: 'finalize',
      processingProgress: 0,
      qcStatus: 'pending',
      broadcastStatus: 'qc_pending',
      sourceJob: job._id,
      program: program._id,
      contentType: contentType._id,
      airDate: parsedAirDate,
      finalTitle: title,
      finalCategory: contentType.slug,
      finalApprovalStatus: 'pending',
      finalApprovalNotes: notes,
      qaResponsible: job.reporter,
      qaResponsibilityType: 'job_reporter',
      keywords: [program.name, contentType.name, job.title].filter(Boolean),
      sizeOriginal: inputStats ? inputStats.size : null,
      uploadDate: new Date(),
    });

    await videoDoc.save();

    let queueMessage = '';
    try {
      const queueJob = await enqueueVideoProcessing(videoDoc._id);
      videoDoc.processingJobId = queueJob.id.toString();
      await videoDoc.save();
    } catch (queueError) {
      queueMessage = getQueueErrorMessage(queueError);
      videoDoc.processingStatus = 'failed';
      videoDoc.processingError = queueMessage;
      videoDoc.processingCompletedAt = new Date();
      await videoDoc.save();
    }

    addJobChange(job, req.user, 'final_uploaded', `Final video uploaded: ${title}.`, {
      videoId: videoDoc._id,
      programId: program._id,
      contentTypeId: contentType._id,
      airDate: parsedAirDate,
    });
    job.status = 'ready_for_qc';
    await job.save();
    if (job.jobKind === 'correction' && job.correctionRequest) {
      await CorrectionRequest.findByIdAndUpdate(job.correctionRequest, {
        $set: {
          status: 'ready_for_review',
          assignedEditor: req.user.id,
          correctedBy: req.user.id,
          correctedAt: new Date(),
          correctedVideo: videoDoc._id,
          seenBy: [],
        },
      });
    }

    await AuditLog.create({
      action: 'Upload Final Video From Job',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        videoId: videoDoc._id,
        programId: program._id,
        contentTypeId: contentType._id,
        airDate: parsedAirDate,
        jobKind: job.jobKind,
        correctionRequestId: job.correctionRequest || null,
        correctedBy: job.jobKind === 'correction' ? req.user.id : null,
      },
    });

    const populatedVideo = await Video.findById(videoDoc._id)
      .populate('program')
      .populate('contentType')
      .populate('sourceJob', 'title reporter')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role');
    const populatedJob = await populateJob(EditJob.findById(job._id));

    res.status(202).json({
      message: queueMessage
        ? `Final video saved, but processing could not be queued: ${queueMessage}`
        : 'Final video uploaded and queued for processing. Approval is required before air.',
      video: populatedVideo,
      job: serializeJob(populatedJob, req.user),
    });
  } catch (error) {
    await removeUploadedFiles(req.file ? [req.file] : []);
    console.error('Error uploading final video:', error);
    res.status(500).json({ message: error.message || 'Error uploading final video' });
  }
});

router.patch('/:jobId/reporter-update', handleOffAudioUpload, async (req, res) => {
  const {
    description,
    scriptText,
    comment,
  } = req.body;

  let segments = [];

  try {
    segments = parseSegmentsField(req.body.segments);
  } catch (error) {
    await removeUploadedFiles(req.files);
    return res.status(400).json({ message: error.message || 'Invalid segments payload.' });
  }

  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) {
      await removeUploadedFiles(req.files);
      return res.status(404).json({ message: 'Edit job not found' });
    }

    if (!canReporterUpdateJob(req.user, job)) {
      await removeUploadedFiles(req.files);
      return res.status(403).json({ message: 'Only the job reporter can update this job.' });
    }

    if (
      ['aired', 'archived'].includes(job.status)
      || (job.workspaceState && job.workspaceState !== 'active' && req.user.role !== 'Admin')
    ) {
      await removeUploadedFiles(req.files);
      return res.status(409).json({ message: 'Aired or archived jobs cannot be changed.' });
    }

    const existingOrders = (job.segments || []).map((item) => Number(item.order || 0));
    const baseOrder = existingOrders.length > 0 ? Math.max(...existingOrders) + 1 : 0;
    const normalizedSegments = segments.map((segment, index) => {
      return normalizeSegment({ ...segment, order: baseOrder + index }, baseOrder + index);
    });

    if (normalizedSegments.length > 0) {
      const videoIds = Array.from(new Set(normalizedSegments.map((segment) => segment.video.toString())));
      const videoCount = await Video.countDocuments(buildAppendableVideoFilter(req.user, videoIds));

      if (videoCount !== videoIds.length) {
        await removeUploadedFiles(req.files);
        return res.status(400).json({ message: 'Jedan ili vise odabranih klipova nije dostupno za ovaj job.' });
      }
    }

    const changes = [];
    let addedComment = null;
    const hasDescriptionField = Object.prototype.hasOwnProperty.call(req.body, 'description');
    const hasScriptTextField = Object.prototype.hasOwnProperty.call(req.body, 'scriptText');
    const nextDescription = hasDescriptionField ? (description || '') : job.description;
    const nextScriptText = hasScriptTextField ? (scriptText || '') : job.scriptText;
    const briefChanged =
      (hasDescriptionField && String(job.description || '') !== String(nextDescription || '')) ||
      (hasScriptTextField && String(job.scriptText || '') !== String(nextScriptText || ''));

    if (briefChanged) {
      job.description = nextDescription || createBriefSummary(nextScriptText);
      job.scriptText = nextScriptText || '';
      addJobChange(job, req.user, 'brief_updated', 'Brief / reporterski tekst je promijenjen.', {
        hasBriefText: Boolean(job.scriptText),
      });
      changes.push('brief');
    }

    if (normalizedSegments.length > 0) {
      job.segments.push(...normalizedSegments);
      addJobChange(job, req.user, 'segments_added', `Dodano ${normalizedSegments.length} novi(h) segment(a) / klip(ova).`, {
        segmentCount: normalizedSegments.length,
      });
      changes.push('segments');
    }

    const offFiles = (req.files || []).map((file) => ({
      originalName: file.originalname,
      filename: file.filename,
      storagePath: file.path,
      mimetype: file.mimetype,
      size: file.size,
      uploadedAt: new Date(),
    }));

    if (offFiles.length > 0) {
      job.offFiles.push(...offFiles);
      addJobChange(job, req.user, 'off_added', `Dodano ${offFiles.length} OFF audio fajl(ova).`, {
        offFileCount: offFiles.length,
      });
      changes.push('off');
    }

    if (comment && comment.trim()) {
      const recipientIds = getCommentRecipientIds(job, req.user);
      job.comments.push({
        body: comment.trim(),
        author: req.user.id,
      });
      addedComment = job.comments[job.comments.length - 1];
      addJobChange(
        job,
        req.user,
        'comment_added',
        'Reporter je dodao novu napomenu uz izmjenu.',
        {
          commentId: addedComment._id,
          comment: comment.trim(),
        },
        recipientIds
      );
      changes.push('comment');
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: 'No job updates were provided.' });
    }

    if (job.status === 'needs_info') {
      job.status = job.assignedEditor ? 'claimed' : 'submitted';
    }

    await job.save();

    let notificationsCreated = 0;
    if (addedComment) {
      try {
        notificationsCreated = await createCommentNotifications(job, req.user, addedComment);
      } catch (notificationError) {
        console.error('Reporter update saved, but notifications could not be created:', notificationError);
      }
    }

    await AuditLog.create({
      action: 'Reporter Update Edit Job',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        changes,
        addedSegmentCount: normalizedSegments.length,
        addedOffFileCount: offFiles.length,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({
      message: 'Job updated successfully',
      job: serializeJob(populatedJob, req.user),
      notificationsCreated,
    });
  } catch (error) {
    await removeUploadedFiles(req.files);
    console.error('Error updating edit job:', error);
    res.status(400).json({ message: error.message || 'Error updating edit job' });
  }
});

router.delete('/:jobId/segments/:segmentId', async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canReporterUpdateJob(req.user, job)) {
      return res.status(403).json({ message: 'Only the job reporter can update this job.' });
    }

    if (
      ['aired', 'archived'].includes(job.status)
      || (job.workspaceState && job.workspaceState !== 'active' && req.user.role !== 'Admin')
    ) {
      return res.status(409).json({ message: 'Aired or archived jobs cannot be changed.' });
    }

    const segment = job.segments.id(req.params.segmentId);
    if (!segment) return res.status(404).json({ message: 'Job segment not found.' });

    const deletedInfo = {
      segmentId: getObjectIdString(segment._id),
      videoId: getObjectIdString(segment.video),
      title: segment.title || 'Untitled segment',
      order: segment.order,
    };

    job.segments.pull(segment._id);
    job.segments
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .forEach((item, index) => {
        item.order = index;
      });
    removeObjectIdFromDownloadStates(job, 'downloadedSegmentIds', deletedInfo.segmentId);
    addJobChange(job, req.user, 'segment_removed', `Klip uklonjen iz joba: ${deletedInfo.title}.`, deletedInfo);

    await job.save();

    await AuditLog.create({
      action: 'Remove Edit Job Segment',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        ...deletedInfo,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({
      message: 'Clip removed from job.',
      job: serializeJob(populatedJob, req.user),
    });
  } catch (error) {
    console.error('Error removing edit job segment:', error);
    res.status(500).json({ message: error.message || 'Error removing clip from job' });
  }
});

router.patch('/:jobId/segments/:segmentId/replace', async (req, res) => {
  const {
    videoId,
    title,
    notes,
    type,
    startTime,
    endTime,
    sourceInMarker,
    sourceOutMarker,
    required,
  } = req.body;

  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canReporterUpdateJob(req.user, job)) {
      return res.status(403).json({ message: 'Only the job reporter can update this job.' });
    }

    if (
      ['aired', 'archived'].includes(job.status)
      || (job.workspaceState && job.workspaceState !== 'active' && req.user.role !== 'Admin')
    ) {
      return res.status(409).json({ message: 'Aired or archived jobs cannot be changed.' });
    }

    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ message: 'Replacement video id is invalid.' });
    }

    const segment = job.segments.id(req.params.segmentId);
    if (!segment) return res.status(404).json({ message: 'Job segment not found.' });

    const replacementVideo = await Video.findOne(buildAppendableVideoFilter(req.user, [videoId]))
      .select('filename originalFilename duration');
    if (!replacementVideo) {
      return res.status(404).json({ message: 'Zamjenski klip nije dostupan za ovaj job.' });
    }

    const hasField = (fieldName) => Object.prototype.hasOwnProperty.call(req.body, fieldName);
    const oldSegment = {
      segmentId: getObjectIdString(segment._id),
      videoId: getObjectIdString(segment.video),
      title: segment.title || 'Untitled segment',
    };
    const replacementTitle = hasField('title')
      ? title
      : (replacementVideo.originalFilename || replacementVideo.filename || segment.title || 'Replacement clip');
    const normalizedSegment = normalizeSegment({
      video: videoId,
      order: segment.order,
      title: replacementTitle,
      notes: hasField('notes') ? notes : segment.notes,
      type: hasField('type') ? type : segment.type,
      startTime: hasField('startTime') ? startTime : 0,
      endTime: hasField('endTime') ? (endTime === '' ? null : endTime) : (Number(replacementVideo.duration) || null),
      sourceInMarker: hasField('sourceInMarker') ? sourceInMarker : '',
      sourceOutMarker: hasField('sourceOutMarker') ? sourceOutMarker : '',
      required: hasField('required') ? required : segment.required !== false,
    }, segment.order);

    segment.set(normalizedSegment);
    removeObjectIdFromDownloadStates(job, 'downloadedSegmentIds', segment._id);
    addJobChange(job, req.user, 'segment_replaced', `Klip zamijenjen u jobu: ${oldSegment.title} -> ${normalizedSegment.title}.`, {
      segmentId: oldSegment.segmentId,
      oldVideoId: oldSegment.videoId,
      newVideoId: getObjectIdString(videoId),
      oldTitle: oldSegment.title,
      newTitle: normalizedSegment.title,
    });

    await job.save();

    await AuditLog.create({
      action: 'Replace Edit Job Segment',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        segmentId: oldSegment.segmentId,
        oldVideoId: oldSegment.videoId,
        newVideoId: getObjectIdString(videoId),
        oldTitle: oldSegment.title,
        newTitle: normalizedSegment.title,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({
      message: 'Clip replaced in job.',
      job: serializeJob(populatedJob, req.user),
    });
  } catch (error) {
    console.error('Error replacing edit job segment:', error);
    res.status(400).json({ message: error.message || 'Error replacing clip in job' });
  }
});

router.get('/:jobId', async (req, res) => {
  try {
    const job = await populateJob(EditJob.findById(req.params.jobId));
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const responseJob = serializeJob(job, req.user);
    await Promise.all([
      markJobViewed(job, req.user),
      markJobNotificationsRead(job._id, req.user.id),
    ]);
    responseJob.viewerMeta = {
      lastViewedAt: new Date(),
      unreadChangeCount: 0,
      hasUnreadChanges: false,
    };

    res.json(responseJob);
  } catch (error) {
    console.error('Error fetching edit job:', error);
    res.status(500).json({ message: 'Error fetching edit job' });
  }
});

router.patch('/:jobId/status', async (req, res) => {
  const { status } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid job status.' });
  }

  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (req.user.role === 'Reporter' && !['draft', 'submitted', 'needs_info'].includes(status)) {
      return res.status(403).json({ message: 'Reporter cannot set this status.' });
    }

    job.status = status;
    await job.save();
    if (job.jobKind === 'correction' && job.correctionRequest) {
      const correctionStatus = status === 'in_edit'
        ? 'in_edit'
        : status === 'ready_for_qc'
          ? 'ready_for_review'
          : null;
      if (correctionStatus) {
        const correctionUpdate = { status: correctionStatus, seenBy: [] };
        if (correctionStatus === 'ready_for_review') {
          correctionUpdate.correctedBy = req.user.id;
          correctionUpdate.correctedAt = new Date();
        }
        await CorrectionRequest.findByIdAndUpdate(job.correctionRequest, { $set: correctionUpdate });
      }
    }

    await AuditLog.create({
      action: 'Update Edit Job Status',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
        status,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({ message: 'Job status updated', job: serializeJob(populatedJob, req.user) });
  } catch (error) {
    console.error('Error updating edit job status:', error);
    res.status(500).json({ message: 'Error updating edit job status' });
  }
});

router.patch('/:jobId/claim', authorize(productionRoles), async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    job.assignedEditor = req.user.id;
    if (['draft', 'submitted', 'needs_info'].includes(job.status)) {
      job.status = 'claimed';
    }

    await job.save();
    if (job.jobKind === 'correction' && job.correctionRequest) {
      await CorrectionRequest.findByIdAndUpdate(job.correctionRequest, {
        $set: {
          assignedEditor: req.user.id,
          status: 'assigned',
          seenBy: [],
        },
      });
    }

    await AuditLog.create({
      action: 'Claim Edit Job',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        title: job.title,
      },
    });

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.json({ message: 'Job claimed', job: serializeJob(populatedJob, req.user) });
  } catch (error) {
    console.error('Error claiming edit job:', error);
    res.status(500).json({ message: 'Error claiming edit job' });
  }
});

router.post('/:jobId/comments', async (req, res) => {
  const { body } = req.body;

  if (!body || !body.trim()) {
    return res.status(400).json({ message: 'Comment is required.' });
  }

  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const recipientIds = getCommentRecipientIds(job, req.user);
    job.comments.push({
      body: body.trim(),
      author: req.user.id,
    });
    const comment = job.comments[job.comments.length - 1];
    addJobChange(
      job,
      req.user,
      'comment_added',
      `${req.user.role === 'Reporter' ? 'Reporter' : 'Produkcija'} je dodala novi komentar.`,
      {
        commentId: comment._id,
        comment: body.trim(),
      },
      recipientIds
    );

    await job.save();

    let notificationsCreated = 0;
    try {
      notificationsCreated = await createCommentNotifications(job, req.user, comment);
    } catch (notificationError) {
      console.error('Comment saved, but notifications could not be created:', notificationError);
    }

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.status(201).json({
      message: 'Komentar je dodan.',
      job: serializeJob(populatedJob, req.user),
      notificationsCreated,
    });
  } catch (error) {
    console.error('Error adding edit job comment:', error);
    res.status(500).json({ message: 'Error adding comment' });
  }
});

module.exports = router;
