const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const BroadcastProgram = require('../models/BroadcastProgram');
const BroadcastContentType = require('../models/BroadcastContentType');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { PROJECT_ROOT, paths } = require('../utils/storagePaths');

const router = express.Router();

const archiveRoles = ['Archivist', 'Admin'];
const archiveReviewStatuses = ['unreviewed', 'reviewed', 'needs_metadata', 'duplicate'];
const reporterRoles = ['Reporter', 'Producer', 'Admin'];
const editorRoles = ['Editor', 'VideoEditor', 'Admin'];
const archiveSortFields = ['uploadDate', 'name', 'category', 'tags', 'reporter', 'editor'];
const videoPathFields = ['filepath', 'rawPath', 'compressedPath', 'previewPath', 'thumbnailPath'];
const deleteRoots = [paths.root, path.join(PROJECT_ROOT, 'uploads')];

router.use(authenticateToken);
router.use(authorize(archiveRoles));

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTagList(tags) {
  const values = Array.isArray(tags)
    ? tags
    : String(tags || '').split(',');

  const tagMap = new Map();
  values
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = tag.toLocaleLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, tag);
    });

  return Array.from(tagMap.values()).sort((a, b) => a.localeCompare(b));
}

function normalizeOptionalObjectId(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'none' || normalized === 'ingest') return null;
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    const error = new Error('Invalid object id.');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function normalizeOptionalDate(value) {
  if (!String(value || '').trim()) return null;

  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('Invalid date value.');
    error.statusCode = 400;
    throw error;
  }

  return date;
}

function normalizeDateForCompare(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getObjectIdString(value) {
  if (!value) return null;
  if (value._id) return value._id.toString();
  return value.toString();
}

function valuesMatch(previousValue, nextValue) {
  return JSON.stringify(previousValue ?? null) === JSON.stringify(nextValue ?? null);
}

function buildMetadataSnapshot(video) {
  return {
    finalTitle: video.finalTitle || '',
    event: video.event || '',
    tagDate: normalizeDateForCompare(video.tagDate),
    programId: getObjectIdString(video.program),
    contentTypeId: getObjectIdString(video.contentType),
    finalCategory: video.finalCategory || '',
    reporterId: getObjectIdString(video.reporter),
    editorId: getObjectIdString(video.editor),
    keywords: normalizeTagList(video.keywords || []),
    archiveReviewNotes: video.archiveReviewNotes || '',
  };
}

function buildChangedFields(previousSnapshot, nextSnapshot) {
  return Object.keys(nextSnapshot)
    .filter((field) => !valuesMatch(previousSnapshot[field], nextSnapshot[field]))
    .map((field) => ({
      field,
      from: previousSnapshot[field] ?? null,
      to: nextSnapshot[field] ?? null,
    }));
}

function buildArchiveMaterialBaseFilter() {
  return {
    status: 'edited',
    processingStatus: 'completed',
  };
}

function getSortValue(video, sortBy) {
  if (sortBy === 'name') return getVideoTitle(video).toLocaleLowerCase();
  if (sortBy === 'category') return String(video.contentType?.name || video.finalCategory || '').toLocaleLowerCase();
  if (sortBy === 'tags') return normalizeTagList(video.keywords || []).join(' ').toLocaleLowerCase();
  if (sortBy === 'reporter') return String(video.reporter?.username || '').toLocaleLowerCase();
  if (sortBy === 'editor') return String(video.editor?.username || '').toLocaleLowerCase();
  return new Date(video.uploadDate || video.archivedAt || 0).getTime();
}

function sortArchiveVideos(videos, sortBy = 'uploadDate', sortOrder = 'desc') {
  const normalizedSort = archiveSortFields.includes(sortBy) ? sortBy : 'uploadDate';
  const direction = sortOrder === 'asc' ? 1 : -1;

  return videos.sort((a, b) => {
    const aValue = getSortValue(a, normalizedSort);
    const bValue = getSortValue(b, normalizedSort);

    if (typeof aValue === 'number' || typeof bValue === 'number') {
      return ((Number(aValue) || 0) - (Number(bValue) || 0)) * direction;
    }

    const result = String(aValue || '').localeCompare(String(bValue || ''));
    if (result !== 0) return result * direction;

    return getVideoTitle(a).localeCompare(getVideoTitle(b));
  });
}

function populateArchiveVideo(query) {
  return query
    .populate('uploader', 'username role')
    .populate('reporter', 'username role')
    .populate('editor', 'username role')
    .populate('qaResponsible', 'username role')
    .populate('correctionReportedBy', 'username role')
    .populate('archiveReviewedBy', 'username role')
    .populate('archiveTagsUpdatedBy', 'username role')
    .populate('duplicateOf', 'filename originalFilename finalTitle')
    .populate('program')
    .populate('contentType');
}

function buildArchiveVideoFilter(query = {}) {
  const filter = buildArchiveMaterialBaseFilter();
  const andConditions = [];
  const review = String(query.review || 'unreviewed');
  const workflow = String(query.workflow || 'all');
  const search = String(query.q || '').trim();

  if (review === 'unreviewed') {
    andConditions.push({
      $or: [
        { archiveReviewStatus: { $exists: false } },
        { archiveReviewStatus: 'unreviewed' },
        { archiveReviewStatus: null },
      ],
    });
  } else if (archiveReviewStatuses.includes(review)) {
    filter.archiveReviewStatus = review;
  }

  if (workflow === 'archive') {
    andConditions.push({
      $or: [
        { broadcastStatus: { $in: ['approved_for_air', 'aired', 'archived'] } },
        { finalApprovalStatus: 'approved' },
      ],
    });
  } else if (workflow === 'aired') {
    filter.broadcastStatus = { $in: ['aired', 'archived'] };
  } else if (workflow === 'edited') {
    filter.broadcastStatus = { $nin: ['aired', 'archived'] };
  } else if (workflow === 'needs_correction') {
    filter.correctionStatus = 'needs_correction';
  }

  if (query.contentTypeId && query.contentTypeId !== 'all') {
    filter.contentType = query.contentTypeId;
  }

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    andConditions.push({
      $or: [
        { filename: regex },
        { originalFilename: regex },
        { finalTitle: regex },
        { event: regex },
        { finalCategory: regex },
        { keywords: regex },
        { archiveReviewNotes: regex },
      ],
    });
  }

  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  return filter;
}

function getVideoTitle(video) {
  return video.finalTitle || video.originalFilename || video.filename || 'Untitled';
}

function normalizeComparableTitle(value) {
  const parsed = path.parse(String(value || '').trim());
  const base = parsed.name || value || '';
  return String(base)
    .toLocaleLowerCase()
    .replace(/\b(19|20)\d{2}[-_. ]?[01]?\d[-_. ]?[0-3]?\d\b/g, ' ')
    .replace(/\b[0-3]?\d[-_. ][01]?\d[-_. ](19|20)\d{2}\b/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getComparableSize(video) {
  return Math.round(Number(video.sizeCompressed || video.sizeOriginal || video.sizePreview || 0));
}

function getComparableDuration(video) {
  return Math.round(Number(video.duration || video.sourceDuration || 0));
}

function getDuplicateKey(video) {
  const title = normalizeComparableTitle(getVideoTitle(video));
  const size = getComparableSize(video);
  const duration = getComparableDuration(video);

  if (!title || !size) return null;
  return `${title}|${size}|${duration || 'no-duration'}`;
}

function buildDuplicateGroups(videos = []) {
  const groups = new Map();

  videos.forEach((video) => {
    const key = getDuplicateKey(video);
    if (!key) return;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        title: normalizeComparableTitle(getVideoTitle(video)),
        count: 0,
        totalSize: 0,
        videos: [],
      });
    }

    const group = groups.get(key);
    const size = getComparableSize(video);
    group.count += 1;
    group.totalSize += size;
    group.videos.push(video);
  });

  return Array.from(groups.values())
    .filter((group) => group.count > 1)
    .map((group) => ({
      ...group,
      videos: group.videos.sort((a, b) => {
        const aTime = new Date(a.archivedAt || a.uploadDate || 0).getTime();
        const bTime = new Date(b.archivedAt || b.uploadDate || 0).getTime();
        return aTime - bTime;
      }),
    }))
    .sort((a, b) => b.totalSize - a.totalSize);
}

function isPathInside(parentPath, candidatePath) {
  if (!candidatePath) return false;
  const resolvedParent = path.resolve(parentPath);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedParent || resolvedCandidate.startsWith(`${resolvedParent}${path.sep}`);
}

function isDeletableVideoPath(filePath) {
  if (!filePath) return false;
  const resolvedPath = path.resolve(filePath);
  return deleteRoots.some((root) => isPathInside(root, resolvedPath));
}

async function isPathReferencedByAnotherVideo(videoId, filePath) {
  if (!filePath) return false;
  const resolvedPath = path.resolve(filePath);
  const videos = await Video.find({
    _id: { $ne: videoId },
    $or: videoPathFields.map((field) => ({
      [field]: { $exists: true, $nin: [null, ''] },
    })),
  }).select(videoPathFields.join(' '));

  return videos.some((video) =>
    videoPathFields.some((field) => video[field] && path.resolve(video[field]) === resolvedPath)
  );
}

router.get('/summary', async (req, res) => {
  try {
    const archiveMaterialFilter = buildArchiveMaterialBaseFilter();
    const unreviewedFilter = {
      ...archiveMaterialFilter,
      $and: [{
        $or: [
          { archiveReviewStatus: { $exists: false } },
          { archiveReviewStatus: 'unreviewed' },
          { archiveReviewStatus: null },
        ],
      }],
    };

    const [
      totalVideos,
      rawVideos,
      editedVideos,
      archiveReadyVideos,
      unreviewed,
      reviewed,
      needsMetadata,
      duplicateMarked,
      needsCorrection,
      duplicateCandidates,
    ] = await Promise.all([
      Video.countDocuments(archiveMaterialFilter),
      Video.countDocuments({ status: 'raw' }),
      Video.countDocuments(archiveMaterialFilter),
      Video.countDocuments({
        ...archiveMaterialFilter,
        $or: [
          { broadcastStatus: { $in: ['approved_for_air', 'aired', 'archived'] } },
          { finalApprovalStatus: 'approved' },
        ],
      }),
      Video.countDocuments(unreviewedFilter),
      Video.countDocuments({ ...archiveMaterialFilter, archiveReviewStatus: 'reviewed' }),
      Video.countDocuments({ ...archiveMaterialFilter, archiveReviewStatus: 'needs_metadata' }),
      Video.countDocuments({ ...archiveMaterialFilter, archiveReviewStatus: 'duplicate' }),
      Video.countDocuments({ ...archiveMaterialFilter, correctionStatus: 'needs_correction' }),
      Video.find(archiveMaterialFilter).select('filename originalFilename finalTitle duration sourceDuration sizeOriginal sizeCompressed sizePreview archivedAt uploadDate').lean(),
    ]);

    const duplicateGroups = buildDuplicateGroups(duplicateCandidates);

    res.json({
      totalVideos,
      rawVideos,
      editedVideos,
      archiveReadyVideos,
      unreviewed,
      reviewed,
      needsMetadata,
      duplicateMarked,
      needsCorrection,
      duplicateCandidateGroups: duplicateGroups.length,
      duplicateCandidateVideos: duplicateGroups.reduce((sum, group) => sum + group.count, 0),
    });
  } catch (error) {
    console.error('Error loading archive summary:', error);
    res.status(500).json({ message: 'Error loading archive summary.' });
  }
});

router.get('/videos', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '150', 10) || 150, 1), 500);
  const sortBy = String(req.query.sortBy || 'uploadDate');
  const sortOrder = String(req.query.sortOrder || 'desc');

  try {
    const videos = await populateArchiveVideo(
      Video.find(buildArchiveVideoFilter(req.query))
        .sort({ uploadDate: -1 })
        .limit(limit)
    );

    res.json(sortArchiveVideos(videos, sortBy, sortOrder));
  } catch (error) {
    console.error('Error loading archive videos:', error);
    res.status(500).json({ message: 'Error loading archive videos.' });
  }
});

router.get('/duplicates', async (req, res) => {
  const maxVideos = Math.min(Math.max(parseInt(req.query.maxVideos || '5000', 10) || 5000, 50), 10000);

  try {
    const videos = await populateArchiveVideo(
      Video.find(buildArchiveMaterialBaseFilter())
        .sort({ uploadDate: -1 })
        .limit(maxVideos)
    ).lean();

    const groups = buildDuplicateGroups(videos);
    res.json({ count: groups.length, groups });
  } catch (error) {
    console.error('Error loading duplicate candidates:', error);
    res.status(500).json({ message: 'Error loading duplicate candidates.' });
  }
});

router.get('/metadata-options', async (req, res) => {
  try {
    const [programs, contentTypes, reporters, editors, events] = await Promise.all([
      BroadcastProgram.find({ active: true }).select('_id name defaultTime daysOfWeek active').sort({ name: 1 }),
      BroadcastContentType.find({ active: true }).select('_id name slug description active').sort({ name: 1 }),
      User.find({ role: { $in: reporterRoles } }).select('_id username role').sort({ username: 1 }),
      User.find({ role: { $in: editorRoles } }).select('_id username role').sort({ username: 1 }),
      Video.distinct('event', { ...buildArchiveMaterialBaseFilter(), event: { $exists: true, $nin: [null, ''] } }),
    ]);

    res.json({
      programs,
      contentTypes,
      reporters,
      editors,
      events: events
        .map((event) => String(event || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    });
  } catch (error) {
    console.error('Error loading archive metadata options:', error);
    res.status(500).json({ message: 'Error loading archive metadata options.' });
  }
});

router.patch('/videos/:id/metadata', async (req, res) => {
  const body = req.body || {};

  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    const previousSnapshot = buildMetadataSnapshot(video);
    const nextContentTypeId = Object.prototype.hasOwnProperty.call(body, 'contentTypeId')
      ? normalizeOptionalObjectId(body.contentTypeId)
      : previousSnapshot.contentTypeId;
    const nextProgramId = Object.prototype.hasOwnProperty.call(body, 'programId')
      ? normalizeOptionalObjectId(body.programId)
      : previousSnapshot.programId;
    const nextReporterId = Object.prototype.hasOwnProperty.call(body, 'reporterId')
      ? normalizeOptionalObjectId(body.reporterId)
      : previousSnapshot.reporterId;
    const nextEditorId = Object.prototype.hasOwnProperty.call(body, 'editorId')
      ? normalizeOptionalObjectId(body.editorId)
      : previousSnapshot.editorId;

    const [program, contentType, reporter, editor] = await Promise.all([
      nextProgramId ? BroadcastProgram.findOne({ _id: nextProgramId, active: true }) : null,
      nextContentTypeId ? BroadcastContentType.findOne({ _id: nextContentTypeId, active: true }) : null,
      nextReporterId ? User.findOne({ _id: nextReporterId, role: { $in: reporterRoles } }).select('_id username role') : null,
      nextEditorId ? User.findOne({ _id: nextEditorId, role: { $in: editorRoles } }).select('_id username role') : null,
    ]);

    if (nextProgramId && !program) {
      return res.status(404).json({ message: 'Active program was not found.' });
    }

    if (nextContentTypeId && !contentType) {
      return res.status(404).json({ message: 'Active content type was not found.' });
    }

    if (nextReporterId && !reporter) {
      return res.status(404).json({ message: 'Reporter must be an existing Reporter, Producer or Admin user.' });
    }

    if (nextEditorId && !editor) {
      return res.status(404).json({ message: 'Editor must be an existing Editor, VideoEditor or Admin user.' });
    }

    if (Object.prototype.hasOwnProperty.call(body, 'finalTitle')) {
      video.finalTitle = String(body.finalTitle || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'event')) {
      video.event = String(body.event || '').trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tagDate')) {
      video.tagDate = normalizeOptionalDate(body.tagDate);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'programId')) {
      video.program = program ? program._id : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'contentTypeId')) {
      video.contentType = contentType ? contentType._id : null;
      video.finalCategory = contentType ? contentType.slug : '';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'reporterId')) {
      video.reporter = reporter ? reporter._id : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'editorId')) {
      video.editor = editor ? editor._id : null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'keywords')) {
      video.keywords = normalizeTagList(body.keywords);
      video.archiveTagsUpdatedBy = req.user.id;
      video.archiveTagsUpdatedAt = new Date();
    }

    if (Object.prototype.hasOwnProperty.call(body, 'archiveReviewNotes')) {
      video.archiveReviewNotes = String(body.archiveReviewNotes || '').trim();
    }

    const nextSnapshot = buildMetadataSnapshot(video);
    const changedFields = buildChangedFields(previousSnapshot, nextSnapshot);

    if (changedFields.length === 0) {
      const populatedVideo = await populateArchiveVideo(Video.findById(video._id));
      return res.json({ message: 'No metadata changes detected.', video: populatedVideo, changedFields: [] });
    }

    await video.save();

    await AuditLog.create({
      action: 'Archive Update Video Metadata',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        filename: video.filename,
        changedFields,
      },
    });

    const populatedVideo = await populateArchiveVideo(Video.findById(video._id));
    res.json({ message: 'Video metadata updated.', video: populatedVideo, changedFields });
  } catch (error) {
    console.error('Error updating archive metadata:', error);
    res.status(error.statusCode || 500).json({ message: error.message || 'Error updating archive metadata.' });
  }
});

router.patch('/videos/:id/tags', async (req, res) => {
  const { replace, add, remove } = req.body || {};

  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    const currentTags = normalizeTagList(video.keywords || []);
    let nextTags = currentTags;

    if (Array.isArray(replace) || typeof replace === 'string') {
      nextTags = normalizeTagList(replace);
    } else {
      const additions = normalizeTagList(add || []);
      const removals = new Set(normalizeTagList(remove || []).map((tag) => tag.toLocaleLowerCase()));
      nextTags = normalizeTagList([...currentTags, ...additions])
        .filter((tag) => !removals.has(tag.toLocaleLowerCase()));
    }

    video.keywords = nextTags;
    video.archiveTagsUpdatedBy = req.user.id;
    video.archiveTagsUpdatedAt = new Date();
    await video.save();

    await AuditLog.create({
      action: 'Archive Update Video Tags',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        filename: video.filename,
        previousTags: currentTags,
        nextTags,
      },
    });

    const populatedVideo = await populateArchiveVideo(Video.findById(video._id));
    res.json({ message: 'Video tags updated.', video: populatedVideo });
  } catch (error) {
    console.error('Error updating archive tags:', error);
    res.status(500).json({ message: 'Error updating archive tags.' });
  }
});

router.patch('/videos/:id/content-type', async (req, res) => {
  const { contentTypeId } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(contentTypeId || '')) {
    return res.status(400).json({ message: 'Valid contentTypeId is required.' });
  }

  try {
    const contentType = await BroadcastContentType.findById(contentTypeId);
    if (!contentType || !contentType.active) {
      return res.status(404).json({ message: 'Active content type not found.' });
    }

    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    const previousContentTypeId = video.contentType || null;
    const previousFinalCategory = video.finalCategory || null;
    const previousTags = normalizeTagList(video.keywords || []);

    video.contentType = contentType._id;
    video.finalCategory = contentType.slug;
    video.keywords = normalizeTagList([...previousTags, contentType.name, contentType.slug]);
    video.archiveTagsUpdatedBy = req.user.id;
    video.archiveTagsUpdatedAt = new Date();
    await video.save();

    await AuditLog.create({
      action: 'Archive Update Video Content Type',
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

    const populatedVideo = await populateArchiveVideo(Video.findById(video._id));
    res.json({ message: 'Video content type updated.', video: populatedVideo });
  } catch (error) {
    console.error('Error updating archive content type:', error);
    res.status(500).json({ message: 'Error updating archive content type.' });
  }
});

router.patch('/videos/:id/review', async (req, res) => {
  const { status, notes = '', duplicateOf = null } = req.body || {};

  if (!archiveReviewStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid archive review status.' });
  }

  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Video not found.' });

    if (duplicateOf) {
      if (!mongoose.Types.ObjectId.isValid(duplicateOf)) {
        return res.status(400).json({ message: 'Invalid duplicateOf video id.' });
      }

      const keeper = await Video.findById(duplicateOf).select('_id');
      if (!keeper) return res.status(404).json({ message: 'Duplicate keeper video not found.' });
      if (keeper._id.toString() === video._id.toString()) {
        return res.status(400).json({ message: 'A video cannot be duplicate of itself.' });
      }
      video.duplicateOf = keeper._id;
    } else if (status !== 'duplicate') {
      video.duplicateOf = null;
    }

    const previousStatus = video.archiveReviewStatus || 'unreviewed';
    video.archiveReviewStatus = status;
    video.archiveReviewNotes = notes;

    if (status === 'unreviewed') {
      video.archiveReviewedBy = null;
      video.archiveReviewedAt = null;
    } else {
      video.archiveReviewedBy = req.user.id;
      video.archiveReviewedAt = new Date();
    }
    await video.save();

    await AuditLog.create({
      action: 'Archive Review Video',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        filename: video.filename,
        previousStatus,
        status,
        duplicateOf: video.duplicateOf || null,
        notes,
      },
    });

    const populatedVideo = await populateArchiveVideo(Video.findById(video._id));
    res.json({ message: 'Archive review saved.', video: populatedVideo });
  } catch (error) {
    console.error('Error saving archive review:', error);
    res.status(500).json({ message: 'Error saving archive review.' });
  }
});

router.delete('/videos/:id/duplicate', async (req, res) => {
  const { duplicateOf, reason = '' } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(duplicateOf || '')) {
    return res.status(400).json({ message: 'duplicateOf keeper video id is required.' });
  }

  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Duplicate video not found.' });

    const keeper = await Video.findById(duplicateOf);
    if (!keeper) return res.status(404).json({ message: 'Keeper video not found.' });

    if (video._id.toString() === keeper._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete the keeper video as its own duplicate.' });
    }

    const pathsToDelete = Array.from(new Set(
      videoPathFields
        .map((field) => video[field])
        .filter(Boolean)
    ));
    const deletedPaths = [];
    const skippedPaths = [];

    for (const filePath of pathsToDelete) {
      const resolvedPath = path.resolve(filePath);

      if (!isDeletableVideoPath(resolvedPath)) {
        skippedPaths.push({ path: resolvedPath, reason: 'outside allowed video storage' });
        continue;
      }

      const shared = await isPathReferencedByAnotherVideo(video._id, resolvedPath);
      if (shared) {
        skippedPaths.push({ path: resolvedPath, reason: 'referenced by another video record' });
        continue;
      }

      if (!fs.existsSync(resolvedPath)) {
        skippedPaths.push({ path: resolvedPath, reason: 'file not found' });
        continue;
      }

      fs.unlinkSync(resolvedPath);
      deletedPaths.push(resolvedPath);
    }

    await AuditLog.create({
      action: 'Archive Delete Duplicate Video',
      performedBy: req.user.id,
      details: {
        deletedVideoId: video._id,
        keeperVideoId: keeper._id,
        filename: video.filename,
        keeperFilename: keeper.filename,
        reason,
        deletedPaths,
        skippedPaths,
      },
    });

    await Video.findByIdAndDelete(video._id);

    res.json({
      message: 'Duplicate video removed.',
      deletedVideoId: video._id,
      keeperVideoId: keeper._id,
      deletedPaths,
      skippedPaths,
    });
  } catch (error) {
    console.error('Error deleting duplicate video:', error);
    res.status(500).json({ message: 'Error deleting duplicate video.' });
  }
});

module.exports = router;
