const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const multer = require('multer');
const mammoth = require('mammoth');
const EditJob = require('../models/EditJob');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const {
  paths,
  ensureFolderExists,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
} = require('../utils/storagePaths');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const {
  allowedVideoExtensions,
  allowedVideoMimetypes,
  supportedVideoFormatSummary,
} = require('../config/mediaFormats');
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const { getQueueErrorMessage } = require('../utils/queueErrors');

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
  if (!isProductionUser(user)) return 0;

  const lastViewedAt = getViewerLastViewedAt(job, user);
  const lastViewedTimestamp = lastViewedAt ? new Date(lastViewedAt).getTime() : 0;

  return (job.changeLog || []).filter((change) => {
    if (change.type === 'job_created') return false;
    if (getObjectIdString(change.author) === user.id) return false;

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
  };
}

async function markJobViewed(job, user) {
  if (!isProductionUser(user)) return;

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

function addJobChange(job, user, type, summary, details = {}) {
  const changeTime = new Date();

  job.changeLog.push({
    type,
    summary,
    author: user.id,
    actorRole: user.role,
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

async function removeUploadedFiles(files = []) {
  await Promise.all(
    files.map((file) =>
      fs.promises.unlink(file.path).catch((error) => {
        console.warn(`Could not remove uploaded OFF file "${file.path}":`, error.message);
      })
    )
  );
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

async function populateJob(query) {
  return query
    .populate('reporter', 'username role')
    .populate('assignedEditor', 'username role')
    .populate('segments.video', 'filename originalFilename event location tagDate duration status processingStatus qcStatus broadcastStatus')
    .populate('comments.author', 'username role')
    .populate('changeLog.author', 'username role')
    .populate('viewerStates.user', 'username role')
    .populate('downloadStates.user', 'username role');
}

router.get('/', async (req, res) => {
  try {
    const filter = {};

    if (req.user.role === 'Reporter') {
      filter.reporter = req.user.id;
    }

    if (req.query.status && req.query.status !== 'all') {
      filter.status = req.query.status;
    }

    const jobs = await populateJob(
      EditJob.find(filter).sort({ updatedAt: -1, createdAt: -1 })
    );

    res.json(jobs.map((job) => serializeJob(job, req.user)));
  } catch (error) {
    console.error('Error fetching edit jobs:', error);
    res.status(500).json({ message: 'Error fetching edit jobs' });
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

  try {
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
      deadline: deadline ? new Date(deadline) : null,
      priority,
      status,
      reporter: req.user.id,
      segments: normalizedSegments,
      comments: comment
        ? [{
            body: comment,
            author: req.user.id,
          }]
        : [],
    });

    addJobChange(job, req.user, 'job_created', 'Job created and sent to production.', {
      segmentCount: normalizedSegments.length,
      offFileCount: offFiles.length,
      hasBriefText: Boolean(normalizedScriptText),
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

    if (['aired', 'archived'].includes(job.status)) {
      return res.status(409).json({ message: 'Aired or archived jobs cannot be deleted.' });
    }

    const finalVideoCount = await Video.countDocuments({ sourceJob: job._id });
    if (finalVideoCount > 0) {
      return res.status(409).json({ message: 'This job has final videos attached and cannot be deleted safely.' });
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
    const job = await EditJob.findById(req.params.jobId)
      .populate('reporter', 'username role')
      .populate('assignedEditor', 'username role')
      .populate('changeLog.author', 'username role')
      .populate('downloadStates.user', 'username role')
      .populate(
        'segments.video',
        'filename originalFilename filepath rawPath compressedPath previewPath event location tagDate duration status processingStatus qcStatus broadcastStatus'
      );

    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!canDownloadJobPackage(req.user, job)) {
      return res.status(409).json({ message: 'Claim this job before downloading the edit package.' });
    }

    const downloadScope = req.query.scope === 'missing' ? 'missing' : 'all';
    const sortedSegments = [...(job.segments || [])].sort(
      (a, b) => Number(a.order || 0) - Number(b.order || 0)
    );

    if (sortedSegments.length === 0) {
      return res.status(400).json({ message: 'Edit job has no segments to package.' });
    }

    const downloadState = getJobDownloadState(job, req.user);
    const downloadedSegmentIds = buildObjectIdSet(downloadState?.downloadedSegmentIds);
    const downloadedOffFileIds = buildObjectIdSet(downloadState?.downloadedOffFileIds);
    const packageSegments = downloadScope === 'missing'
      ? sortedSegments.filter((segment) => !downloadedSegmentIds.has(getObjectIdString(segment._id)))
      : sortedSegments;
    const packageOffFiles = downloadScope === 'missing'
      ? (job.offFiles || []).filter((offFile) => !downloadedOffFileIds.has(getObjectIdString(offFile._id)))
      : (job.offFiles || []);

    if (downloadScope === 'missing' && packageSegments.length === 0 && packageOffFiles.length === 0) {
      return res.status(409).json({ message: 'No new or previously missed job files to download.' });
    }

    const packageEntries = packageSegments.map((segment, index) => {
      const sourcePath = getVideoSourcePath(segment.video);
      const videoFilename = getVideoFilename(segment.video, sourcePath);
      const sourceExt = sourcePath
        ? path.extname(sourcePath)
        : path.extname(videoFilename);
      const baseName = sanitizeFilename(path.basename(videoFilename, path.extname(videoFilename)), `clip_${index + 1}`);
      const sourceFile = sourcePath
        ? `VIDEO/${padOrder(index + 1)}_${baseName}${sourceExt || ''}`
        : '';

      return {
        order: index + 1,
        title: segment.title || videoFilename,
        type: segment.type || 'other',
        start: formatTime(segment.startTime),
        end: segment.endTime === null || segment.endTime === undefined ? '' : formatTime(segment.endTime),
        notes: segment.notes || '',
        sourceFile,
        sourceAvailable: Boolean(sourcePath),
        sourcePath,
        segmentId: segment._id || null,
        videoId: segment.video?._id || null,
        processingStatus: segment.video?.processingStatus || 'unknown',
      };
    });

    const offAudioEntries = buildOffAudioEntries(job, packageOffFiles);
    const downloadableSegmentIds = packageEntries
      .filter((entry) => entry.sourceAvailable && entry.segmentId)
      .map((entry) => entry.segmentId);
    const downloadableOffFileIds = offAudioEntries
      .filter((entry) => entry.sourceAvailable && entry.id)
      .map((entry) => entry.id);
    const availableFileCount = downloadableSegmentIds.length + downloadableOffFileIds.length;

    if (downloadScope === 'missing' && availableFileCount === 0) {
      return res.status(404).json({ message: 'New job files exist, but none are currently available on disk.' });
    }

    await markJobPackageDownloaded(job._id, req.user, downloadableSegmentIds, downloadableOffFileIds);

    const zipFilename = `${sanitizeFilename(job.title, 'edit_job')}_${job._id}_${downloadScope === 'missing' ? 'new_files' : 'edit_package'}.zip`;
    const archive = archiver('zip', { zlib: { level: 0 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    archive.on('warning', (warning) => {
      console.warn('Edit package ZIP warning:', warning);
    });

    archive.on('error', (error) => {
      console.error('Edit package ZIP error:', error);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error creating edit package.' });
      } else {
        res.destroy(error);
      }
    });

    archive.pipe(res);

    archive.append(await createBriefDocxBuffer(job), { name: 'BRIEF_REPORTER.docx' });

    offAudioEntries.forEach((entry) => {
      if (entry.sourcePath) {
        archive.file(entry.sourcePath, { name: entry.packagePath });
      }
    });

    packageEntries.forEach((entry) => {
      if (entry.sourcePath) {
        archive.file(entry.sourcePath, { name: entry.sourceFile });
      }
    });

    try {
      await AuditLog.create({
        action: 'Download Edit Job Package',
        performedBy: req.user.id,
        details: {
          jobId: job._id,
          title: job.title,
          downloadScope,
          segmentCount: packageSegments.length,
          offFileCount: offAudioEntries.length,
          missingFileCount: packageEntries.filter((entry) => !entry.sourceAvailable).length,
          missingOffFileCount: offAudioEntries.filter((entry) => !entry.sourceAvailable).length,
          markedSegmentDownloads: downloadableSegmentIds.length,
          markedOffDownloads: downloadableOffFileIds.length,
        },
      });
    } catch (auditError) {
      console.error('Edit package audit log error:', auditError);
    }

    await archive.finalize();
  } catch (error) {
    console.error('Error creating edit package:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating edit package' });
    }
  }
});

router.get('/:jobId/off-files/:fileId', async (req, res) => {
  try {
    const job = await EditJob.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Edit job not found' });

    if (!canAccessJob(req.user, job)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const offFile = job.offFiles.id(req.params.fileId);
    if (!offFile) return res.status(404).json({ message: 'OFF file not found' });

    const sourcePath = resolveExistingPath(offFile.storagePath || offFile.path);
    if (!sourcePath) return res.status(404).json({ message: 'OFF audio file is missing on disk.' });

    res.setHeader('Content-Type', offFile.mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(offFile.originalName, 'off_audio')}"`);
    fs.createReadStream(sourcePath).pipe(res);
  } catch (error) {
    console.error('Error serving OFF audio file:', error);
    res.status(500).json({ message: 'Error serving OFF audio file' });
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

    await AuditLog.create({
      action: 'Upload Final Video From Job',
      performedBy: req.user.id,
      details: {
        jobId: job._id,
        videoId: videoDoc._id,
        programId: program._id,
        contentTypeId: contentType._id,
        airDate: parsedAirDate,
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

    if (['aired', 'archived'].includes(job.status)) {
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
      const videoCount = await Video.countDocuments({ _id: { $in: videoIds } });

      if (videoCount !== videoIds.length) {
        await removeUploadedFiles(req.files);
        return res.status(400).json({ message: 'One or more selected videos do not exist.' });
      }
    }

    const changes = [];
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
      job.comments.push({
        body: comment.trim(),
        author: req.user.id,
      });
      addJobChange(job, req.user, 'reporter_note_added', 'Reporter je dodao novu napomenu uz izmjenu.', {
        comment: comment.trim(),
      });
      changes.push('comment');
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: 'No job updates were provided.' });
    }

    if (job.status === 'needs_info') {
      job.status = job.assignedEditor ? 'claimed' : 'submitted';
    }

    await job.save();

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

    if (['aired', 'archived'].includes(job.status)) {
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

    if (['aired', 'archived'].includes(job.status)) {
      return res.status(409).json({ message: 'Aired or archived jobs cannot be changed.' });
    }

    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return res.status(400).json({ message: 'Replacement video id is invalid.' });
    }

    const segment = job.segments.id(req.params.segmentId);
    if (!segment) return res.status(404).json({ message: 'Job segment not found.' });

    const replacementVideo = await Video.findById(videoId).select('filename originalFilename duration');
    if (!replacementVideo) {
      return res.status(404).json({ message: 'Replacement video not found.' });
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
    await markJobViewed(job, req.user);

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

    job.comments.push({
      body: body.trim(),
      author: req.user.id,
    });

    await job.save();

    const populatedJob = await populateJob(EditJob.findById(job._id));
    res.status(201).json({ message: 'Comment added', job: serializeJob(populatedJob, req.user) });
  } catch (error) {
    console.error('Error adding edit job comment:', error);
    res.status(500).json({ message: 'Error adding comment' });
  }
});

module.exports = router;
