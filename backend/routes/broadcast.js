const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const ShowDay = require('../models/ShowDay');
const Video = require('../models/Video');
const EditJob = require('../models/EditJob');
const CorrectionRequest = require('../models/CorrectionRequest');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { defaultContentTypes } = require('../config/broadcastDefaults');
const {
  allowedVideoExtensions,
  allowedVideoMimetypes,
  supportedVideoFormatSummary,
} = require('../config/mediaFormats');
const {
  paths,
  ensureFolderExists,
  createStoredFilename,
  createMp4Filename,
  createJpgFilename,
} = require('../utils/storagePaths');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');
const { addVideoPrefixSearchFilter } = require('../utils/searchText');
const { addContentTypeFallbackFilter } = require('../utils/contentTypeFilters');
const { applyApprovedArchiveEligibility } = require('../utils/archiveEligibility');
const { setDownloadHeaders } = require('../utils/downloadHeaders');
const { streamAirPackage } = require('../services/downloadService');
const { createOrUpdateCorrectionRequest } = require('../services/correctionWorkflowService');

const router = express.Router();

const allowedRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const producerRoles = ['Producer', 'Admin'];
const rundownReadRoles = ['Producer', 'Realizator', 'Admin'];
const downloadRoles = ['Realizator', 'Producer', 'Admin'];
const reorderRoles = ['Producer', 'Realizator', 'Admin'];
const showAiringRoles = ['Realizator', 'Admin'];
const correctionReportRoles = ['Realizator', 'Admin'];
const approvalRoles = ['Reporter', 'Producer', 'Admin'];
const directFinalUploadRoles = ['Editor', 'VideoEditor', 'Admin'];
const NO_PROGRAM_VALUES = new Set(['', 'ingest', 'none', 'no_program', 'no-show']);
const directIngestAutoArchiveSlugs = new Set(['prilog', 'insert']);
const MAX_DIRECT_FINAL_FILES = parseInt(process.env.MAX_DIRECT_FINAL_FILES || '100', 10) || 100;
const MAX_UPLOAD_SIZE_GB = Number(process.env.MAX_UPLOAD_SIZE_GB) > 0
  ? Number(process.env.MAX_UPLOAD_SIZE_GB)
  : 25;
const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_GB * 1024 * 1024 * 1024;

const directFinalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureFolderExists(paths.temp);
    cb(null, paths.temp);
  },
  filename: (req, file, cb) => {
    cb(null, createStoredFilename('direct_final_source', file.originalname));
  },
});

const directFinalUpload = multer({
  storage: directFinalStorage,
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
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: MAX_DIRECT_FINAL_FILES,
  },
});

router.use(authenticateToken);
router.use(authorize(allowedRoles));

function getObjectIdString(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function getDateTime(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return date.getTime();
}

function parseAirDate(value) {
  const source = value || new Date().toISOString().slice(0, 10);
  const date = new Date(`${source}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function parseOptionalAirDate(value) {
  if (!String(value || '').trim()) return null;
  return parseAirDate(value);
}

async function removeUploadedFiles(files = []) {
  await Promise.all((files || []).map(async (file) => {
    if (!file?.path) return;
    try {
      await fs.promises.unlink(file.path);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Could not remove uploaded file ${file.path}:`, error.message);
      }
    }
  }));
}

function handleDirectFinalUpload(req, res, next) {
  directFinalUpload.array('finalVideos', MAX_DIRECT_FINAL_FILES)(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: `File is too large. Maximum allowed file size is ${MAX_UPLOAD_SIZE_GB} GB.` });
    }

    return res.status(400).json({ message: error.message || 'Final upload failed.' });
  });
}

function parseKeywords(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildUtcDate(year, month, day) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);

  if (
    !Number.isInteger(parsedYear) ||
    !Number.isInteger(parsedMonth) ||
    !Number.isInteger(parsedDay) ||
    parsedMonth < 1 ||
    parsedMonth > 12 ||
    parsedDay < 1 ||
    parsedDay > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  if (
    date.getUTCFullYear() !== parsedYear ||
    date.getUTCMonth() !== parsedMonth - 1 ||
    date.getUTCDate() !== parsedDay
  ) {
    return null;
  }

  return date;
}

function extractDateFromFilename(baseName) {
  const value = String(baseName || '');
  const ymd = value.match(/\b((?:19|20)\d{2})[-_. ]?([01]\d)[-_. ]?([0-3]\d)\b/);
  if (ymd) {
    const date = buildUtcDate(ymd[1], ymd[2], ymd[3]);
    if (date) return { date, matchedText: ymd[0] };
  }

  const dmy = value.match(/\b([0-3]?\d)[-_. ]([01]?\d)[-_. ]((?:19|20)\d{2})\b/);
  if (dmy) {
    const date = buildUtcDate(dmy[3], dmy[2], dmy[1]);
    if (date) return { date, matchedText: dmy[0] };
  }

  return { date: null, matchedText: '' };
}

function getFilenameMetadata(originalName) {
  const extension = path.extname(originalName || '');
  const baseName = path.basename(originalName || 'video', extension) || originalName || 'video';
  const cleanTitle = baseName
    .replace(/[_]+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .trim() || baseName;
  const extractedDate = extractDateFromFilename(baseName);
  const keywordSource = (extractedDate.matchedText
    ? baseName.replace(extractedDate.matchedText, ' ')
    : baseName
  )
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  const keywords = Array.from(new Set(
    keywordSource
      .split(/\s+/)
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length > 1 || /^\d+$/.test(keyword))
  ));

  return {
    title: cleanTitle,
    date: extractedDate.date,
    keywords,
  };
}

function getQaResponsibilityType(role) {
  if (role === 'Producer') return 'producer_override';
  if (role === 'Admin') return 'admin_override';
  return 'job_reporter';
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

async function getArchivePrilogContentType() {
  await ensureDefaultContentTypes();

  let contentType = await BroadcastContentType.findOne({ slug: 'prilog', active: true });
  if (!contentType) {
    contentType = await BroadcastContentType.findOneAndUpdate(
      { slug: 'prilog' },
      { name: 'Prilog', slug: 'prilog', active: true },
      { new: true, upsert: true }
    );
  }

  return contentType;
}

async function populateShowDay(query) {
  return query
    .populate('program')
    .populate('producers', 'username role')
    .populate('airedBy', 'username role')
    .populate('archiveConfirmedBy', 'username role')
    .populate('items.video', 'filename originalFilename finalTitle filepath rawPath compressedPath previewPath event tagDate airDate broadcastStatus finalApprovalStatus processingStatus thumbnailPath reporter editor qaResponsible qaResponsibilityType correctionStatus correctionNote correctionReportedAt correctionReportedBy')
    .populate('items.video.reporter', 'username role')
    .populate('items.video.editor', 'username role')
    .populate('items.video.qaResponsible', 'username role')
    .populate('items.video.correctionReportedBy', 'username role')
    .populate('items.contentType')
    .populate('items.addedBy', 'username role')
    .populate('downloadStates.user', 'username role')
    .populate('activityLog.performedBy', 'username role');
}

async function findOrCreateShowDay(programId, airDate, user) {
  let showDay = await ShowDay.findOne({ program: programId, airDate });

  if (!showDay) {
    showDay = await ShowDay.create({
      program: programId,
      airDate,
      producers: [],
      items: [],
      activityLog: [{
        action: 'create_show_day',
        summary: 'Show day created.',
        performedBy: user.id,
      }],
    });
  }

  return showDay;
}

function userIsAssignedProducer(showDay, user) {
  if (user.role === 'Admin') return true;
  return (showDay.producers || []).some((producerId) => getObjectIdString(producerId) === user.id);
}

function userCanReorderShowDay(showDay, user) {
  if (!user || !showDay) return false;
  if (['Admin', 'Realizator'].includes(user.role)) return true;
  if (user.role === 'Producer') return userIsAssignedProducer(showDay, user);
  return false;
}

function getUserDownloadState(showDay, user) {
  if (!showDay || !user) return null;
  return (showDay.downloadStates || []).find(
    (state) => getObjectIdString(state.user) === user.id
  ) || null;
}

function serializeShowDay(showDay, user) {
  if (!showDay) return null;

  const data = typeof showDay.toObject === 'function' ? showDay.toObject() : showDay;
  const downloadState = getUserDownloadState(showDay, user);
  const lastDownloadedAt = downloadState?.lastDownloadedAt || null;
  const lastDownloadTime = getDateTime(lastDownloadedAt);

  const items = (data.items || []).map((item) => {
    const changedAt = Math.max(getDateTime(item.updatedAt), getDateTime(item.addedAt));
    return {
      ...item,
      changedSinceDownload: !lastDownloadTime || changedAt > lastDownloadTime,
    };
  });
  const activitySinceDownload = (data.activityLog || []).filter((activity) =>
    activity.action !== 'download_air_package' &&
    (!lastDownloadTime || getDateTime(activity.createdAt) > lastDownloadTime)
  );

  return {
    ...data,
    items,
    downloadState: {
      lastDownloadedAt,
      downloadCount: downloadState?.downloadCount || 0,
      hasChangesSinceDownload: activitySinceDownload.length > 0 || items.some((item) => item.changedSinceDownload && item.status !== 'removed'),
      changeCountSinceDownload: activitySinceDownload.length,
    },
    activitySinceDownload,
  };
}

function isEligibleBroadcastMaterial(video) {
  if (!video) return false;
  if (video.status !== 'edited' || video.processingStatus !== 'completed') return false;
  if (!['approved_for_air', 'aired', 'archived'].includes(video.broadcastStatus)) return false;
  return video.finalApprovalStatus === 'approved' ||
    video.qcStatus === 'passed' ||
    ['aired', 'archived'].includes(video.broadcastStatus);
}

async function buildLibraryVideoFilter({ contentTypeId, search }) {
  const filter = {};
  applyApprovedArchiveEligibility(filter);

  await addContentTypeFallbackFilter(filter, contentTypeId);

  const trimmedSearch = String(search || '').trim();
  addVideoPrefixSearchFilter(filter, trimmedSearch);

  return filter;
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

function buildLibrarySort(query = {}) {
  const sortBy = String(query.sortBy || 'recent');
  const sortOrder = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1;
  const sortFields = {
    recent: 'uploadDate',
    airedAt: 'airedAt',
    archivedAt: 'archivedAt',
    title: 'finalTitle',
    category: 'finalCategory',
  };
  const field = sortFields[sortBy] || 'uploadDate';
  return { [field]: sortOrder, airedAt: -1, archivedAt: -1, finalApprovedAt: -1, uploadDate: -1 };
}

function populateLibraryVideoList(query) {
  return query
    .populate('program')
    .populate('contentType')
    .populate('sourceJob', 'title reporter')
    .populate('uploader', 'username role')
    .populate('reporter', 'username role')
    .populate('editor', 'username role')
    .populate('qaResponsible', 'username role')
    .populate('correctionReportedBy', 'username role')
    .populate('finalApprovedBy', 'username role');
}

async function buildLibrarySummary(filter) {
  const [total, approved, aired, archived, needsCorrection] = await Promise.all([
    Video.countDocuments(filter),
    Video.countDocuments({ ...filter, broadcastStatus: 'approved_for_air' }),
    Video.countDocuments({ ...filter, broadcastStatus: 'aired' }),
    Video.countDocuments({ ...filter, broadcastStatus: 'archived' }),
    Video.countDocuments({ ...filter, correctionStatus: 'needs_correction' }),
  ]);

  return { total, approved, aired, archived, needsCorrection };
}

function resolveExistingPath(...candidatePaths) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue;
    const resolvedPath = path.resolve(candidatePath);
    if (fs.existsSync(resolvedPath)) return resolvedPath;
  }

  return null;
}

function sanitizePackageName(value) {
  return String(value || 'material')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'material';
}

function formatPackageDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function buildRundownText(showDay, items) {
  const programName = showDay.program?.name || 'N/A';
  const lines = [
    `Program: ${programName}`,
    `Air date: ${formatPackageDate(showDay.airDate).slice(0, 10)}`,
    `Generated: ${formatPackageDate(new Date())}`,
    '',
    'RUNDOWN',
    '',
  ];

  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title || item.video?.finalTitle || item.video?.originalFilename || 'Untitled'}`);
    lines.push(`   Type: ${item.contentType?.name || 'N/A'}`);
    lines.push(`   Status: ${item.status || 'scheduled'}`);
    lines.push(`   Reporter: ${item.video?.reporter?.username || 'N/A'}`);
    lines.push(`   Editor: ${item.video?.editor?.username || 'N/A'}`);
    lines.push(`   QA: ${item.video?.qaResponsible?.username || 'N/A'}`);
    lines.push('');
  });

  lines.push('RECENT ACTIVITY');
  lines.push('');
  (showDay.activityLog || []).slice().reverse().forEach((activity) => {
    lines.push(`${formatPackageDate(activity.createdAt)} / ${activity.performedBy?.username || 'Unknown'} / ${activity.summary}`);
  });

  return lines.join('\n');
}

router.get('/programs', async (req, res) => {
  try {
    const programs = await BroadcastProgram.find({ active: true }).sort({ name: 1 });
    res.json(programs);
  } catch (error) {
    console.error('Error fetching broadcast programs:', error);
    res.status(500).json({ message: 'Error fetching broadcast programs' });
  }
});

router.get('/content-types', async (req, res) => {
  try {
    await ensureDefaultContentTypes();
    const types = await BroadcastContentType.find({ active: true }).sort({ name: 1 });
    res.json(types);
  } catch (error) {
    console.error('Error fetching broadcast content types:', error);
    res.status(500).json({ message: 'Error fetching content types' });
  }
});

router.get('/reporters', authorize(['Editor', 'VideoEditor', 'Producer', 'Admin']), async (req, res) => {
  try {
    const reporters = await User.find({ role: { $in: ['Reporter', 'Producer', 'Admin'] } })
      .select('_id username role')
      .sort({ username: 1 });
    res.json(reporters);
  } catch (error) {
    console.error('Error fetching reporters:', error);
    res.status(500).json({ message: 'Error fetching reporters' });
  }
});

router.post('/direct-final-upload', authorize(directFinalUploadRoles), handleDirectFinalUpload, async (req, res) => {
  const {
    programId,
    contentTypeId,
    airDate,
    finalTitle,
    reporterId,
    notes = '',
    keywords = '',
    useFilenameMetadata = 'false',
    bulkUpload = 'false',
  } = req.body;
  const retainedFilePaths = new Set();

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'At least one final video file is required.' });
    }

    const normalizedProgramId = String(programId || '').trim();
    const ingestOnly = NO_PROGRAM_VALUES.has(normalizedProgramId);
    let program = null;
    if (!ingestOnly) {
      program = await BroadcastProgram.findById(normalizedProgramId);
      if (!program || !program.active) {
        await removeUploadedFiles(req.files);
        return res.status(400).json({ message: 'Active broadcast program is required, or choose no show / ingest.' });
      }
    }

    const contentType = await BroadcastContentType.findById(contentTypeId);
    if (!contentType || !contentType.active) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Active content type is required.' });
    }
    const autoArchiveDirectIngest = ingestOnly && directIngestAutoArchiveSlugs.has(contentType.slug);

    const fallbackAirDate = parseOptionalAirDate(airDate);
    if (String(airDate || '').trim() && !fallbackAirDate) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Valid air date is required.' });
    }
    const useFilenameMetadataEnabled = useFilenameMetadata === 'true' || bulkUpload === 'true';
    const isBulkUpload = bulkUpload === 'true' || req.files.length > 1;
    const fileMetadata = req.files.map((file) => getFilenameMetadata(file.originalname));
    const missingAirDate = !ingestOnly && !fallbackAirDate && fileMetadata.some((metadata) => !metadata.date);

    if (missingAirDate) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Air date is required when a filename does not contain a valid date.' });
    }

    let reporter = null;
    if (reporterId) {
      reporter = await User.findById(reporterId).select('_id username role');
      if (!reporter) {
        await removeUploadedFiles(req.files);
        return res.status(404).json({ message: 'Reporter / author was not found.' });
      }
    }

    const uploadedVideos = [];
    const auditFiles = [];
    const queueFailures = [];
    const customKeywords = parseKeywords(keywords);
    const trimmedFinalTitle = String(finalTitle || '').trim();

    ensureFolderExists(paths.final);
    ensureFolderExists(paths.previews);
    ensureFolderExists(paths.thumbnails);

    for (const [index, file] of req.files.entries()) {
      const metadata = fileMetadata[index] || getFilenameMetadata(file.originalname);
      const title = (useFilenameMetadataEnabled || isBulkUpload)
        ? metadata.title
        : req.files.length === 1 && trimmedFinalTitle
        ? trimmedFinalTitle
        : trimmedFinalTitle
          ? `${trimmedFinalTitle} ${index + 1}`
          : metadata.title;
      const fileDate = metadata.date || fallbackAirDate || parseAirDate();
      const finalFolder = path.join(paths.final, contentType.slug);
      ensureFolderExists(finalFolder);
      const finalFilename = createStoredFilename('final', file.originalname);
      const finalPath = path.join(finalFolder, finalFilename);
      const previewFilename = createMp4Filename('preview', file.originalname);
      const previewPath = path.join(paths.previews, previewFilename);
      const thumbnailFilename = createJpgFilename('thumb', file.originalname);
      const thumbnailPath = path.join(paths.thumbnails, thumbnailFilename);
      const inputStats = fs.existsSync(file.path) ? fs.statSync(file.path) : null;

      const videoDoc = new Video({
        filename: finalFilename,
        filepath: finalPath,
        originalFilename: file.originalname,
        rawPath: file.path,
        compressedPath: finalPath,
        previewPath,
        thumbnailPath,
        uploader: req.user.id,
        reporter: reporter?._id || null,
        editor: req.user.id,
        event: title,
        location: '',
        tagDate: fileDate,
        status: 'edited',
        processingStatus: 'queued',
        processingMode: 'finalize',
        processingProgress: 0,
        qcStatus: 'passed',
        qcNotes: notes || 'Direct editor QA upload.',
        qcCheckedBy: req.user.id,
        qcCheckedAt: new Date(),
        broadcastStatus: autoArchiveDirectIngest ? 'archived' : 'qc_pending',
        program: program?._id || null,
        contentType: contentType._id,
        airDate: ingestOnly ? null : fileDate,
        finalTitle: title,
        finalCategory: contentType.slug,
        finalApprovalStatus: 'approved',
        finalApprovedBy: req.user.id,
        finalApprovedAt: new Date(),
        finalApprovalRole: req.user.role,
        finalApprovalNotes: notes,
        qaResponsible: req.user.id,
        qaResponsibilityType: 'direct_editor',
        archivedAt: autoArchiveDirectIngest ? new Date() : null,
        keywords: Array.from(new Set([
          program?.name || 'Nema emisije / ingest',
          contentType.name,
          title,
          reporter?.username,
          ...metadata.keywords,
          ...customKeywords,
        ].filter(Boolean))),
        sizeOriginal: inputStats ? inputStats.size : null,
        uploadDate: new Date(),
      });

      await videoDoc.save();
      retainedFilePaths.add(file.path);

      try {
        const queueJob = await enqueueVideoProcessing(videoDoc._id);
        videoDoc.processingJobId = queueJob.id.toString();
        await videoDoc.save();
      } catch (queueError) {
        const queueMessage = getQueueErrorMessage(queueError);
        videoDoc.processingStatus = 'failed';
        videoDoc.processingError = queueMessage;
        videoDoc.processingCompletedAt = new Date();
        await videoDoc.save();
        queueFailures.push({
          originalFilename: file.originalname,
          error: queueMessage,
        });
      }

      uploadedVideos.push(videoDoc);
      auditFiles.push({
        videoId: videoDoc._id,
        originalFilename: file.originalname,
        finalTitle: title,
        programId: program?._id || null,
        ingestOnly,
        autoArchiveDirectIngest,
        contentTypeId: contentType._id,
        extractedDate: metadata.date || null,
        extractedKeywords: metadata.keywords,
        reporterId: reporter?._id || null,
        editorId: req.user.id,
        qaResponsibleId: req.user.id,
        processingJobId: videoDoc.processingJobId || null,
        processingError: videoDoc.processingError || null,
      });
    }

    await AuditLog.create({
      action: 'Direct Final Video Upload',
      performedBy: req.user.id,
      details: {
        count: uploadedVideos.length,
        programId: program?._id || null,
        ingestOnly,
        autoArchiveDirectIngest,
        contentTypeId: contentType._id,
        airDateFallback: fallbackAirDate,
        reporterId: reporter?._id || null,
        qaResponsibleId: req.user.id,
        files: auditFiles,
      },
    });

    const populatedVideos = await Video.find({ _id: { $in: uploadedVideos.map((video) => video._id) } })
      .populate('program')
      .populate('contentType')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('uploader', 'username role')
      .populate('finalApprovedBy', 'username role');

    res.status(queueFailures.length > 0 ? 207 : 202).json({
      message: queueFailures.length > 0
        ? `Final upload saved ${uploadedVideos.length} file(s), but ${queueFailures.length} processing job(s) could not be queued.`
        : 'Direct final upload saved and queued for processing.',
      videos: populatedVideos,
      queueFailures,
    });
  } catch (error) {
    await removeUploadedFiles((req.files || []).filter((file) => !retainedFilePaths.has(file.path)));
    console.error('Error uploading direct final video:', error);
    res.status(500).json({ message: error.message || 'Error uploading direct final video' });
  }
});

router.get('/final-videos', authorize(['Producer', 'Admin']), async (req, res) => {
  const { programId, airDate, contentTypeId, search } = req.query;
  const filter = {
    status: 'edited',
    finalApprovalStatus: 'approved',
    processingStatus: 'completed',
    broadcastStatus: 'approved_for_air',
  };

  if (programId && programId !== 'all') filter.program = programId;
  await addContentTypeFallbackFilter(filter, contentTypeId);
  addVideoPrefixSearchFilter(filter, search);

  const parsedDate = parseAirDate(airDate);
  if (parsedDate) {
    const endDate = new Date(parsedDate);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    filter.airDate = { $gte: parsedDate, $lt: endDate };
  }

  try {
    const videos = await Video.find(filter)
      .populate('program')
      .populate('contentType')
      .populate('sourceJob', 'title reporter')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('correctionReportedBy', 'username role')
      .populate('finalApprovedBy', 'username role')
      .sort({ finalApprovedAt: -1, uploadDate: -1 });

    res.json(videos);
  } catch (error) {
    console.error('Error fetching final videos:', error);
    res.status(500).json({ message: 'Error fetching final videos' });
  }
});

router.get('/library-videos', authorize(['Producer', 'Admin']), async (req, res) => {
  const { contentTypeId, search, limit = 200 } = req.query;
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);

  try {
    const filter = await buildLibraryVideoFilter({ contentTypeId, search });
    const videos = await Video.find(filter)
      .populate('program')
      .populate('contentType')
      .populate('sourceJob', 'title reporter')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('correctionReportedBy', 'username role')
      .populate('finalApprovedBy', 'username role')
      .sort({ airedAt: -1, archivedAt: -1, finalApprovedAt: -1, uploadDate: -1 })
      .limit(parsedLimit);

    res.json(videos);
  } catch (error) {
    console.error('Error fetching producer library videos:', error);
    res.status(500).json({ message: 'Error fetching producer video library' });
  }
});

router.get('/library-search', authorize(['Producer', 'Admin']), async (req, res) => {
  const { contentTypeId, search } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  try {
    const filter = await buildLibraryVideoFilter({ contentTypeId, search });
    const sort = buildLibrarySort(req.query);
    const [total, items, summary] = await Promise.all([
      Video.countDocuments(filter),
      populateLibraryVideoList(
        Video.find(filter)
          .sort(sort)
          .skip(skip)
          .limit(limit)
      ),
      buildLibrarySummary(filter),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary,
    });
  } catch (error) {
    console.error('Error searching producer library videos:', error);
    res.status(500).json({ message: 'Error searching producer video library' });
  }
});

router.post('/final-videos/:videoId/approve', authorize(approvalRoles), async (req, res) => {
  const { approved = true, notes = '' } = req.body;

  try {
    const video = await Video.findById(req.params.videoId).populate('sourceJob');
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    if (approved && video.processingStatus !== 'completed') {
      return res.status(409).json({ message: 'Final video processing must be completed before approval.' });
    }

    if (req.user.role === 'Reporter') {
      const reporterId = getObjectIdString(video.sourceJob?.reporter);
      if (!reporterId || reporterId !== req.user.id) {
        return res.status(403).json({ message: 'Only the job reporter can approve this final video.' });
      }
    }

    if (approved) {
      video.finalApprovalStatus = 'approved';
      video.qcStatus = 'passed';
      video.qcCheckedBy = req.user.id;
      video.qcCheckedAt = new Date();
      video.broadcastStatus = 'approved_for_air';
    } else {
      video.finalApprovalStatus = 'rejected';
      video.broadcastStatus = 'qc_failed';
      video.qcStatus = 'failed';
      video.qcNotes = notes;
    }

    video.finalApprovedBy = req.user.id;
    video.finalApprovedAt = new Date();
    video.finalApprovalRole = req.user.role;
    video.finalApprovalNotes = notes;
    video.qaResponsible = req.user.id;
    video.qaResponsibilityType = getQaResponsibilityType(req.user.role);

    await video.save();

    if (video.sourceJob) {
      video.sourceJob.status = approved ? 'approved' : 'needs_info';
      video.sourceJob.changeLog.push({
        type: approved ? 'final_approved' : 'final_rejected',
        summary: approved
          ? `Final video approved by ${req.user.username || req.user.role}.`
          : `Final video rejected by ${req.user.username || req.user.role}.`,
        author: req.user.id,
        actorRole: req.user.role,
        details: {
          videoId: video._id,
          notes,
        },
      });
      await video.sourceJob.save();
    }

    await AuditLog.create({
      action: approved ? 'Approve Final Video' : 'Reject Final Video',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        sourceJob: video.sourceJob?._id || null,
        finalTitle: video.finalTitle,
        notes,
      },
    });

    const populatedVideo = await Video.findById(video._id)
      .populate('program')
      .populate('contentType')
      .populate('sourceJob', 'title reporter')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('finalApprovedBy', 'username role');

    res.json({ message: approved ? 'Final video approved.' : 'Final video rejected.', video: populatedVideo });
  } catch (error) {
    console.error('Error approving final video:', error);
    res.status(500).json({ message: 'Error updating final video approval' });
  }
});

router.get('/show-day', authorize(rundownReadRoles), async (req, res) => {
  const { programId, airDate } = req.query;
  const parsedDate = parseAirDate(airDate);

  if (!programId || !parsedDate) {
    return res.status(400).json({ message: 'programId and airDate are required.' });
  }

  try {
    const showDay = req.user.role === 'Realizator'
      ? await ShowDay.findOne({ program: programId, airDate: parsedDate })
      : await findOrCreateShowDay(programId, parsedDate, req.user);

    if (!showDay) {
      return res.status(404).json({ message: 'Show day has not been prepared yet.' });
    }

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json(serializeShowDay(populatedShowDay, req.user));
  } catch (error) {
    console.error('Error fetching show day:', error);
    res.status(500).json({ message: 'Error fetching show day' });
  }
});

router.get('/my-show-days', authorize(producerRoles), async (req, res) => {
  const parsedFromDate = parseAirDate(req.query.from);
  const days = Math.min(Math.max(parseInt(req.query.days || '14', 10) || 14, 1), 31);

  if (!parsedFromDate) {
    return res.status(400).json({ message: 'A valid from date is required.' });
  }

  try {
    const toDate = new Date(parsedFromDate);
    toDate.setUTCDate(toDate.getUTCDate() + days);

    const filter = {
      airDate: {
        $gte: parsedFromDate,
        $lt: toDate,
      },
    };

    if (req.user.role !== 'Admin') {
      filter.producers = req.user.id;
    }

    const showDays = await ShowDay.find(filter)
      .populate('program')
      .populate('producers', 'username role')
      .sort({ airDate: 1, updatedAt: -1 });

    res.json(showDays.map((showDay) => {
      const activeItems = (showDay.items || []).filter((item) => item.status !== 'removed');
      const readyItems = activeItems.filter((item) => ['ready', 'aired'].includes(item.status));

      return {
        _id: showDay._id,
        program: showDay.program,
        airDate: showDay.airDate,
        producers: showDay.producers,
        itemCount: activeItems.length,
        readyCount: readyItems.length,
        airedAt: showDay.airedAt,
        archiveConfirmedAt: showDay.archiveConfirmedAt,
        updatedAt: showDay.updatedAt,
      };
    }));
  } catch (error) {
    console.error('Error fetching producer show shortcuts:', error);
    res.status(500).json({ message: 'Error fetching producer show shortcuts' });
  }
});

router.post('/show-day/join', authorize(producerRoles), async (req, res) => {
  const { programId, airDate } = req.body;
  const parsedDate = parseAirDate(airDate);

  if (!programId || !parsedDate) {
    return res.status(400).json({ message: 'programId and airDate are required.' });
  }

  try {
    const showDay = await findOrCreateShowDay(programId, parsedDate, req.user);
    const alreadyJoined = (showDay.producers || []).some((producerId) => getObjectIdString(producerId) === req.user.id);

    if (!alreadyJoined) {
      showDay.producers.push(req.user.id);
      showDay.activityLog.push({
        action: 'join_show_day',
        summary: `${req.user.username || 'Producer'} joined this show day.`,
        performedBy: req.user.id,
      });
      await showDay.save();

      await AuditLog.create({
        action: 'Join Show Day',
        performedBy: req.user.id,
        details: { showDayId: showDay._id, programId, airDate: parsedDate },
      });
    }

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({
      message: alreadyJoined ? 'Already joined this show.' : 'Joined show day.',
      showDay: serializeShowDay(populatedShowDay, req.user),
    });
  } catch (error) {
    console.error('Error joining show day:', error);
    res.status(500).json({ message: 'Error joining show day' });
  }
});

router.get('/show-day/:showDayId/download-package', authorize(downloadRoles), async (req, res) => {
  try {
    await streamAirPackage({
      user: req.user,
      payload: { showDayId: req.params.showDayId },
      res,
    });
  } catch (error) {
    console.error('Error downloading show package:', error);
    if (!res.headersSent) {
      res.status(error.statusCode || 500).json({ message: error.message || 'Error downloading show package' });
    }
  }
});

router.post('/show-day/:showDayId/mark-aired', authorize(showAiringRoles), async (req, res) => {
  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    const activeItems = (showDay.items || []).filter((item) => item.status !== 'removed');
    if (activeItems.length === 0) {
      return res.status(400).json({ message: 'No active material in this show.' });
    }

    const archiveContentType = await getArchivePrilogContentType();
    const now = new Date();
    const videoIds = activeItems
      .map((item) => getObjectIdString(item.video))
      .filter(Boolean);
    const videos = await Video.find({ _id: { $in: videoIds } });
    const referencedContentTypeIds = new Set();

    activeItems.forEach((item) => {
      const itemContentTypeId = getObjectIdString(item.contentType);
      if (itemContentTypeId) referencedContentTypeIds.add(itemContentTypeId);
    });
    videos.forEach((video) => {
      const videoContentTypeId = getObjectIdString(video.contentType);
      if (videoContentTypeId) referencedContentTypeIds.add(videoContentTypeId);
    });

    const referencedContentTypes = referencedContentTypeIds.size > 0
      ? await BroadcastContentType.find({ _id: { $in: Array.from(referencedContentTypeIds) } })
      : [];
    const contentTypeById = new Map(
      referencedContentTypes.map((type) => [getObjectIdString(type._id), type])
    );
    const itemByVideoId = new Map(
      activeItems.map((item) => [getObjectIdString(item.video), item])
    );
    const normalizeAsPrilogSlugs = new Set(['prilog', 'insert']);
    const normalizeItemIds = new Set();
    let archivedCount = 0;

    for (const video of videos) {
      if (video.broadcastStatus !== 'archived') archivedCount += 1;
      const item = itemByVideoId.get(getObjectIdString(video._id));
      const itemContentType = contentTypeById.get(getObjectIdString(item?.contentType));
      const videoContentType = contentTypeById.get(getObjectIdString(video.contentType));
      const currentContentType = itemContentType || videoContentType;
      const normalizeAsPrilog = !currentContentType || normalizeAsPrilogSlugs.has(currentContentType.slug);
      const targetContentType = normalizeAsPrilog ? archiveContentType : currentContentType;

      video.broadcastStatus = 'archived';
      video.airedAt = video.airedAt || now;
      video.archivedAt = video.archivedAt || now;
      if (targetContentType) {
        video.contentType = targetContentType._id;
        video.finalCategory = targetContentType.slug;
      }

      const currentKeywords = Array.isArray(video.keywords) ? video.keywords : [];
      video.keywords = Array.from(new Set([
        ...currentKeywords,
        targetContentType?.name,
        'TV arhiva',
      ].filter(Boolean)));

      if (normalizeAsPrilog && item?._id) {
        normalizeItemIds.add(String(item._id));
      }

      await video.save();
    }

    activeItems.forEach((item) => {
      item.status = 'aired';
      const itemContentType = contentTypeById.get(getObjectIdString(item.contentType));
      if (normalizeItemIds.has(String(item._id)) || !itemContentType || normalizeAsPrilogSlugs.has(itemContentType.slug)) {
        item.contentType = archiveContentType._id;
      }
      item.updatedAt = now;
    });

    showDay.airedAt = showDay.airedAt || now;
    showDay.airedBy = showDay.airedBy || req.user.id;
    showDay.archiveConfirmedAt = now;
    showDay.archiveConfirmedBy = req.user.id;
    showDay.activityLog.push({
      action: 'confirm_show_aired',
      summary: `Show aired. Archived ${archivedCount} material(s); ${normalizeItemIds.size} tagged as Prilog.`,
      performedBy: req.user.id,
      createdAt: now,
      details: {
        activeItems: activeItems.length,
        archivedVideos: archivedCount,
        archivedAsPrilog: normalizeItemIds.size,
        archiveContentTypeId: archiveContentType._id,
      },
    });

    await showDay.save();

    await AuditLog.create({
      action: 'Confirm Show Aired',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        programId: showDay.program,
        airDate: showDay.airDate,
        activeItems: activeItems.length,
        archivedVideos: archivedCount,
        archivedAsPrilog: normalizeItemIds.size,
        archiveContentTypeId: archiveContentType._id,
      },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({
      message: archivedCount > 0
        ? `Show marked as aired. ${archivedCount} material(s) archived; ${normalizeItemIds.size} tagged as Prilog.`
        : 'Show marked as aired. Material was already in the archive.',
      showDay: serializeShowDay(populatedShowDay, req.user),
    });
  } catch (error) {
    console.error('Error marking show as aired:', error);
    res.status(500).json({ message: 'Error marking show as aired' });
  }
});

router.post('/show-day/:showDayId/items', authorize(producerRoles), async (req, res) => {
  const { videoId, contentTypeId, title = '' } = req.body;

  if (!videoId || !contentTypeId) {
    return res.status(400).json({ message: 'videoId and contentTypeId are required.' });
  }

  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    if (!userIsAssignedProducer(showDay, req.user)) {
      return res.status(403).json({ message: 'Join this show day before adding material.' });
    }

    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    if (!isEligibleBroadcastMaterial(video)) {
      return res.status(409).json({
        message: 'Only edited, processed and approved broadcast/library videos can be added to a show.',
      });
    }

    const materialTitle = title || video.finalTitle || video.originalFilename || video.filename;
    const normalizedTitle = String(materialTitle || '').trim().toLowerCase();
    const duplicate = (showDay.items || []).find((item) => {
      if (item.status === 'removed') return false;
      const sameVideo = getObjectIdString(item.video) === videoId;
      const sameType = getObjectIdString(item.contentType) === contentTypeId;
      const sameTitle = normalizedTitle && String(item.title || '').trim().toLowerCase() === normalizedTitle;
      return sameVideo || (sameType && sameTitle);
    });

    if (duplicate) {
      return res.status(409).json({ message: 'This material or title is already in the selected show.' });
    }

    showDay.items.push({
      video: videoId,
      contentType: contentTypeId,
      title: materialTitle,
      order: showDay.items.filter((item) => item.status !== 'removed').length,
      status: 'scheduled',
      addedBy: req.user.id,
    });

    showDay.activityLog.push({
      action: 'add_material',
      summary: `Added material: ${materialTitle}`,
      performedBy: req.user.id,
      details: { videoId, contentTypeId },
    });

    await showDay.save();

    await AuditLog.create({
      action: 'Add Material To Show',
      performedBy: req.user.id,
      details: { showDayId: showDay._id, videoId, contentTypeId },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.status(201).json({ message: 'Material added to show.', showDay: serializeShowDay(populatedShowDay, req.user) });
  } catch (error) {
    console.error('Error adding material to show:', error);
    res.status(500).json({ message: 'Error adding material to show' });
  }
});

router.patch('/show-day/:showDayId/items/reorder', authorize(reorderRoles), async (req, res) => {
  const { itemIds } = req.body || {};

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ message: 'itemIds must be a non-empty array.' });
  }

  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    if (!userCanReorderShowDay(showDay, req.user)) {
      return res.status(403).json({ message: 'You do not have permission to reorder this show.' });
    }

    const activeItems = (showDay.items || []).filter((item) => item.status !== 'removed');
    const requestedIds = itemIds.map(String);
    const uniqueRequestedIds = new Set(requestedIds);
    const activeIds = activeItems.map((item) => String(item._id));
    const activeIdSet = new Set(activeIds);

    if (uniqueRequestedIds.size !== requestedIds.length || requestedIds.length !== activeIds.length) {
      return res.status(400).json({ message: 'Reorder list must include every active show item exactly once.' });
    }

    const invalidIds = requestedIds.filter((itemId) => !activeIdSet.has(itemId));
    if (invalidIds.length > 0) {
      return res.status(400).json({ message: 'Reorder list contains items that are not active in this show.' });
    }

    const previousOrder = activeItems
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({
        order: index + 1,
        itemId: String(item._id),
        title: item.title || `Material ${item._id}`,
      }));
    const orderById = new Map(requestedIds.map((itemId, index) => [itemId, index]));
    const now = new Date();

    activeItems.forEach((item) => {
      item.order = orderById.get(String(item._id));
    });

    const nextOrder = activeItems
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((item, index) => ({
        order: index + 1,
        itemId: String(item._id),
        title: item.title || `Material ${item._id}`,
      }));

    showDay.activityLog.push({
      action: 'reorder_show_rundown',
      summary: `Rundown order updated (${activeItems.length} item(s)).`,
      performedBy: req.user.id,
      createdAt: now,
      details: {
        itemCount: activeItems.length,
        previousOrder,
        nextOrder,
      },
    });

    await showDay.save();

    await AuditLog.create({
      action: 'Reorder Show Rundown',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        programId: showDay.program,
        airDate: showDay.airDate,
        itemCount: activeItems.length,
        nextOrder,
      },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({
      message: 'Rundown order updated.',
      showDay: serializeShowDay(populatedShowDay, req.user),
    });
  } catch (error) {
    console.error('Error reordering show rundown:', error);
    res.status(500).json({ message: 'Error reordering show rundown' });
  }
});

router.post('/show-day/:showDayId/items/:itemId/report-error', authorize(correctionReportRoles), async (req, res) => {
  const { note = '', timestamp = 0 } = req.body || {};

  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    const item = showDay.items.id(req.params.itemId);
    if (!item || item.status === 'removed') {
      return res.status(404).json({ message: 'Active show item not found.' });
    }

    const video = await Video.findById(item.video);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    const now = new Date();
    const materialTitle = item.title || video.finalTitle || video.originalFilename || video.filename || `Material ${req.params.itemId}`;
    const trimmedNote = String(note || '').trim();
    const correctionNote = trimmedNote || 'Realizator reported an issue. Correction needed.';
    const correctionTimestamp = Math.max(Number(timestamp) || 0, 0);

    video.correctionStatus = 'needs_correction';
    video.correctionNote = correctionNote;
    video.correctionReportedBy = req.user.id;
    video.correctionReportedAt = now;
    video.correctionResolvedBy = null;
    video.correctionResolvedAt = null;
    video.correctionResolvedNote = '';
    video.keywords = Array.from(new Set([
      ...(Array.isArray(video.keywords) ? video.keywords : []),
      'Potrebna ispravka',
    ].filter(Boolean)));
    video.correctionReports.push({
      note: correctionNote,
      timestamp: correctionTimestamp,
      reportedBy: req.user.id,
      reportedAt: now,
      showDay: showDay._id,
      showDayItem: item._id,
    });
    await video.save();
    const correctionWorkflow = await createOrUpdateCorrectionRequest({
      showDay,
      item,
      video,
      user: req.user,
      note: correctionNote,
      timestamp: correctionTimestamp,
    });
    const latestReport = video.correctionReports[video.correctionReports.length - 1];
    if (latestReport) {
      latestReport.correctionRequest = correctionWorkflow.request._id;
      await video.save();
    }

    item.updatedAt = now;
    showDay.activityLog.push({
      action: 'report_material_error',
      summary: `"${materialTitle}" tagged as Potrebna ispravka.`,
      performedBy: req.user.id,
      createdAt: now,
      details: {
        itemId: item._id,
        videoId: video._id,
        title: materialTitle,
        correctionStatus: 'needs_correction',
        note: correctionNote,
        timestamp: correctionTimestamp,
        correctionRequestId: correctionWorkflow.request._id,
        correctionJobId: correctionWorkflow.correctionJob?._id || null,
      },
    });
    await showDay.save();

    await AuditLog.create({
      action: 'Report Clip Correction Needed',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        itemId: item._id,
        videoId: video._id,
        title: materialTitle,
        correctionStatus: 'needs_correction',
        note: correctionNote,
        timestamp: correctionTimestamp,
        correctionRequestId: correctionWorkflow.request._id,
        correctionJobId: correctionWorkflow.correctionJob?._id || null,
      },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({
      message: 'Clip tagged as Potrebna ispravka.',
      showDay: serializeShowDay(populatedShowDay, req.user),
      correctionRequest: correctionWorkflow.request,
      correctionJob: correctionWorkflow.correctionJob,
    });
  } catch (error) {
    console.error('Error reporting material correction:', error);
    res.status(500).json({ message: 'Error reporting material correction' });
  }
});

router.patch('/show-day/:showDayId/items/:itemId/replace', authorize(producerRoles), async (req, res) => {
  const { videoId, contentTypeId, title = '' } = req.body;

  if (!videoId || !contentTypeId) {
    return res.status(400).json({ message: 'videoId and contentTypeId are required.' });
  }

  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    if (!userIsAssignedProducer(showDay, req.user)) {
      return res.status(403).json({ message: 'Join this show day before replacing material.' });
    }

    const item = showDay.items.id(req.params.itemId);
    if (!item || item.status === 'removed') {
      return res.status(404).json({ message: 'Active show item not found.' });
    }

    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Replacement video not found.' });

    if (!isEligibleBroadcastMaterial(video)) {
      return res.status(409).json({
        message: 'Only edited, processed and approved broadcast/library videos can be used as replacements.',
      });
    }

    const materialTitle = title || video.finalTitle || video.originalFilename || video.filename;
    const normalizedTitle = String(materialTitle || '').trim().toLowerCase();
    const duplicate = (showDay.items || []).find((candidate) => {
      if (candidate.status === 'removed') return false;
      if (String(candidate._id) === String(item._id)) return false;
      const sameVideo = getObjectIdString(candidate.video) === videoId;
      const sameType = getObjectIdString(candidate.contentType) === contentTypeId;
      const sameTitle = normalizedTitle && String(candidate.title || '').trim().toLowerCase() === normalizedTitle;
      return sameVideo || (sameType && sameTitle);
    });

    if (duplicate) {
      return res.status(409).json({ message: 'Replacement material or title is already in the selected show.' });
    }

    const previousVideoId = getObjectIdString(item.video);
    const previousTitle = item.title;
    item.video = video._id;
    item.contentType = contentTypeId;
    item.title = materialTitle;
    item.updatedAt = new Date();

    showDay.activityLog.push({
      action: 'replace_material',
      summary: `Replaced material: ${previousTitle || previousVideoId} -> ${materialTitle}`,
      performedBy: req.user.id,
      details: {
        itemId: item._id,
        previousVideoId,
        newVideoId: video._id,
        contentTypeId,
      },
    });

    await showDay.save();

    const correctionRequest = await CorrectionRequest.findOne({
      video: previousVideoId,
      status: { $in: ['reported', 'assigned', 'in_edit', 'ready_for_review'] },
    }).sort({ updatedAt: -1 });
    if (correctionRequest) {
      correctionRequest.status = 'resolved';
      correctionRequest.resolvedBy = req.user.id;
      correctionRequest.resolvedAt = new Date();
      correctionRequest.resolutionNote = `Materijal zamijenjen verzijom ${materialTitle}.`;
      correctionRequest.correctedBy = correctionRequest.assignedEditor || video.editor || req.user.id;
      correctionRequest.correctedAt = correctionRequest.resolvedAt;
      correctionRequest.correctedVideo = video._id;
      await correctionRequest.save();
      await Video.findByIdAndUpdate(previousVideoId, {
        $set: {
          correctionStatus: 'resolved',
          activeCorrectionRequest: null,
          correctionResolvedBy: req.user.id,
          correctionResolvedAt: correctionRequest.resolvedAt,
          correctionResolvedNote: correctionRequest.resolutionNote,
        },
      });
      if (correctionRequest.correctionJob) {
        await EditJob.findByIdAndUpdate(correctionRequest.correctionJob, {
          $set: {
            workspaceState: 'closed',
            workspaceStateChangedAt: new Date(),
            workspaceStateChangedBy: req.user.id,
            workspaceStateReason: correctionRequest.resolutionNote,
          },
        });
      }
    }

    await AuditLog.create({
      action: 'Replace Show Material',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        itemId: item._id,
        previousVideoId,
        newVideoId: video._id,
        contentTypeId,
      },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({ message: 'Material replaced in show.', showDay: serializeShowDay(populatedShowDay, req.user) });
  } catch (error) {
    console.error('Error replacing show material:', error);
    res.status(500).json({ message: 'Error replacing show material' });
  }
});

router.patch('/show-day/:showDayId/items/:itemId', authorize(producerRoles), async (req, res) => {
  const { status } = req.body;

  if (!['scheduled', 'ready', 'aired', 'removed'].includes(status)) {
    return res.status(400).json({ message: 'Invalid item status.' });
  }

  try {
    const showDay = await ShowDay.findById(req.params.showDayId);
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    if (!userIsAssignedProducer(showDay, req.user)) {
      return res.status(403).json({ message: 'Join this show day before changing material.' });
    }

    const item = showDay.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Show item not found.' });

    if (item.status === status) {
      return res.status(409).json({ message: `Material is already ${status}.` });
    }

    const previousStatus = item.status;
    const materialTitle = item.title || `Material ${req.params.itemId}`;
    item.status = status;
    item.updatedAt = new Date();
    showDay.activityLog.push({
      action: 'update_material_status',
      summary: `"${materialTitle}" changed from ${previousStatus} to ${status}.`,
      performedBy: req.user.id,
      details: {
        itemId: req.params.itemId,
        videoId: item.video,
        title: materialTitle,
        previousStatus,
        status,
      },
    });

    if (status === 'aired') {
      await Video.findByIdAndUpdate(item.video, {
        broadcastStatus: 'aired',
        airedAt: new Date(),
        archivedAt: new Date(),
      });
    }

    await showDay.save();

    await AuditLog.create({
      action: 'Update Show Material Status',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        itemId: req.params.itemId,
        videoId: item.video,
        title: materialTitle,
        previousStatus,
        status,
      },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({ message: 'Material status updated.', showDay: serializeShowDay(populatedShowDay, req.user) });
  } catch (error) {
    console.error('Error updating show material:', error);
    res.status(500).json({ message: 'Error updating show material' });
  }
});

module.exports = router;
