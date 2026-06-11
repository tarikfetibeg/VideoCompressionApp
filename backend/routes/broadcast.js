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

const router = express.Router();

const allowedRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Admin'];
const producerRoles = ['Producer', 'Admin'];
const rundownReadRoles = ['Producer', 'Realizator', 'Admin'];
const downloadRoles = ['Realizator', 'Producer', 'Admin'];
const approvalRoles = ['Reporter', 'Producer', 'Admin'];
const directFinalUploadRoles = ['Editor', 'VideoEditor', 'Admin'];
const MAX_DIRECT_FINAL_FILES = parseInt(process.env.MAX_DIRECT_FINAL_FILES || '20', 10) || 20;
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

function getQaResponsibilityType(role) {
  if (role === 'Producer') return 'producer_override';
  if (role === 'Admin') return 'admin_override';
  return 'job_reporter';
}

async function ensureDefaultContentTypes() {
  const count = await BroadcastContentType.countDocuments();
  if (count > 0) return;
  await BroadcastContentType.insertMany(defaultContentTypes.map((type) => ({ ...type, active: true })));
}

async function populateShowDay(query) {
  return query
    .populate('program')
    .populate('producers', 'username role')
    .populate('items.video', 'filename originalFilename finalTitle event tagDate airDate broadcastStatus finalApprovalStatus processingStatus previewPath thumbnailPath reporter editor qaResponsible qaResponsibilityType')
    .populate('items.video.reporter', 'username role')
    .populate('items.video.editor', 'username role')
    .populate('items.video.qaResponsible', 'username role')
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

function buildLibraryVideoFilter({ contentTypeId, search }) {
  const filter = {
    status: 'edited',
    processingStatus: 'completed',
    broadcastStatus: { $in: ['approved_for_air', 'aired', 'archived'] },
    $or: [
      { finalApprovalStatus: 'approved' },
      { qcStatus: 'passed' },
      { broadcastStatus: { $in: ['aired', 'archived'] } },
    ],
  };

  if (contentTypeId && contentTypeId !== 'all') {
    filter.contentType = contentTypeId;
  }

  const trimmedSearch = String(search || '').trim();
  if (trimmedSearch) {
    const searchRegex = new RegExp(trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [{
      $or: [
        { finalTitle: searchRegex },
        { originalFilename: searchRegex },
        { filename: searchRegex },
        { event: searchRegex },
        { finalCategory: searchRegex },
        { keywords: searchRegex },
      ],
    }];
  }

  return filter;
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
  } = req.body;
  const retainedFilePaths = new Set();

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'At least one final video file is required.' });
    }

    const program = await BroadcastProgram.findById(programId);
    if (!program || !program.active) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Active broadcast program is required.' });
    }

    const contentType = await BroadcastContentType.findById(contentTypeId);
    if (!contentType || !contentType.active) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Active content type is required.' });
    }

    const parsedAirDate = parseAirDate(airDate);
    if (!parsedAirDate) {
      await removeUploadedFiles(req.files);
      return res.status(400).json({ message: 'Valid air date is required.' });
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
      const title = req.files.length === 1 && trimmedFinalTitle
        ? trimmedFinalTitle
        : trimmedFinalTitle
          ? `${trimmedFinalTitle} ${index + 1}`
          : file.originalname;
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
        tagDate: parsedAirDate,
        status: 'edited',
        processingStatus: 'queued',
        processingMode: 'finalize',
        processingProgress: 0,
        qcStatus: 'passed',
        qcNotes: notes || 'Direct editor QA upload.',
        qcCheckedBy: req.user.id,
        qcCheckedAt: new Date(),
        broadcastStatus: 'qc_pending',
        program: program._id,
        contentType: contentType._id,
        airDate: parsedAirDate,
        finalTitle: title,
        finalCategory: contentType.slug,
        finalApprovalStatus: 'approved',
        finalApprovedBy: req.user.id,
        finalApprovedAt: new Date(),
        finalApprovalRole: req.user.role,
        finalApprovalNotes: notes,
        qaResponsible: req.user.id,
        qaResponsibilityType: 'direct_editor',
        keywords: Array.from(new Set([program.name, contentType.name, title, reporter?.username, ...customKeywords].filter(Boolean))),
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
        programId: program._id,
        contentTypeId: contentType._id,
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
        programId: program._id,
        contentTypeId: contentType._id,
        airDate: parsedAirDate,
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
  const { programId, airDate, contentTypeId } = req.query;
  const filter = {
    status: 'edited',
    finalApprovalStatus: 'approved',
    processingStatus: 'completed',
    broadcastStatus: 'approved_for_air',
  };

  if (programId && programId !== 'all') filter.program = programId;
  if (contentTypeId && contentTypeId !== 'all') filter.contentType = contentTypeId;

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
    const videos = await Video.find(buildLibraryVideoFilter({ contentTypeId, search }))
      .populate('program')
      .populate('contentType')
      .populate('sourceJob', 'title reporter')
      .populate('uploader', 'username role')
      .populate('reporter', 'username role')
      .populate('editor', 'username role')
      .populate('qaResponsible', 'username role')
      .populate('finalApprovedBy', 'username role')
      .sort({ airedAt: -1, archivedAt: -1, finalApprovedAt: -1, uploadDate: -1 })
      .limit(parsedLimit);

    res.json(videos);
  } catch (error) {
    console.error('Error fetching producer library videos:', error);
    res.status(500).json({ message: 'Error fetching producer video library' });
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
    let showDay = await populateShowDay(ShowDay.findById(req.params.showDayId));
    if (!showDay) return res.status(404).json({ message: 'Show day not found.' });

    const activeItems = (showDay.items || [])
      .filter((item) => item.status !== 'removed')
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    if (activeItems.length === 0) {
      return res.status(400).json({ message: 'No active material in this show.' });
    }

    const packageEntries = activeItems.map((item, index) => {
      const video = item.video;
      const sourcePath = resolveExistingPath(video?.compressedPath, video?.filepath);
      const baseTitle = item.title || video?.finalTitle || video?.originalFilename || video?.filename || `item_${index + 1}`;
      const extension = path.extname(sourcePath || video?.filename || video?.originalFilename || '.mp4') || '.mp4';
      const fileName = `${String(index + 1).padStart(2, '0')}_${sanitizePackageName(baseTitle)}${extension}`;

      return {
        item,
        sourcePath,
        fileName,
        missing: !sourcePath,
      };
    });

    const availableEntries = packageEntries.filter((entry) => entry.sourcePath);
    if (availableEntries.length === 0) {
      return res.status(404).json({ message: 'Show material files are missing from local storage.' });
    }

    const downloadTime = new Date();
    const mutableShowDay = await ShowDay.findById(showDay._id);
    const existingState = (mutableShowDay.downloadStates || []).find(
      (state) => getObjectIdString(state.user) === req.user.id
    );

    if (existingState) {
      existingState.lastDownloadedAt = downloadTime;
      existingState.downloadCount = Number(existingState.downloadCount || 0) + 1;
    } else {
      mutableShowDay.downloadStates.push({
        user: req.user.id,
        lastDownloadedAt: downloadTime,
        downloadCount: 1,
      });
    }

    mutableShowDay.activityLog.push({
      action: 'download_air_package',
      summary: `${req.user.username || 'Realizator'} downloaded the air package.`,
      performedBy: req.user.id,
      createdAt: downloadTime,
      details: {
        availableFiles: availableEntries.length,
        missingFiles: packageEntries.length - availableEntries.length,
      },
    });
    await mutableShowDay.save();

    await AuditLog.create({
      action: 'Download Show Air Package',
      performedBy: req.user.id,
      details: {
        showDayId: showDay._id,
        programId: showDay.program?._id || showDay.program,
        airDate: showDay.airDate,
        availableFiles: availableEntries.length,
        missingFiles: packageEntries.length - availableEntries.length,
      },
    });

    showDay = await populateShowDay(ShowDay.findById(showDay._id));

    const zip = archiver('zip', { zlib: { level: 0 } });
    const programName = sanitizePackageName(showDay.program?.name || 'show');
    const airDate = new Date(showDay.airDate).toISOString().slice(0, 10);
    const zipFilename = `${programName}_${airDate}_air_package.zip`;
    const manifest = {
      program: showDay.program?.name || null,
      airDate,
      downloadedAt: downloadTime.toISOString(),
      downloadedBy: req.user.username || req.user.id,
      items: packageEntries.map((entry, index) => ({
        order: index + 1,
        title: entry.item.title || entry.item.video?.finalTitle || entry.item.video?.originalFilename || null,
        contentType: entry.item.contentType?.name || null,
        status: entry.item.status,
        file: entry.sourcePath ? entry.fileName : null,
        sourceAvailable: Boolean(entry.sourcePath),
        reporter: entry.item.video?.reporter?.username || null,
        editor: entry.item.video?.editor?.username || null,
        qaResponsible: entry.item.video?.qaResponsible?.username || null,
      })),
    };

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    zip.on('error', (error) => {
      console.error('Show package ZIP error:', error);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error creating show package.' });
      }
    });

    zip.pipe(res);
    zip.append(buildRundownText(showDay, activeItems), { name: 'RUNDOWN.txt' });
    zip.append(JSON.stringify(manifest, null, 2), { name: 'show_manifest.json' });

    availableEntries.forEach((entry) => {
      zip.file(entry.sourcePath, { name: `VIDEO/${entry.fileName}` });
    });

    await zip.finalize();
  } catch (error) {
    console.error('Error downloading show package:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error downloading show package' });
    }
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

    item.status = status;
    item.updatedAt = new Date();
    showDay.activityLog.push({
      action: 'update_material_status',
      summary: `Material status changed to ${status}.`,
      performedBy: req.user.id,
      details: { itemId: req.params.itemId, status },
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
      details: { showDayId: showDay._id, itemId: req.params.itemId, status },
    });

    const populatedShowDay = await populateShowDay(ShowDay.findById(showDay._id));
    res.json({ message: 'Material status updated.', showDay: serializeShowDay(populatedShowDay, req.user) });
  } catch (error) {
    console.error('Error updating show material:', error);
    res.status(500).json({ message: 'Error updating show material' });
  }
});

module.exports = router;
