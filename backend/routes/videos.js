const express = require('express');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const path = require('path');
const fs = require('fs');
const { enqueueVideoProcessing } = require('../queues/videoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');
const { addVideoPrefixSearchFilter } = require('../utils/searchText');
const { addContentTypeFallbackFilter } = require('../utils/contentTypeFilters');
const { applyApprovedArchiveEligibility } = require('../utils/archiveEligibility');
const { setDownloadHeaders } = require('../utils/downloadHeaders');
const { streamSingleVideo, streamBulkVideos } = require('../services/downloadService');
const { removeHlsPreviewFolder } = require('../services/hlsPreviewService');
const { sendFileWithRange } = require('../utils/mediaStreaming');
const {
  getScrubPreviewFolderForVideo,
  hasUsableScrubPreview,
  removeScrubPreviewFolderForVideo,
  resolveScrubPreviewFramePath,
} = require('../services/videoProcessingService');

const router = express.Router();

const allowedVideoRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Archivist', 'Admin'];
const allowedMediaPreviewRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const allowedQcRoles = ['Editor', 'VideoEditor', 'Producer', 'Admin'];
const allowedApprovalRoles = ['Producer', 'Admin'];
const allowedQcStatuses = ['pending', 'passed', 'failed'];
const allowedBroadcastStatusUpdates = ['approved_for_air', 'aired', 'archived'];
const allowedTimecodeRoles = ['Editor', 'VideoEditor', 'Producer', 'Reporter', 'Admin'];
const allowedArchiveReviewRequestRoles = ['Editor', 'VideoEditor', 'Admin'];
const allowedTimecodeTypes = ['marker', 'cut', 'in', 'out', 'note'];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function buildSort(query = {}) {
  const sortBy = String(query.sortBy || 'uploadDate');
  const sortOrder = String(query.sortOrder || 'desc') === 'asc' ? 1 : -1;
  const sortFields = {
    uploadDate: 'uploadDate',
    tagDate: 'tagDate',
    name: 'originalFilename',
    event: 'event',
    processing: 'processingStatus',
    qc: 'qcStatus',
    broadcast: 'broadcastStatus',
  };
  const field = sortFields[sortBy] || 'uploadDate';
  return { [field]: sortOrder, uploadDate: -1, createdAt: -1 };
}

function applyArchiveFilter(filter) {
  applyApprovedArchiveEligibility(filter);
}

async function buildVideoWorkspaceFilter(query = {}, user) {
  const {
    event,
    location,
    date,
    scope,
    library,
    contentTypeId,
    status,
    processingStatus,
    qcStatus,
    broadcastStatus,
    uploader,
    q,
  } = query;
  const filter = {};

  if (event && event !== 'all') {
    filter.event = new RegExp(escapeRegex(event), 'i');
  }

  if (location && location !== 'all') {
    filter.location = new RegExp(escapeRegex(location), 'i');
  }

  if (library === 'archive') {
    applyArchiveFilter(filter);
  }

  await addContentTypeFallbackFilter(filter, contentTypeId);

  if (status && status !== 'all') {
    filter.status = status;
  }

  if (processingStatus && processingStatus !== 'all') {
    filter.processingStatus = processingStatus;
  }

  if (qcStatus && qcStatus !== 'all') {
    filter.qcStatus = qcStatus;
  }

  if (broadcastStatus && broadcastStatus !== 'all') {
    filter.broadcastStatus = broadcastStatus;
  }

  if (uploader && uploader !== 'all') {
    filter.uploader = uploader;
  }

  if (date) {
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    if (!Number.isNaN(startOfDay.getTime())) {
      filter.tagDate = {
        $gte: startOfDay,
        $lt: endOfDay,
      };
    }
  }

  const search = String(q || '').trim();
  addVideoPrefixSearchFilter(filter, search);

  if (user?.role === 'Reporter' && scope !== 'station') {
    filter.uploader = user.id;
  }

  return filter;
}

function populateVideoList(query) {
  return query
    .populate('uploader', 'username role')
    .populate('reporter', 'username role')
    .populate('editor', 'username role')
    .populate('qaResponsible', 'username role')
    .populate('correctionReportedBy', 'username role')
    .populate('archiveReviewedBy', 'username role')
    .populate('archiveTagsUpdatedBy', 'username role')
    .populate('program')
    .populate('contentType');
}

async function buildVideoSummary(filter) {
  const [
    total,
    raw,
    edited,
    queued,
    processing,
    completed,
    failed,
    qcPending,
    qcPassed,
    qcFailed,
    approved,
    aired,
    archived,
    needsCorrection,
  ] = await Promise.all([
    Video.countDocuments(filter),
    Video.countDocuments({ ...filter, status: 'raw' }),
    Video.countDocuments({ ...filter, status: 'edited' }),
    Video.countDocuments({ ...filter, processingStatus: 'queued' }),
    Video.countDocuments({ ...filter, processingStatus: 'processing' }),
    Video.countDocuments({ ...filter, processingStatus: 'completed' }),
    Video.countDocuments({ ...filter, processingStatus: 'failed' }),
    Video.countDocuments({ ...filter, qcStatus: 'pending' }),
    Video.countDocuments({ ...filter, qcStatus: 'passed' }),
    Video.countDocuments({ ...filter, qcStatus: 'failed' }),
    Video.countDocuments({ ...filter, broadcastStatus: 'approved_for_air' }),
    Video.countDocuments({ ...filter, broadcastStatus: 'aired' }),
    Video.countDocuments({ ...filter, broadcastStatus: 'archived' }),
    Video.countDocuments({ ...filter, correctionStatus: 'needs_correction' }),
  ]);

  return {
    total,
    raw,
    edited,
    queued,
    processing,
    completed,
    failed,
    qcPending,
    qcPassed,
    qcFailed,
    approved,
    aired,
    archived,
    needsCorrection,
  };
}

function getUploaderId(video) {
  if (!video || !video.uploader) return null;

  if (video.uploader._id) {
    return video.uploader._id.toString();
  }

  return video.uploader.toString();
}

function userCanReadVideo(user, video, allowedRoles = allowedVideoRoles) {
  if (!user || !video) return false;
  return allowedRoles.includes(user.role);
}

function userCanManageVideo(user, video) {
  if (!user || !video) return false;
  if (user.role === 'Admin') return true;

  if (user.role === 'Reporter') {
    return getUploaderId(video) === user.id;
  }

  return ['Editor', 'VideoEditor', 'Producer'].includes(user.role);
}

function userCanDownloadVideo(user, video) {
  if (!user || !video) return false;
  if (user.role === 'Admin') return true;

  if (user.role === 'Reporter') {
    return getUploaderId(video) === user.id;
  }

  return ['Editor', 'VideoEditor', 'Producer', 'Archivist'].includes(user.role);
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

function deleteFileIfExists(filePath) {
  if (!filePath) return;

  const resolvedPath = path.resolve(filePath);
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
  }
}

router.get(
  '/workspace',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    try {
      const { page, limit, skip } = parsePagination(req.query);
      const filter = await buildVideoWorkspaceFilter(req.query, req.user);
      const sort = buildSort(req.query);

      const [total, items, summary] = await Promise.all([
        Video.countDocuments(filter),
        populateVideoList(
          Video.find(filter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
        ),
        buildVideoSummary(filter),
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
      console.error('Error retrieving video workspace:', error);
      res.status(500).json({ message: 'Error retrieving video workspace' });
    }
  }
);

router.get(
  '/',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    const { event, date, scope, library, contentTypeId } = req.query;
    const filter = {};

    if (event) {
      filter.event = event;
    }

    if (library === 'archive') {
      applyArchiveFilter(filter);
    }

    await addContentTypeFallbackFilter(filter, contentTypeId);

    if (date) {
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(startOfDay);
      endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

      if (!Number.isNaN(startOfDay.getTime())) {
        filter.tagDate = {
          $gte: startOfDay,
          $lt: endOfDay,
        };
      }
    }

    if (req.user.role === 'Reporter' && scope !== 'station') {
      filter.uploader = req.user.id;
    }

    try {
      const videos = await populateVideoList(Video.find(filter));
      res.json(videos);
    } catch (err) {
      console.error('Error retrieving videos:', err);
      res.status(500).json({ message: 'Error retrieving videos' });
    }
  }
);

router.delete('/:videoId', authenticateToken, async (req, res) => {
  try {
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (req.user.role !== 'Admin' && getUploaderId(video) !== req.user.id) {
      return res.status(403).json({ message: 'Access Forbidden: You can only delete your own videos.' });
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

    await Video.findByIdAndDelete(req.params.videoId);

    await AuditLog.create({
      action: 'Delete Video',
      performedBy: req.user.id,
      details: { videoId: req.params.videoId, filename: video.filename },
    });

    res.json({ message: 'Video deleted successfully' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ message: 'Error deleting video' });
  }
});

router.post(
  '/:videoId/requeue-processing',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      if (['queued', 'processing'].includes(video.processingStatus)) {
        return res.status(409).json({ message: 'Video processing is already queued or running.' });
      }

      const inputPath = resolveExistingPath(video.rawPath, video.filepath);
      if (!inputPath) {
        return res.status(400).json({
          message: 'Cannot retry processing because the source file is missing from local storage.',
        });
      }

      try {
        const job = await enqueueVideoProcessing(video._id);

        const updatedVideo = await Video.findById(video._id).populate('uploader', 'username');

        await AuditLog.create({
          action: 'Retry Video Processing',
          performedBy: req.user.id,
          details: {
            videoId: video._id,
            filename: video.filename,
            processingJobId: job.id.toString(),
          },
        });

        return res.status(202).json({
          message: 'Video processing has been queued again.',
          video: updatedVideo,
        });
      } catch (queueError) {
        const queueMessage = getQueueErrorMessage(queueError);

        video.processingStatus = 'failed';
        video.processingError = queueMessage;
        video.processingCompletedAt = new Date();
        await video.save();

        return res.status(503).json({ message: queueMessage });
      }
    } catch (error) {
      console.error('Failed to retry video processing:', error);
      return res.status(500).json({ message: 'Failed to retry video processing.' });
    }
  }
);

router.get('/preview/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedMediaPreviewRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanReadVideo(user, video, allowedMediaPreviewRoles)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const previewPath = resolveExistingPath(video.previewPath, video.compressedPath, video.filepath);

    if (!previewPath) {
      return res.status(404).json({ message: 'Preview file not found on server' });
    }

    return sendFileWithRange(req, res, previewPath, 'video/mp4');
  } catch (error) {
    console.error('Error streaming preview:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/thumbnail/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedMediaPreviewRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanReadVideo(user, video, allowedMediaPreviewRoles)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const thumbnailPath = resolveExistingPath(video.thumbnailPath);

    if (!thumbnailPath) {
      return res.status(404).json({ message: 'Thumbnail file not found on server' });
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
    });

    fs.createReadStream(thumbnailPath).pipe(res);
  } catch (error) {
    console.error('Error serving thumbnail:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/scrub-preview/:videoId/manifest', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedMediaPreviewRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId).select('scrubPreview uploader');
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanReadVideo(user, video, allowedMediaPreviewRoles)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const available = hasUsableScrubPreview(video);
    const metadata = video.scrubPreview || {};

    res.json({
      available,
      frameCount: available ? Number(metadata.frameCount) || 0 : 0,
      frameWidth: Number(metadata.frameWidth) || 320,
      frameHeight: Number(metadata.frameHeight) || 180,
      duration: Number(metadata.duration) || null,
      version: metadata.version || null,
      createdAt: metadata.createdAt || null,
      error: available ? '' : metadata.error || '',
    });
  } catch (error) {
    console.error('Error serving scrub preview manifest:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/scrub-preview/:videoId/frame/:frameIndex', authenticateToken, async (req, res) => {
  const { videoId, frameIndex } = req.params;
  const user = req.user;

  if (!allowedMediaPreviewRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId).select('scrubPreview uploader');
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanReadVideo(user, video, allowedMediaPreviewRoles)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const framePath = resolveScrubPreviewFramePath(video, Number(frameIndex));

    if (!framePath) {
      return res.status(404).json({ message: 'Scrub preview frame not found on server' });
    }

    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, max-age=3600',
      'X-Scrub-Preview-Folder': path.basename(getScrubPreviewFolderForVideo(video)),
    });

    fs.createReadStream(framePath).pipe(res);
  } catch (error) {
    console.error('Error serving scrub preview frame:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/stream/:videoId', authenticateToken, async (req, res) => {
  const { videoId } = req.params;
  const user = req.user;

  if (!allowedMediaPreviewRoles.includes(user.role)) {
    return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
  }

  try {
    const video = await Video.findById(videoId);
    if (!video) return res.status(404).json({ message: 'Video not found' });

    if (!userCanReadVideo(user, video, allowedMediaPreviewRoles)) {
      return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
    }

    const videoPath = resolveExistingPath(video.compressedPath, video.filepath);

    if (!videoPath) {
      return res.status(404).json({ message: 'Video file not found on server' });
    }

    return sendFileWithRange(req, res, videoPath, 'video/mp4');
  } catch (error) {
    console.error('Error streaming video:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.post(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(allowedTimecodeRoles),
  async (req, res) => {
    const { videoId } = req.params;
    const { description, timestamp, type = 'marker' } = req.body;
    const parsedTimestamp = Number(timestamp);

    if (!Number.isFinite(parsedTimestamp) || parsedTimestamp < 0) {
      return res.status(400).json({ message: 'A valid timestamp is required.' });
    }

    if (!allowedTimecodeTypes.includes(type)) {
      return res.status(400).json({ message: 'Invalid marker type.' });
    }

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      video.timecodes.push({
        description,
        timestamp: parsedTimestamp,
        type,
        createdBy: req.user.id,
        createdAt: new Date(),
      });
      await video.save();

      res.status(200).json({
        message: 'Marker added successfully',
        timecodes: video.timecodes,
      });
    } catch (error) {
      console.error('Failed to add timecode:', error);
      res.status(500).json({ error: 'Failed to add timecode' });
    }
  }
);

router.delete(
  '/:videoId/timecodes/:timecodeId',
  authenticateToken,
  authorize(allowedTimecodeRoles),
  async (req, res) => {
    const { videoId, timecodeId } = req.params;

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      const timecode = video.timecodes.id(timecodeId);
      if (!timecode) {
        return res.status(404).json({ message: 'Marker not found' });
      }

      timecode.deleteOne();
      await video.save();

      res.json({
        message: 'Marker deleted successfully',
        timecodes: video.timecodes,
      });
    } catch (error) {
      console.error('Failed to delete timecode:', error);
      res.status(500).json({ message: 'Failed to delete marker' });
    }
  }
);

router.patch(
  '/:videoId/archive-review-request',
  authenticateToken,
  authorize(allowedArchiveReviewRequestRoles),
  async (req, res) => {
    const { videoId } = req.params;
    const requestNote = String(req.body?.notes || '').trim() ||
      'Montaza je oznacila da kategorija materijala treba arhivsku provjeru.';

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      if (video.status !== 'edited' || video.processingStatus !== 'completed') {
        return res.status(400).json({
          message: 'Samo zavrsen/finalizovan materijal moze ici arhivi na provjeru kategorije.',
        });
      }

      const previousStatus = video.archiveReviewStatus || 'unreviewed';
      const previousNotes = String(video.archiveReviewNotes || '').trim();
      const nextNote = `Kategorija za provjeru: ${requestNote}`;

      video.archiveReviewStatus = 'needs_metadata';
      video.archiveReviewNotes = previousNotes ? `${previousNotes}\n${nextNote}` : nextNote;
      video.archiveReviewedBy = null;
      video.archiveReviewedAt = null;

      await video.save();

      await AuditLog.create({
        action: 'Request Archive Category Review',
        performedBy: req.user.id,
        details: {
          videoId: video._id,
          filename: video.filename,
          previousStatus,
          status: video.archiveReviewStatus,
          notes: requestNote,
        },
      });

      const populatedVideo = await populateVideoList(Video.findById(video._id));
      res.json({
        message: 'Materijal je poslan arhivi na provjeru kategorije.',
        video: populatedVideo,
      });
    } catch (error) {
      console.error('Failed to request archive category review:', error);
      res.status(500).json({ message: 'Provjera kategorije se ne moze poslati arhivi.' });
    }
  }
);

router.patch(
  '/:videoId/qc',
  authenticateToken,
  authorize(allowedQcRoles),
  async (req, res) => {
    const { videoId } = req.params;
    const { qcStatus, qcNotes } = req.body;

    if (!allowedQcStatuses.includes(qcStatus)) {
      return res.status(400).json({ message: 'Invalid QC status.' });
    }

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      if (qcStatus === 'passed' && video.processingStatus !== 'completed') {
        return res.status(400).json({ message: 'Video must finish processing before QC can pass.' });
      }

      video.qcStatus = qcStatus;
      video.qcNotes = qcNotes || '';
      video.qcCheckedBy = req.user.id;
      video.qcCheckedAt = new Date();

      if (qcStatus === 'passed') {
        video.broadcastStatus = 'ready_for_approval';
      } else if (qcStatus === 'failed') {
        video.broadcastStatus = 'qc_failed';
        video.approvedBy = null;
        video.approvedAt = null;
      } else {
        video.broadcastStatus = video.processingStatus === 'completed' ? 'qc_pending' : 'not_ready';
        video.approvedBy = null;
        video.approvedAt = null;
      }

      await video.save();

      await AuditLog.create({
        action: 'Update Video QC',
        performedBy: req.user.id,
        details: {
          videoId: video._id,
          filename: video.filename,
          qcStatus,
          qcNotes: video.qcNotes,
          broadcastStatus: video.broadcastStatus,
        },
      });

      res.json({ message: 'QC status updated successfully', video });
    } catch (error) {
      console.error('Failed to update QC status:', error);
      res.status(500).json({ message: 'Failed to update QC status' });
    }
  }
);

router.patch(
  '/:videoId/broadcast-status',
  authenticateToken,
  authorize(allowedApprovalRoles),
  async (req, res) => {
    const { videoId } = req.params;
    const { broadcastStatus } = req.body;

    if (!allowedBroadcastStatusUpdates.includes(broadcastStatus)) {
      return res.status(400).json({ message: 'Invalid broadcast status.' });
    }

    try {
      const video = await Video.findById(videoId);
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanManageVideo(req.user, video)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      if (broadcastStatus === 'approved_for_air') {
        if (video.processingStatus !== 'completed' || video.qcStatus !== 'passed') {
          return res.status(400).json({
            message: 'Video must be processed and QC-passed before approval for air.',
          });
        }

        video.broadcastStatus = 'approved_for_air';
        video.approvedBy = req.user.id;
        video.approvedAt = new Date();
      }

      if (broadcastStatus === 'aired') {
        if (video.broadcastStatus !== 'approved_for_air' && video.broadcastStatus !== 'aired') {
          return res.status(400).json({ message: 'Video must be approved before it can be marked as aired.' });
        }

        video.broadcastStatus = 'aired';
        video.airedAt = video.airedAt || new Date();
      }

      if (broadcastStatus === 'archived') {
        video.broadcastStatus = 'archived';
        video.archivedAt = video.archivedAt || new Date();
      }

      await video.save();

      await AuditLog.create({
        action: 'Update Broadcast Status',
        performedBy: req.user.id,
        details: {
          videoId: video._id,
          filename: video.filename,
          broadcastStatus: video.broadcastStatus,
        },
      });

      res.json({ message: 'Broadcast status updated successfully', video });
    } catch (error) {
      console.error('Failed to update broadcast status:', error);
      res.status(500).json({ message: 'Failed to update broadcast status' });
    }
  }
);

router.get(
  '/download/:videoId',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    try {
      await streamSingleVideo({
        user: req.user,
        payload: { videoId: req.params.videoId },
        res,
      });
    } catch (err) {
      console.error('Error downloading video:', err);
      if (!res.headersSent) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Error downloading video' });
      }
    }
  }
);

router.get(
  '/:videoId/timecodes',
  authenticateToken,
  authorize(allowedMediaPreviewRoles),
  async (req, res) => {
    const { videoId } = req.params;

    try {
      const video = await Video.findById(videoId).select('timecodes uploader');
      if (!video) return res.status(404).json({ message: 'Video not found' });

      if (!userCanReadVideo(req.user, video, allowedMediaPreviewRoles)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      res.status(200).json(video.timecodes);
    } catch (error) {
      console.error('Failed to retrieve timecodes:', error);
      res.status(500).json({ error: 'Failed to retrieve timecodes' });
    }
  }
);

router.post(
  '/download',
  authenticateToken,
  authorize(allowedVideoRoles),
  async (req, res) => {
    try {
      await streamBulkVideos({
        user: req.user,
        payload: { videoIds: req.body.videoIds },
        res,
      });
    } catch (err) {
      console.error('Error downloading videos:', err);
      if (!res.headersSent) {
        res.status(err.statusCode || 500).json({ message: err.message || 'Error creating ZIP archive' });
      }
    }
  }
);

router.get(
  '/details/:videoId',
  authenticateToken,
  authorize(allowedMediaPreviewRoles),
  async (req, res) => {
    try {
      const video = await Video.findById(req.params.videoId)
        .populate('uploader', 'username role')
        .populate('reporter', 'username role')
        .populate('editor', 'username role')
        .populate('qaResponsible', 'username role')
        .populate('correctionReportedBy', 'username role')
        .populate('program')
        .populate('contentType')
        .populate('finalApprovedBy', 'username role')
        .populate('archiveReviewedBy', 'username role')
        .populate('archiveTagsUpdatedBy', 'username role')
        .populate('duplicateOf', 'filename originalFilename finalTitle');
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }

      if (!userCanReadVideo(req.user, video, allowedMediaPreviewRoles)) {
        return res.status(403).json({ message: 'Forbidden: You do not have access to this video.' });
      }

      res.json(video);
    } catch (err) {
      console.error('Error fetching video details:', err);
      res.status(500).json({ message: 'Error retrieving video details' });
    }
  }
);

module.exports = router;
