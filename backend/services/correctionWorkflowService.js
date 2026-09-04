const BroadcastContentType = require('../models/BroadcastContentType');
const CorrectionRequest = require('../models/CorrectionRequest');
const EditJob = require('../models/EditJob');
const User = require('../models/User');
const Video = require('../models/Video');
const { applySlaToJob } = require('./editJobLifecycleService');
const { enqueueDomainEvent } = require('./domainEventService');

const OPEN_CORRECTION_STATUSES = [
  'reported',
  'assigned',
  'in_edit',
  'ready_for_review',
];
const ISSUE_SEVERITY_ORDER = { minor: 1, major: 2, blocking: 3 };
const ISSUE_TYPE_LABELS = {
  picture: 'Slika',
  audio: 'Zvuk',
  edit: 'Montaža/rez',
  graphics: 'Grafika/titl',
  wrong_version: 'Pogrešna verzija',
  technical: 'Tehnička greška',
  other: 'Ostalo',
};

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

function formatTimestamp(seconds) {
  const value = Math.max(Number(seconds) || 0, 0);
  const minutes = Math.floor(value / 60);
  const remainder = (value % 60).toFixed(2).padStart(5, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function normalizeIssue(issue, reportedBy) {
  const startSeconds = Math.max(Number(issue?.startSeconds) || 0, 0);
  const rawEnd = issue?.endSeconds;
  const endSeconds = rawEnd === '' || rawEnd == null
    ? undefined
    : Math.max(Number(rawEnd) || 0, startSeconds);
  return {
    type: ISSUE_TYPE_LABELS[issue?.type] ? issue.type : 'other',
    severity: ISSUE_SEVERITY_ORDER[issue?.severity] ? issue.severity : 'major',
    startSeconds,
    endSeconds,
    note: String(issue?.note || '').trim(),
    reportedBy: getObjectId(reportedBy),
    reportedAt: issue?.reportedAt ? new Date(issue.reportedAt) : new Date(),
  };
}

function getRequestIssues(request) {
  if (Array.isArray(request?.issues) && request.issues.length > 0) return request.issues;
  if (!String(request?.note || '').trim()) return [];
  return [{
    type: 'other',
    severity: request?.highestSeverity || 'major',
    startSeconds: Math.max(Number(request?.timestamp) || 0, 0),
    note: request.note,
    reportedBy: request.reportedBy,
    reportedAt: request.createdAt || request.updatedAt || new Date(),
    legacy: true,
  }];
}

function getHighestSeverity(issues = []) {
  return issues.reduce((highest, issue) => (
    (ISSUE_SEVERITY_ORDER[issue?.severity] || 0) > (ISSUE_SEVERITY_ORDER[highest] || 0)
      ? issue.severity
      : highest
  ), 'minor');
}

function buildIssueText(issues = []) {
  return issues.map((issue, index) => {
    const range = issue.endSeconds != null
      ? `${formatTimestamp(issue.startSeconds)}-${formatTimestamp(issue.endSeconds)}`
      : formatTimestamp(issue.startSeconds);
    return `${index + 1}. [${ISSUE_TYPE_LABELS[issue.type] || ISSUE_TYPE_LABELS.other}] [${range}] ${issue.note}`;
  }).join('\n');
}

function applyIssuesToRequest(request) {
  const issues = getRequestIssues(request);
  request.highestSeverity = getHighestSeverity(issues);
  request.timestamp = issues.length > 0
    ? Math.min(...issues.map((issue) => Math.max(Number(issue.startSeconds) || 0, 0)))
    : Math.max(Number(request.timestamp) || 0, 0);
  request.note = issues.length === 1
    ? String(issues[0].note || '').trim()
    : `${issues.length} prijavljenih grešaka (${request.highestSeverity}).`;
  return issues;
}

function applyIssuesToCorrectionJob(job, request, video) {
  const issues = getRequestIssues(request);
  const issueText = buildIssueText(issues) || request.note;
  job.description = request.note;
  job.scriptText = `Prijavljene greške za video:\n\n${issueText}`;
  const title = video.finalTitle || video.originalFilename || video.filename || 'Video';
  const segment = job.segments?.[0];
  if (segment) {
    segment.notes = issueText;
    segment.startTime = Math.max(Number(request.timestamp || 0) - 3, 0);
  } else {
    job.segments = [{
      video: video._id,
      order: 0,
      title,
      notes: issueText,
      type: 'other',
      startTime: Math.max(Number(request.timestamp || 0) - 3, 0),
      required: true,
    }];
  }
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
      }
      if (['reported', 'assigned'].includes(request.status)) {
        existingJob.status = request.assignedEditor ? 'claimed' : 'submitted';
        existingJob.workspaceState = 'active';
      }
      applyIssuesToCorrectionJob(existingJob, request, video);
      await existingJob.save();
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
    scriptText: '',
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
      notes: request.note,
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
  applyIssuesToCorrectionJob(job, request, video);
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

async function enqueueCorrectionNotification({
  request,
  correctionJob,
  video,
  sourceJob,
  actor,
  severity = 'action_required',
}) {
  const reporterId = getObjectId(sourceJob?.reporter) || getObjectId(video?.reporter);
  const editorId = getObjectId(request?.assignedEditor);
  const title = video.finalTitle || video.originalFilename || video.filename || 'Video';
  return enqueueDomainEvent({
    type: severity === 'critical' ? 'correction.critical_reported' : 'correction.reported',
    severity,
    actor,
    recipients: [reporterId, editorId].filter(Boolean),
    recipientRoles: ['Producer'],
    entityType: 'correction',
    entityId: request._id,
    entityVersion: Math.floor(new Date(request.updatedAt || Date.now()).getTime() / 1000),
    title: severity === 'critical' ? 'Hitna ispravka video materijala' : 'Video traži ispravku',
    bodyPreview: `${title}: ${request.note}`,
    deepLink: correctionJob
      ? `vca://job/${correctionJob._id}`
      : `vca://video/${video._id}`,
    payload: {
      correctionRequestId: request._id,
      jobId: correctionJob?._id || null,
      videoId: video._id,
      timestamp: request.timestamp || 0,
    },
    dedupeKey: `correction:${request._id}:${new Date(request.updatedAt || Date.now()).getTime()}`,
  });
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
    const issue = normalizeIssue({
      type: 'other',
      severity: 'major',
      startSeconds: 0,
      note: normalizedNote,
    }, actorId);
    request = await CorrectionRequest.create({
      video: video._id,
      sourceJob: sourceJob?._id || null,
      origin,
      reportedBy: actorId,
      assignedEditor,
      note: normalizedNote,
      timestamp: 0,
      issues: [issue],
      highestSeverity: issue.severity,
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

  await enqueueCorrectionNotification({
    request,
    correctionJob,
    video,
    sourceJob,
    actor: actorId,
    severity: 'action_required',
  });

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
  const issue = normalizeIssue({
    type: 'other',
    severity: 'blocking',
    startSeconds: normalizedTimestamp,
    note,
  }, user.id);

  if (request) {
    request.issues = [
      ...getRequestIssues(request).map((item) => normalizeIssue(item, item.reportedBy || request.reportedBy)),
      issue,
    ];
    applyIssuesToRequest(request);
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
      issues: [issue],
      highestSeverity: issue.severity,
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
  await enqueueCorrectionNotification({
    request,
    correctionJob,
    video,
    sourceJob,
    actor: user.id,
    severity: 'critical',
  });
  return { request, correctionJob };
}

async function addIssuesToCorrectionRequest({
  video,
  user,
  issues,
  assignedEditorId = null,
  origin = 'archive',
}) {
  const sourceJob = video.sourceJob
    ? await EditJob.findById(video.sourceJob)
      .populate('contentType', 'name slug autoExpireJobs jobSlaHours jobGraceHours')
    : null;
  let request = await findOpenRequestForVideo(video._id);
  const selectedEditor = assignedEditorId
    ? await User.findOne({ _id: assignedEditorId, role: { $in: ['Editor', 'VideoEditor'] } }).select('_id')
    : null;
  if (assignedEditorId && !selectedEditor) {
    const error = new Error('Odabrani montažer nije dostupan.');
    error.statusCode = 400;
    throw error;
  }

  const suggestedEditor = selectedEditor?._id || await resolveEditorId(sourceJob, video);
  const normalizedIssues = issues.map((issueItem) => normalizeIssue(issueItem, user.id || user._id));

  if (request) {
    const currentEditorId = getObjectId(request.assignedEditor);
    if (
      request.status === 'in_edit'
      && selectedEditor
      && currentEditorId
      && String(currentEditorId) !== String(selectedEditor._id)
      && !['Producer', 'Admin'].includes(user.role)
    ) {
      const error = new Error('Ispravka je već u montaži. Promjenu montažera radi Producent ili Admin.');
      error.statusCode = 409;
      throw error;
    }

    const existingIssues = getRequestIssues(request)
      .map((item) => normalizeIssue(item, item.reportedBy || request.reportedBy));
    if (existingIssues.length + normalizedIssues.length > 100) {
      const error = new Error('Jedan zahtjev može sadržavati najviše 100 prijavljenih grešaka.');
      error.statusCode = 400;
      throw error;
    }
    request.issues = [...existingIssues, ...normalizedIssues];
    request.reportedBy = user.id || user._id;
    request.origin = origin;
    request.seenBy = [];
    if (selectedEditor || (!request.assignedEditor && suggestedEditor)) {
      request.assignedEditor = selectedEditor?._id || suggestedEditor;
    }
    if (
      request.status === 'in_edit'
      && selectedEditor
      && currentEditorId
      && String(currentEditorId) !== String(selectedEditor._id)
      && ['Producer', 'Admin'].includes(user.role)
    ) {
      request.status = 'assigned';
    }
    if (request.status === 'ready_for_review') {
      request.status = request.assignedEditor ? 'assigned' : 'reported';
      request.correctedBy = null;
      request.correctedAt = null;
      request.correctedVideo = null;
    } else if (request.status === 'reported' && request.assignedEditor) {
      request.status = 'assigned';
    }
    applyIssuesToRequest(request);
    await request.save();
  } else {
    request = new CorrectionRequest({
      video: video._id,
      sourceJob: sourceJob?._id || null,
      origin,
      reportedBy: user.id || user._id,
      assignedEditor: suggestedEditor || null,
      note: normalizedIssues[0].note,
      timestamp: normalizedIssues[0].startSeconds,
      issues: normalizedIssues,
      highestSeverity: getHighestSeverity(normalizedIssues),
      status: suggestedEditor ? 'assigned' : 'reported',
      seenBy: [],
    });
    applyIssuesToRequest(request);
    await request.save();
  }

  const correctionJob = await ensureCorrectionJob(request, {
    video,
    sourceJob,
    assignedEditor: getObjectId(request.assignedEditor),
    actor: user.id || user._id,
  });
  await Video.updateOne({ _id: video._id }, {
    $set: {
      activeCorrectionRequest: request._id,
      correctionStatus: 'needs_correction',
      correctionNote: request.note,
      correctionReportedBy: user.id || user._id,
      correctionReportedAt: new Date(),
    },
  });
  await enqueueCorrectionNotification({
    request,
    correctionJob,
    video,
    sourceJob,
    actor: user.id || user._id,
    severity: request.highestSeverity === 'blocking' ? 'critical' : 'action_required',
  });
  return { request, correctionJob, sourceJob };
}

module.exports = {
  OPEN_CORRECTION_STATUSES,
  ISSUE_TYPE_LABELS,
  addIssuesToCorrectionRequest,
  applyIssuesToCorrectionJob,
  applyIssuesToRequest,
  createOrUpdateCorrectionRequest,
  ensureCorrectionJob,
  ensureVideoCorrectionRequest,
  findOpenRequestForVideo,
  getRequestIssues,
  syncTaggedCorrectionRequests,
};
