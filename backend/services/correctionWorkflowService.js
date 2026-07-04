const BroadcastContentType = require('../models/BroadcastContentType');
const CorrectionRequest = require('../models/CorrectionRequest');
const EditJob = require('../models/EditJob');
const User = require('../models/User');
const Video = require('../models/Video');
const { applySlaToJob } = require('./editJobLifecycleService');

const OPEN_CORRECTION_STATUSES = [
  'reported',
  'assigned',
  'in_edit',
  'ready_for_review',
];

function getObjectId(value) {
  return value?._id || value || null;
}

function getCorrectionDeadline(sourceJob) {
  const fourHoursFromNow = new Date(Date.now() + 4 * 60 * 60 * 1000);
  const sourceDeadline = sourceJob?.deadline ? new Date(sourceJob.deadline) : null;
  if (sourceDeadline && !Number.isNaN(sourceDeadline.getTime()) && sourceDeadline > new Date()) {
    return sourceDeadline < fourHoursFromNow ? sourceDeadline : fourHoursFromNow;
  }
  return fourHoursFromNow;
}

async function resolveEditorId(sourceJob, video) {
  const candidate = getObjectId(sourceJob?.assignedEditor) || getObjectId(video?.editor);
  if (!candidate) return null;
  const editor = await User.findOne({
    _id: candidate,
    role: { $in: ['Editor', 'VideoEditor'] },
  }).select('_id');
  return editor?._id || null;
}

async function ensureCorrectionJob(request, { video, sourceJob = null, assignedEditor = null, actor }) {
  if (request.correctionJob) {
    const existingJob = await EditJob.findById(request.correctionJob);
    if (existingJob) {
      if (assignedEditor && String(existingJob.assignedEditor || '') !== String(assignedEditor)) {
        existingJob.assignedEditor = assignedEditor;
        existingJob.status = 'claimed';
        existingJob.workspaceState = 'active';
        await existingJob.save();
      }
      return existingJob;
    }
  }

  const reporterId = getObjectId(sourceJob?.reporter)
    || getObjectId(video.reporter)
    || getObjectId(video.uploader);
  if (!reporterId) return null;

  let contentType = null;
  const contentTypeId = getObjectId(sourceJob?.contentType) || getObjectId(video.contentType);
  if (contentTypeId) {
    contentType = await BroadcastContentType.findById(contentTypeId);
  }

  const title = video.finalTitle || video.originalFilename || video.filename || 'Video';
  const deadline = getCorrectionDeadline(sourceJob);
  const job = new EditJob({
    title: `Ispravka: ${title}`,
    description: request.note,
    scriptText: `Prijavljena greška na ${Number(request.timestamp || 0).toFixed(2)}s.\n\n${request.note}`,
    program: sourceJob?.program || '',
    contentType: contentType?._id || contentTypeId || null,
    deadline,
    priority: 'urgent',
    status: assignedEditor ? 'claimed' : 'submitted',
    workspaceState: 'active',
    jobKind: 'correction',
    parentJob: sourceJob?._id || null,
    sourceVideo: video._id,
    correctionRequest: request._id,
    reporter: reporterId,
    assignedEditor: assignedEditor || null,
    segments: [{
      video: video._id,
      order: 0,
      title,
      notes: `${request.note} / timestamp ${Number(request.timestamp || 0).toFixed(2)}s`,
      type: 'other',
      startTime: Math.max(Number(request.timestamp || 0) - 3, 0),
      required: true,
    }],
    changeLog: [{
      type: 'job_created',
      summary: 'Correction job automatski kreiran iz prijave za ispravku.',
      author: actor,
      actorRole: request.origin === 'archive' ? 'Archivist' : request.origin === 'realization' ? 'Realizator' : 'System',
      details: {
        correctionRequestId: request._id,
        sourceVideoId: video._id,
        timestamp: request.timestamp,
      },
      createdAt: new Date(),
    }],
  });
  if (contentType) applySlaToJob(job, contentType, { deadline });
  else job.expiresAt = new Date(deadline.getTime() + 4 * 60 * 60 * 1000);
  await job.save();

  request.correctionJob = job._id;
  request.assignedEditor = assignedEditor || null;
  request.status = assignedEditor ? 'assigned' : 'reported';
  await request.save();
  return job;
}

async function findOpenRequestForVideo(videoId) {
  return CorrectionRequest.findOne({
    video: videoId,
    status: { $in: OPEN_CORRECTION_STATUSES },
  }).sort({ updatedAt: -1 });
}

function getFallbackReporterId(video) {
  return getObjectId(video.correctionReportedBy)
    || getObjectId(video.archiveReviewedBy)
    || getObjectId(video.reporter)
    || getObjectId(video.editor)
    || getObjectId(video.uploader);
}

async function ensureVideoCorrectionRequest({
  video,
  user = null,
  note = '',
  origin = 'video_status',
}) {
  let request = await findOpenRequestForVideo(video._id);
  const sourceJob = video.sourceJob
    ? await EditJob.findById(video.sourceJob)
      .populate('contentType', 'name slug autoExpireJobs jobSlaHours jobGraceHours')
    : null;
  const assignedEditor = await resolveEditorId(sourceJob, video);
  let actorId = getObjectId(user?.id || user?._id) || getFallbackReporterId(video);
  if (!actorId) {
    const fallbackAdmin = await User.findOne({ role: 'Admin' }).select('_id');
    actorId = fallbackAdmin?._id || null;
  }
  if (!actorId) return { request: null, correctionJob: null, skipped: 'missing_actor' };

  const normalizedNote = String(note || video.correctionNote || 'Video je označen kao potrebna ispravka.').trim();
  if (request) {
    if (normalizedNote) request.note = normalizedNote;
    if (assignedEditor && !request.assignedEditor) {
      request.assignedEditor = assignedEditor;
      if (request.status === 'reported') request.status = 'assigned';
    }
    if (!request.origin || request.origin === 'video_status') request.origin = origin;
    request.seenBy = [];
    await request.save();
  } else {
    request = await CorrectionRequest.create({
      video: video._id,
      sourceJob: sourceJob?._id || null,
      origin,
      reportedBy: actorId,
      assignedEditor,
      note: normalizedNote,
      timestamp: 0,
      status: assignedEditor ? 'assigned' : 'reported',
      seenBy: [],
    });
  }

  const correctionJob = await ensureCorrectionJob(request, {
    video,
    sourceJob,
    assignedEditor,
    actor: actorId,
  });

  await Video.updateOne(
    { _id: video._id },
    {
      $set: {
        activeCorrectionRequest: request._id,
        correctionStatus: 'needs_correction',
        correctionNote: normalizedNote,
      },
    }
  );

  return { request, correctionJob, skipped: null };
}

async function syncTaggedCorrectionRequests({ limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const videos = await Video.find({
    correctionStatus: 'needs_correction',
    $or: [
      { activeCorrectionRequest: { $exists: false } },
      { activeCorrectionRequest: null },
    ],
  })
    .select('_id filename originalFilename finalTitle correctionNote correctionReportedBy archiveReviewedBy reporter editor uploader sourceJob contentType')
    .limit(safeLimit);

  const result = { checked: videos.length, createdOrLinked: 0, skipped: 0 };
  for (const video of videos) {
    const ensured = await ensureVideoCorrectionRequest({
      video,
      note: video.correctionNote,
      origin: 'video_status',
    });
    if (ensured.request) result.createdOrLinked += 1;
    else result.skipped += 1;
  }
  return result;
}

async function createOrUpdateCorrectionRequest({
  showDay,
  item,
  video,
  user,
  note,
  timestamp = 0,
}) {
  const normalizedTimestamp = Math.max(Number(timestamp) || 0, 0);
  let request = await CorrectionRequest.findOne({
    video: video._id,
    status: { $in: OPEN_CORRECTION_STATUSES },
  }).sort({ updatedAt: -1 });
  const sourceJob = video.sourceJob
    ? await EditJob.findById(video.sourceJob)
      .populate('contentType', 'name slug autoExpireJobs jobSlaHours jobGraceHours')
    : null;
  const assignedEditor = await resolveEditorId(sourceJob, video);

  if (request) {
    request.note = note;
    request.timestamp = normalizedTimestamp;
    request.reportedBy = user.id;
    request.showDay = showDay._id;
    request.showDayItem = item._id;
    request.origin = 'realization';
    request.seenBy = [];
    if (assignedEditor) request.assignedEditor = assignedEditor;
    await request.save();
  } else {
    request = await CorrectionRequest.create({
      video: video._id,
      showDay: showDay._id,
      showDayItem: item._id,
      origin: 'realization',
      sourceJob: sourceJob?._id || null,
      reportedBy: user.id,
      assignedEditor,
      note,
      timestamp: normalizedTimestamp,
      status: assignedEditor ? 'assigned' : 'reported',
      seenBy: [],
    });
  }

  const correctionJob = await ensureCorrectionJob(request, {
    video,
    sourceJob,
    assignedEditor,
    actor: user.id,
  });
  await Video.updateOne(
    { _id: video._id },
    { $set: { activeCorrectionRequest: request._id } }
  );
  return { request, correctionJob };
}

module.exports = {
  OPEN_CORRECTION_STATUSES,
  createOrUpdateCorrectionRequest,
  ensureCorrectionJob,
  ensureVideoCorrectionRequest,
  findOpenRequestForVideo,
  syncTaggedCorrectionRequests,
};
