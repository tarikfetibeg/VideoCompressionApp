const express = require('express');
const authenticateToken = require('../../middleware/authenticateToken');
const EditJob = require('../../models/EditJob');
const CorrectionRequest = require('../../models/CorrectionRequest');
const ShowDay = require('../../models/ShowDay');
const Video = require('../../models/Video');
const Notification = require('../../models/Notification');
const TransferSession = require('../../models/TransferSession');
const Device = require('../../models/Device');
const MediaNode = require('../../models/MediaNode');

const router = express.Router();
router.use(authenticateToken);

const ACTIVE_CORRECTION_STATES = ['reported', 'assigned', 'in_edit', 'ready_for_review'];
const ACTIVE_TRANSFER_STATES = ['queued', 'preparing', 'transferring', 'paused', 'verifying'];

function jobFilterFor(user) {
  const base = { workspaceState: 'active' };
  if (user.role === 'Reporter') return { ...base, reporter: user.id };
  if (['Editor', 'VideoEditor'].includes(user.role)) return { ...base, assignedEditor: user.id };
  if (user.role === 'Producer') {
    return { ...base, status: { $in: ['ready_for_qc', 'approved', 'needs_info'] } };
  }
  if (user.role === 'Admin') return base;
  return { _id: null };
}

function correctionFilterFor(user) {
  const base = { status: { $in: ACTIVE_CORRECTION_STATES } };
  if (['Editor', 'VideoEditor'].includes(user.role)) return { ...base, assignedEditor: user.id };
  if (['Producer', 'Admin'].includes(user.role)) return base;
  if (user.role === 'Realizator') return { ...base, reportedBy: user.id };
  return { _id: null };
}

function serializeShowDay(showDay, userId) {
  const downloadState = (showDay.downloadStates || []).find((item) => String(item.user) === userId);
  const lastActivityAt = (showDay.activityLog || []).reduce((latest, item) => {
    const value = new Date(item.createdAt || 0).getTime();
    return value > latest ? value : latest;
  }, 0);
  const lastDownloadedAt = downloadState?.lastDownloadedAt
    ? new Date(downloadState.lastDownloadedAt).getTime()
    : 0;

  return {
    _id: showDay._id,
    program: showDay.program,
    airDate: showDay.airDate,
    airedAt: showDay.airedAt,
    itemCount: showDay.items?.filter((item) => item.status !== 'removed').length || 0,
    lastDownloadedAt: downloadState?.lastDownloadedAt || null,
    changedSinceDownload: Boolean(lastDownloadedAt && lastActivityAt > lastDownloadedAt),
    hasNeverDownloaded: !lastDownloadedAt,
    updatedAt: showDay.updatedAt,
  };
}

router.get('/', async (req, res) => {
  try {
    const now = new Date();
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const showDayFilter = ['Producer', 'Realizator', 'Admin'].includes(req.user.role)
      ? { airDate: { $gte: new Date(now.getTime() - 12 * 60 * 60 * 1000), $lte: future } }
      : { _id: null };

    const [jobs, corrections, showDays, notifications, transfers, archiveItems] = await Promise.all([
      EditJob.find(jobFilterFor(req.user))
        .select('title status priority deadline expiresAt jobKind reporter assignedEditor segments updatedAt')
        .populate('reporter assignedEditor', 'username role')
        .sort({ priority: -1, deadline: 1, updatedAt: -1 })
        .limit(12)
        .lean(),
      CorrectionRequest.find(correctionFilterFor(req.user))
        .select('video showDay note timestamp status assignedEditor correctionJob updatedAt')
        .populate('video', 'filename originalFilename event correctionStatus')
        .populate('assignedEditor', 'username role')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      ShowDay.find(showDayFilter)
        .select('program airDate airedAt items activityLog downloadStates updatedAt')
        .populate('program', 'name title')
        .sort({ airDate: 1 })
        .limit(8)
        .lean(),
      Notification.find({ recipient: req.user.id, state: 'unread' })
        .select('kind severity entityType entityId title bodyPreview deepLink actionRequired ackDeadlineAt createdAt')
        .sort({ severity: -1, createdAt: -1 })
        .limit(10)
        .lean(),
      TransferSession.find({ user: req.user.id, status: { $in: ACTIVE_TRANSFER_STATES } })
        .select('transferId direction kind entityType entityId status filename totalBytes transferredBytes updatedAt')
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean(),
      req.user.role === 'Archivist'
        ? Video.find({
          status: 'edited',
          processingStatus: 'completed',
          archiveReviewStatus: { $in: ['unreviewed', 'needs_metadata', 'duplicate'] },
        })
          .select('filename originalFilename event location archiveReviewStatus correctionStatus uploadDate')
          .sort({ uploadDate: 1 })
          .limit(12)
          .lean()
        : Promise.resolve([]),
    ]);

    const [unreadCount, criticalCount, activeTransferCount, archivePendingCount] = await Promise.all([
      Notification.countDocuments({ recipient: req.user.id, state: 'unread' }),
      Notification.countDocuments({
        recipient: req.user.id,
        severity: 'critical',
        state: { $nin: ['acknowledged', 'resolved'] },
      }),
      TransferSession.countDocuments({ user: req.user.id, status: { $in: ACTIVE_TRANSFER_STATES } }),
      req.user.role === 'Archivist'
        ? Video.countDocuments({
          status: 'edited',
          processingStatus: 'completed',
          archiveReviewStatus: { $in: ['unreviewed', 'needs_metadata', 'duplicate'] },
        })
        : Promise.resolve(0),
    ]);

    let platform = null;
    if (req.user.role === 'Admin') {
      const onlineThreshold = new Date(Date.now() - 90 * 1000);
      const [devicesTotal, devicesOnline, nodes] = await Promise.all([
        Device.countDocuments({ revokedAt: null }),
        Device.countDocuments({ revokedAt: null, lastSeenAt: { $gte: onlineThreshold } }),
        MediaNode.find().select('nodeId name site kind status capabilities storage lastSeenAt baseUrl').lean(),
      ]);
      platform = { devicesTotal, devicesOnline, nodes };
    }

    return res.json({
      generatedAt: new Date(),
      role: req.user.role,
      summary: {
        activeJobs: jobs.length,
        corrections: corrections.length,
        unread: unreadCount,
        critical: criticalCount,
        activeTransfers: activeTransferCount,
        archivePending: archivePendingCount,
      },
      jobs,
      corrections,
      showDays: showDays.map((item) => serializeShowDay(item, req.user.id)),
      notifications,
      transfers,
      archiveItems,
      platform,
    });
  } catch (error) {
    console.error('My Work load failed:', error);
    return res.status(500).json({ message: 'Radni pregled se trenutno ne može učitati.' });
  }
});

module.exports = router;
