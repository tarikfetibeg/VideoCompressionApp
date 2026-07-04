const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const Video = require('../models/Video');
const EditJob = require('../models/EditJob');
const ShowDay = require('../models/ShowDay');
const AuditLog = require('../models/AuditLog');
const { setDownloadHeaders } = require('../utils/downloadHeaders');

const allowedVideoRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Archivist', 'Admin'];
const allowedJobRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin'];
const productionRoles = ['Editor', 'VideoEditor', 'Producer', 'Admin'];
const airPackageRoles = ['Realizator', 'Producer', 'Admin'];

class DownloadHttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'DownloadHttpError';
    this.statusCode = statusCode;
  }
}

function assertRole(user, roles) {
  if (!user || !roles.includes(user.role)) {
    throw new DownloadHttpError(403, 'Forbidden');
  }
}

function getObjectIdString(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function getUploaderId(video) {
  if (!video || !video.uploader) return null;
  return getObjectIdString(video.uploader);
}

function userCanDownloadVideo(user, video) {
  if (!user || !video) return false;
  if (user.role === 'Admin') return true;

  if (user.role === 'Reporter') {
    return getUploaderId(video) === user.id;
  }

  return ['Editor', 'VideoEditor', 'Producer', 'Archivist'].includes(user.role);
}

function canAccessJob(user, job) {
  if (!user || !job) return false;
  if (user.role === 'Admin') return true;
  if (productionRoles.includes(user.role)) return true;
  return getObjectIdString(job.reporter) === user.id;
}

function canDownloadJobPackage(user, job) {
  if (!user || !job || !productionRoles.includes(user.role)) return false;
  if (['Admin', 'Producer'].includes(user.role)) return true;

  const assignedEditorId = getObjectIdString(job.assignedEditor);
  return assignedEditorId && assignedEditorId === user.id;
}

function resolveExistingPath(...candidatePaths) {
  for (const candidatePath of candidatePaths) {
    if (!candidatePath) continue;
    const resolvedPath = path.resolve(candidatePath);
    if (fs.existsSync(resolvedPath)) return resolvedPath;
  }

  return null;
}

function sanitizeFilename(value, fallback = 'untitled') {
  const sanitized = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

  return sanitized || fallback;
}

function sanitizePackageName(value) {
  return String(value || 'material')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'material';
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

function formatPackageDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function buildObjectIdSet(values = []) {
  return new Set((values || []).map(getObjectIdString).filter(Boolean));
}

function mergeObjectIds(existingIds = [], nextIds = []) {
  const ids = buildObjectIdSet(existingIds);
  nextIds.map(getObjectIdString).filter(Boolean).forEach((id) => ids.add(id));
  return Array.from(ids);
}

function getJobDownloadState(job, user) {
  if (!job || !user) return null;

  return (job.downloadStates || []).find(
    (entry) => getObjectIdString(entry.user) === user.id
  ) || null;
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

function getVideoSourcePath(video) {
  if (!video) return null;
  return resolveExistingPath(video.rawPath, video.filepath, video.compressedPath, video.previewPath);
}

function getVideoFilename(video, sourcePath) {
  const fallback = sourcePath ? path.basename(sourcePath) : 'source_video';
  return video?.originalFilename || video?.filename || fallback;
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
  const headingPattern = /^[A-Z\u010C\u0106\u017D\u0160\u0110 /-]+$/;
  const isHeading = headingPattern.test(String(text || '').trim()) && String(text || '').trim().length > 0;
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

function buildOffAudioEntries(offFiles = []) {
  return (offFiles || []).map((offFile, index) => {
    const sourcePath = resolveExistingPath(offFile.storagePath || offFile.path);
    const extension = path.extname(offFile.originalName || offFile.filename || '');
    const safeExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
    const baseName = sanitizeFilename(
      path.basename(offFile.originalName || offFile.filename || `off_${index + 1}`, extension),
      `off_${index + 1}`
    );

    return {
      id: offFile._id?.toString() || '',
      originalName: offFile.originalName || offFile.filename || `OFF ${index + 1}`,
      packagePath: `OFF/${padOrder(index + 1)}_${baseName}${safeExtension || ''}`,
      mimetype: offFile.mimetype || 'application/octet-stream',
      sourceAvailable: Boolean(sourcePath),
      sourcePath,
    };
  });
}

async function populateShowDay(query) {
  return query
    .populate('program')
    .populate('items.video', 'filename originalFilename finalTitle filepath rawPath compressedPath previewPath event tagDate airDate broadcastStatus finalApprovalStatus processingStatus thumbnailPath reporter editor qaResponsible')
    .populate('items.video.reporter', 'username role')
    .populate('items.video.editor', 'username role')
    .populate('items.video.qaResponsible', 'username role')
    .populate('items.contentType')
    .populate('activityLog.performedBy', 'username role');
}

function buildRundownText(showDay, items) {
  const lines = [
    `Program: ${showDay.program?.name || 'N/A'}`,
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

function pipeFileToResponse(res, filePath, onErrorMessage = 'Error downloading file') {
  const stream = fs.createReadStream(filePath);
  stream.on('error', (error) => {
    console.error(onErrorMessage, error);
    if (!res.headersSent) {
      res.status(500).json({ message: onErrorMessage });
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
}

async function streamSingleVideo({ user, payload, res }) {
  assertRole(user, allowedVideoRoles);

  const video = await Video.findById(payload.videoId);
  if (!video) throw new DownloadHttpError(404, 'Video not found');

  if (!userCanDownloadVideo(user, video)) {
    throw new DownloadHttpError(403, 'Forbidden: You do not have access to this video.');
  }

  const videoPath = resolveExistingPath(video.compressedPath, video.filepath);
  if (!videoPath) throw new DownloadHttpError(404, 'Video file not found on server');

  res.setHeader('Content-Type', 'application/octet-stream');
  setDownloadHeaders(res, video.originalFilename || video.filename || `video_${video._id}.mp4`, {
    fallback: `video_${video._id}.mp4`,
  });
  pipeFileToResponse(res, videoPath, 'Error downloading video');
}

async function streamBulkVideos({ user, payload, res }) {
  assertRole(user, allowedVideoRoles);

  const videoIds = Array.isArray(payload.videoIds) ? payload.videoIds : [];
  if (videoIds.length === 0) throw new DownloadHttpError(400, 'No videos selected');

  const zip = archiver('zip', { zlib: { level: 0 } });
  const zipFilename = `videos_${Date.now()}.zip`;

  res.setHeader('Content-Type', 'application/zip');
  setDownloadHeaders(res, zipFilename, { fallback: 'videos.zip' });

  zip.on('error', (error) => {
    console.error('Video ZIP archive error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating ZIP archive' });
    } else {
      res.destroy(error);
    }
  });

  zip.pipe(res);

  const videos = await Video.find({ _id: { $in: videoIds } });
  const orderedVideos = videoIds
    .map((videoId) => videos.find((video) => getObjectIdString(video._id) === String(videoId)))
    .filter(Boolean);

  orderedVideos.forEach((video, index) => {
    if (!userCanDownloadVideo(user, video)) return;

    const videoPath = resolveExistingPath(video.compressedPath, video.filepath);
    if (!videoPath) return;

    const fallbackName = `video_${index + 1}${path.extname(videoPath) || '.mp4'}`;
    zip.file(videoPath, { name: sanitizeFilename(video.originalFilename || video.filename || fallbackName, fallbackName) });
  });

  await zip.finalize();
}

async function loadJobForPackage(jobId) {
  return EditJob.findById(jobId)
    .populate('reporter', 'username role')
    .populate('assignedEditor', 'username role')
    .populate('changeLog.author', 'username role')
    .populate('downloadStates.user', 'username role')
    .populate(
      'segments.video',
      'filename originalFilename filepath rawPath compressedPath previewPath event location tagDate duration status processingStatus qcStatus broadcastStatus'
    );
}

async function streamEditPackage({ user, payload, res }) {
  assertRole(user, productionRoles);

  const job = await loadJobForPackage(payload.jobId);
  if (!job) throw new DownloadHttpError(404, 'Edit job not found');
  if (!canAccessJob(user, job)) throw new DownloadHttpError(403, 'Forbidden');
  if (!canDownloadJobPackage(user, job)) {
    throw new DownloadHttpError(409, 'Claim this job before downloading the edit package.');
  }

  const downloadScope = payload.scope === 'missing' ? 'missing' : 'all';
  const sortedSegments = [...(job.segments || [])].sort(
    (a, b) => Number(a.order || 0) - Number(b.order || 0)
  );

  if (sortedSegments.length === 0) {
    throw new DownloadHttpError(400, 'Edit job has no segments to package.');
  }

  const downloadState = getJobDownloadState(job, user);
  const downloadedSegmentIds = buildObjectIdSet(downloadState?.downloadedSegmentIds);
  const downloadedOffFileIds = buildObjectIdSet(downloadState?.downloadedOffFileIds);
  const packageSegments = downloadScope === 'missing'
    ? sortedSegments.filter((segment) => !downloadedSegmentIds.has(getObjectIdString(segment._id)))
    : sortedSegments;
  const packageOffFiles = downloadScope === 'missing'
    ? (job.offFiles || []).filter((offFile) => !downloadedOffFileIds.has(getObjectIdString(offFile._id)))
    : (job.offFiles || []);

  if (downloadScope === 'missing' && packageSegments.length === 0 && packageOffFiles.length === 0) {
    throw new DownloadHttpError(409, 'No new or previously missed job files to download.');
  }

  const packageEntries = packageSegments.map((segment, index) => {
    const sourcePath = getVideoSourcePath(segment.video);
    const videoFilename = getVideoFilename(segment.video, sourcePath);
    const sourceExt = sourcePath ? path.extname(sourcePath) : path.extname(videoFilename);
    const baseName = sanitizeFilename(path.basename(videoFilename, path.extname(videoFilename)), `clip_${index + 1}`);

    return {
      sourceFile: sourcePath ? `VIDEO/${padOrder(index + 1)}_${baseName}${sourceExt || ''}` : '',
      sourceAvailable: Boolean(sourcePath),
      sourcePath,
      segmentId: segment._id || null,
    };
  });

  const offAudioEntries = buildOffAudioEntries(packageOffFiles);
  const downloadableSegmentIds = packageEntries
    .filter((entry) => entry.sourceAvailable && entry.segmentId)
    .map((entry) => entry.segmentId);
  const downloadableOffFileIds = offAudioEntries
    .filter((entry) => entry.sourceAvailable && entry.id)
    .map((entry) => entry.id);
  const availableFileCount = downloadableSegmentIds.length + downloadableOffFileIds.length;

  if (downloadScope === 'missing' && availableFileCount === 0) {
    throw new DownloadHttpError(404, 'New job files exist, but none are currently available on disk.');
  }

  await markJobPackageDownloaded(job._id, user, downloadableSegmentIds, downloadableOffFileIds);

  const zipFilename = `${sanitizeFilename(job.title, 'edit_job')}_${job._id}_${downloadScope === 'missing' ? 'new_files' : 'edit_package'}.zip`;
  const archive = archiver('zip', { zlib: { level: 0 } });

  res.setHeader('Content-Type', 'application/zip');
  setDownloadHeaders(res, zipFilename, { fallback: 'edit_package.zip' });

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
    if (entry.sourcePath) archive.file(entry.sourcePath, { name: entry.packagePath });
  });
  packageEntries.forEach((entry) => {
    if (entry.sourcePath) archive.file(entry.sourcePath, { name: entry.sourceFile });
  });

  try {
    await AuditLog.create({
      action: 'Download Edit Job Package',
      performedBy: user.id,
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
}

async function streamOffFile({ user, payload, res }) {
  assertRole(user, allowedJobRoles);

  const job = await EditJob.findById(payload.jobId);
  if (!job) throw new DownloadHttpError(404, 'Edit job not found');
  if (!canAccessJob(user, job)) throw new DownloadHttpError(403, 'Forbidden');

  const offFile = job.offFiles.id(payload.fileId);
  if (!offFile) throw new DownloadHttpError(404, 'OFF file not found');

  const sourcePath = resolveExistingPath(offFile.storagePath || offFile.path);
  if (!sourcePath) throw new DownloadHttpError(404, 'OFF audio file is missing on disk.');

  res.setHeader('Content-Type', offFile.mimetype || 'application/octet-stream');
  setDownloadHeaders(res, offFile.originalName || offFile.filename || 'off_audio', {
    type: payload.inline ? 'inline' : 'attachment',
    fallback: 'off_audio',
  });
  pipeFileToResponse(res, sourcePath, 'Error serving OFF audio file');
}

async function streamAirPackage({ user, payload, res }) {
  assertRole(user, airPackageRoles);

  let showDay = await populateShowDay(ShowDay.findById(payload.showDayId));
  if (!showDay) throw new DownloadHttpError(404, 'Show day not found.');

  const activeItems = (showDay.items || [])
    .filter((item) => item.status !== 'removed')
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  if (activeItems.length === 0) {
    throw new DownloadHttpError(400, 'No active material in this show.');
  }

  const packageEntries = activeItems.map((item, index) => {
    const video = item.video;
    const sourcePath = resolveExistingPath(video?.compressedPath, video?.filepath, video?.rawPath, video?.previewPath);
    const baseTitle = item.title || video?.finalTitle || video?.originalFilename || video?.filename || `item_${index + 1}`;
    const extension = path.extname(sourcePath || video?.filename || video?.originalFilename || '.mp4') || '.mp4';

    return {
      item,
      sourcePath,
      fileName: `${padOrder(index + 1)}_${sanitizePackageName(baseTitle)}${extension}`,
    };
  });

  const availableEntries = packageEntries.filter((entry) => entry.sourcePath);
  if (availableEntries.length === 0) {
    throw new DownloadHttpError(404, 'Show material files are missing from local storage.');
  }

  const downloadTime = new Date();
  const mutableShowDay = await ShowDay.findById(showDay._id);
  const existingState = (mutableShowDay.downloadStates || []).find(
    (state) => getObjectIdString(state.user) === user.id
  );

  if (existingState) {
    existingState.lastDownloadedAt = downloadTime;
    existingState.downloadCount = Number(existingState.downloadCount || 0) + 1;
  } else {
    mutableShowDay.downloadStates.push({
      user: user.id,
      lastDownloadedAt: downloadTime,
      downloadCount: 1,
    });
  }

  mutableShowDay.activityLog.push({
    action: 'download_air_package',
    summary: `${user.username || 'Realizator'} downloaded the air package.`,
    performedBy: user.id,
    createdAt: downloadTime,
    details: {
      availableFiles: availableEntries.length,
      missingFiles: packageEntries.length - availableEntries.length,
    },
  });
  await mutableShowDay.save();

  try {
    await AuditLog.create({
      action: 'Download Show Air Package',
      performedBy: user.id,
      details: {
        showDayId: showDay._id,
        programId: showDay.program?._id || showDay.program,
        airDate: showDay.airDate,
        availableFiles: availableEntries.length,
        missingFiles: packageEntries.length - availableEntries.length,
      },
    });
  } catch (auditError) {
    console.error('Show package audit log error:', auditError);
  }

  showDay = await populateShowDay(ShowDay.findById(showDay._id));
  const zip = archiver('zip', { zlib: { level: 0 } });
  const programName = sanitizePackageName(showDay.program?.name || 'show');
  const airDate = new Date(showDay.airDate).toISOString().slice(0, 10);
  const zipFilename = `${programName}_${airDate}_air_package.zip`;
  const manifest = {
    program: showDay.program?.name || null,
    airDate,
    downloadedAt: downloadTime.toISOString(),
    downloadedBy: user.username || user.id,
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
  setDownloadHeaders(res, zipFilename, { fallback: 'air_package.zip' });

  zip.on('error', (error) => {
    console.error('Show package ZIP error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating show package.' });
    } else {
      res.destroy(error);
    }
  });

  zip.pipe(res);
  zip.append(buildRundownText(showDay, activeItems), { name: 'RUNDOWN.txt' });
  zip.append(JSON.stringify(manifest, null, 2), { name: 'show_manifest.json' });

  availableEntries.forEach((entry) => {
    zip.file(entry.sourcePath, { name: `VIDEO/${entry.fileName}` });
  });

  await zip.finalize();
}

async function streamDownloadByKind({ kind, payload, user, res }) {
  switch (kind) {
    case 'video-single':
      return streamSingleVideo({ user, payload, res });
    case 'video-bulk':
      return streamBulkVideos({ user, payload, res });
    case 'edit-package':
      return streamEditPackage({ user, payload, res });
    case 'edit-off-file':
      return streamOffFile({ user, payload, res });
    case 'air-package':
      return streamAirPackage({ user, payload, res });
    default:
      throw new DownloadHttpError(400, 'Unsupported download type.');
  }
}

module.exports = {
  DownloadHttpError,
  streamDownloadByKind,
  streamSingleVideo,
  streamBulkVideos,
  streamEditPackage,
  streamOffFile,
  streamAirPackage,
};
