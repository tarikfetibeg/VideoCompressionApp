const express = require('express');
const CorrectionRequest = require('../models/CorrectionRequest');
const EditJob = require('../models/EditJob');
const ShowDay = require('../models/ShowDay');
const User = require('../models/User');
const Video = require('../models/Video');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const {
  ensureCorrectionJob,
  ensureVideoCorrectionRequest,
  findOpenRequestForVideo,
  syncTaggedCorrectionRequests,
} = require('../services/correctionWorkflowService');

const router = express.Router();
const allowedRoles = ['Producer', 'Editor', 'VideoEditor', 'Realizator', 'Archivist', 'Admin'];
const allowedStatuses = ['reported', 'assigned', 'in_edit', 'ready_for_review', 'resolved', 'dismissed'];

router.use(authenticateToken);
router.use(authorize(allowedRoles));

function populateRequest(query) {
  return query
    .populate('video', 'filename originalFilename finalTitle correctionStatus contentType sourceJob editor reporter uploader')
    .populate('showDay', 'program airDate producers')
    .populate('sourceJob', 'title status workspaceState assignedEditor reporter contentType deadline')
    .populate('correctionJob', 'title status workspaceState assignedEditor deadline priority')
    .populate('reportedBy', 'username role')
    .populate('assignedEditor', 'username role')
    .populate('resolvedBy', 'username role')
    .populate('correctedBy', 'username role')
    .populate('correctedVideo', 'filename originalFilename finalTitle processingStatus finalApprovalStatus');
}

router.get('/editors', authorize(['Producer', 'Admin']), async (req, res) => {
  try {
    const editors = await User.find({
      role: { $in: ['Editor', 'VideoEditor'] },
    })
      .select('_id username role')
      .sort({ username: 1 });
    res.json(editors);
  } catch (error) {
    res.status(500).json({ message: 'Montažere nije moguće učitati.' });
  }
});

router.get('/workspace', async (req, res) => {
  try {
    if (req.user.role !== 'Realizator') {
      await syncTaggedCorrectionRequests({ limit: 100 });
    }
    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100);
    const scopeFilter = {};
    if (req.user.role === 'Realizator') scopeFilter.reportedBy = req.user.id;
    if (['Editor', 'VideoEditor'].includes(req.user.role)) {
      if (req.query.scope === 'mine') scopeFilter.assignedEditor = req.user.id;
      if (req.query.scope === 'unassigned') scopeFilter.assignedEditor = null;
    }
    const filter = { ...scopeFilter };
    if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
    else if (req.query.includeClosed !== 'true') {
      filter.status = { $in: ['reported', 'assigned', 'in_edit', 'ready_for_review'] };
    }
    const openStatuses = ['reported', 'assigned', 'in_edit', 'ready_for_review'];
    const producerCanTrackUnread = ['Producer', 'Admin'].includes(req.user.role);

    const [total, items, open, unassigned, ready, unread] = await Promise.all([
      CorrectionRequest.countDocuments(filter),
      populateRequest(
        CorrectionRequest.find(filter)
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
      ),
      CorrectionRequest.countDocuments({
        ...scopeFilter,
        status: { $in: openStatuses },
      }),
      producerCanTrackUnread
        ? CorrectionRequest.countDocuments({ ...scopeFilter, status: 'reported', assignedEditor: null })
        : Promise.resolve(0),
      CorrectionRequest.countDocuments({ ...scopeFilter, status: 'ready_for_review' }),
      producerCanTrackUnread
        ? CorrectionRequest.countDocuments({
          ...scopeFilter,
          status: { $in: openStatuses },
          seenBy: { $ne: req.user.id },
        })
        : Promise.resolve(0),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary: { open, unassigned, ready, unread },
    });
    if (producerCanTrackUnread && items.length > 0) {
      CorrectionRequest.updateMany(
        { _id: { $in: items.map((item) => item._id) } },
        { $addToSet: { seenBy: req.user.id } },
        { timestamps: false }
      ).catch((error) => console.warn('Correction seen state update failed:', error.message));
    }
  } catch (error) {
    console.error('Error loading correction workspace:', error);
    res.status(500).json({ message: 'Correction queue nije moguće učitati.' });
  }
});

router.post('/video/:videoId/ensure', authorize(['Archivist', 'Producer', 'Admin']), async (req, res) => {
  try {
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ message: 'Video nije pronađen.' });

    const note = String(req.body?.note || video.correctionNote || '').trim();
    const now = new Date();
    if (video.correctionStatus !== 'needs_correction') {
      video.correctionStatus = 'needs_correction';
      video.correctionReportedBy = req.user.id;
      video.correctionReportedAt = now;
      video.correctionResolvedBy = null;
      video.correctionResolvedAt = null;
      video.correctionResolvedNote = '';
      if (note) video.correctionNote = note;
      await video.save();
    }

    const result = await ensureVideoCorrectionRequest({
      video,
      user: req.user,
      note,
      origin: req.user.role === 'Archivist' ? 'archive' : 'admin',
    });
    if (!result.request) {
      return res.status(409).json({ message: 'Correction zahtjev nije moguće kreirati za ovaj video.' });
    }

    await AuditLog.create({
      action: 'Send Video Correction To Production',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        correctionRequestId: result.request._id,
        correctionJobId: result.correctionJob?._id || null,
        assignedEditorId: result.request.assignedEditor || null,
        note: result.request.note,
      },
    });

    const populated = await populateRequest(CorrectionRequest.findById(result.request._id));
    return res.status(201).json({
      message: result.request.assignedEditor
        ? 'Ispravka je poslana odgovornom montažeru.'
        : 'Ispravka je dodana u produkcijski queue.',
      correction: populated,
    });
  } catch (error) {
    console.error('Error ensuring video correction:', error);
    return res.status(500).json({ message: 'Ispravku nije moguće poslati u produkciju.' });
  }
});

router.patch('/video/:videoId/dismiss', authorize(['Archivist', 'Admin']), async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) {
    return res.status(400).json({ message: 'Obrazloženje povlačenja oznake je obavezno.' });
  }

  try {
    const video = await Video.findById(req.params.videoId);
    if (!video) return res.status(404).json({ message: 'Video nije pronađen.' });
    const request = await findOpenRequestForVideo(video._id);
    const previousRequestStatus = request?.status || 'video_tag_only';

    if (
      request
      && ['in_edit', 'ready_for_review'].includes(request.status)
      && req.user.role !== 'Admin'
    ) {
      return res.status(409).json({
        message: 'Ispravka je već u radu. Samo Administrator može povući aktivnu ispravku.',
      });
    }

    const resolvedAt = new Date();
    if (request) {
      request.status = 'dismissed';
      request.resolvedBy = req.user.id;
      request.resolvedAt = resolvedAt;
      request.resolutionNote = reason;
      request.seenBy = [];
      await request.save();
      if (request.correctionJob) {
        await EditJob.findByIdAndUpdate(request.correctionJob, {
          $set: {
            workspaceState: 'cancelled',
            workspaceStateChangedAt: resolvedAt,
            workspaceStateChangedBy: req.user.id,
            workspaceStateReason: reason,
          },
        });
      }
    }

    video.correctionStatus = 'resolved';
    video.activeCorrectionRequest = null;
    video.correctionResolvedBy = req.user.id;
    video.correctionResolvedAt = resolvedAt;
    video.correctionResolvedNote = reason;
    await video.save();

    await AuditLog.create({
      action: 'Dismiss Video Correction',
      performedBy: req.user.id,
      details: {
        videoId: video._id,
        correctionRequestId: request?._id || null,
        previousStatus: previousRequestStatus,
        reason,
      },
    });

    return res.json({
      message: 'Oznaka potrebne ispravke je povučena uz audit zapis.',
      videoId: video._id,
    });
  } catch (error) {
    console.error('Error dismissing video correction:', error);
    return res.status(500).json({ message: 'Oznaku ispravke nije moguće povući.' });
  }
});

router.patch('/:requestId/claim', authorize(['Editor', 'VideoEditor', 'Admin']), async (req, res) => {
  try {
    const request = await CorrectionRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: 'Prijava ispravke nije pronađena.' });
    if (!['reported', 'assigned'].includes(request.status)) {
      return res.status(409).json({ message: 'Ova ispravka više nije dostupna za preuzimanje.' });
    }
    if (
      request.assignedEditor
      && String(request.assignedEditor) !== String(req.user.id)
      && req.user.role !== 'Admin'
    ) {
      return res.status(409).json({ message: 'Ispravka je već dodijeljena drugom montažeru.' });
    }

    const video = await Video.findById(request.video);
    if (!video) return res.status(404).json({ message: 'Video za ispravku nije pronađen.' });
    const sourceJob = request.sourceJob ? await EditJob.findById(request.sourceJob) : null;
    request.assignedEditor = req.user.id;
    request.status = 'assigned';
    request.seenBy = [];
    await request.save();
    await ensureCorrectionJob(request, {
      video,
      sourceJob,
      assignedEditor: req.user.id,
      actor: req.user.id,
    });

    await AuditLog.create({
      action: 'Claim Video Correction',
      performedBy: req.user.id,
      details: {
        correctionRequestId: request._id,
        videoId: request.video,
      },
    });
    const populated = await populateRequest(CorrectionRequest.findById(request._id));
    return res.json({ message: 'Ispravka je preuzeta.', correction: populated });
  } catch (error) {
    console.error('Error claiming correction:', error);
    return res.status(500).json({ message: 'Ispravku nije moguće preuzeti.' });
  }
});

router.patch('/:requestId/route', authorize(['Producer', 'Admin']), async (req, res) => {
  try {
    const request = await CorrectionRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: 'Prijava ispravke nije pronadjena.' });

    const editor = await User.findOne({
      _id: req.body?.assignedEditorId,
      role: { $in: ['Editor', 'VideoEditor'] },
    }).select('_id username role');
    if (!editor) return res.status(400).json({ message: 'Odabrani montažer nije dostupan.' });

    const video = await Video.findById(request.video);
    if (!video) return res.status(404).json({ message: 'Video za ispravku nije pronadjen.' });
    const sourceJob = request.sourceJob ? await EditJob.findById(request.sourceJob) : null;
    request.assignedEditor = editor._id;
    request.status = 'assigned';
    request.seenBy = [req.user.id];
    await request.save();
    await ensureCorrectionJob(request, {
      video,
      sourceJob,
      assignedEditor: editor._id,
      actor: req.user.id,
    });

    await AuditLog.create({
      action: 'Route Correction To Editor',
      performedBy: req.user.id,
      details: { correctionRequestId: request._id, editorId: editor._id, videoId: request.video },
    });
    const populated = await populateRequest(CorrectionRequest.findById(request._id));
    res.json({ message: 'Ispravka je poslana montažeru.', correction: populated });
  } catch (error) {
    console.error('Error routing correction:', error);
    res.status(500).json({ message: 'Ispravku nije moguće proslijediti.' });
  }
});

router.patch('/:requestId/status', async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: 'Neispravan correction status.' });
    }
    const request = await CorrectionRequest.findById(req.params.requestId);
    if (!request) return res.status(404).json({ message: 'Prijava ispravke nije pronadjena.' });

    if (['Editor', 'VideoEditor'].includes(req.user.role)) {
      if (String(request.assignedEditor || '') !== String(req.user.id)) {
        return res.status(403).json({ message: 'Ispravka nije dodijeljena ovom montažeru.' });
      }
      if (!['in_edit', 'ready_for_review'].includes(status)) {
        return res.status(403).json({ message: 'Montažer ne može postaviti ovaj status.' });
      }
    }
    if (req.user.role === 'Realizator') {
      return res.status(403).json({ message: 'Realizator može prijaviti i pratiti ispravku, ali ne mijenja status.' });
    }
    if (req.user.role === 'Archivist') {
      const canDismiss = status === 'dismissed' && !['in_edit', 'ready_for_review'].includes(request.status);
      const canResolve = status === 'resolved' && request.status === 'ready_for_review';
      if (!canDismiss && !canResolve) {
        return res.status(403).json({
          message: 'Arhivista može povući neaktivnu oznaku ili potvrditi ispravku spremnu za pregled.',
        });
      }
    }

    request.status = status;
    request.seenBy = ['Producer', 'Admin'].includes(req.user.role) ? [req.user.id] : [];
    if (['resolved', 'dismissed'].includes(status)) {
      request.resolvedBy = req.user.id;
      request.resolvedAt = new Date();
      request.resolutionNote = String(req.body?.resolutionNote || '').trim();
      if (status === 'resolved' && !request.correctedBy) {
        request.correctedBy = request.assignedEditor || req.user.id;
        request.correctedAt = request.resolvedAt;
      }
      if (status === 'resolved' && !request.correctedVideo && request.correctionJob) {
        const correctedVideo = await Video.findOne({ sourceJob: request.correctionJob })
          .sort({ uploadDate: -1 })
          .select('_id');
        request.correctedVideo = correctedVideo?._id || null;
      }
      await Video.findByIdAndUpdate(request.video, {
        $set: {
          correctionStatus: 'resolved',
          activeCorrectionRequest: null,
          correctionResolvedBy: req.user.id,
          correctionResolvedAt: request.resolvedAt,
          correctionResolvedNote: request.resolutionNote || (status === 'dismissed' ? 'Prijava odbačena.' : 'Ispravka završena.'),
        },
      });
      if (request.correctionJob) {
        await EditJob.findByIdAndUpdate(request.correctionJob, {
          $set: {
            workspaceState: 'closed',
            workspaceStateChangedAt: new Date(),
            workspaceStateChangedBy: req.user.id,
            workspaceStateReason: request.resolutionNote || 'Correction workflow završen.',
          },
        });
      }
    } else if (request.correctionJob) {
      const jobStatus = status === 'in_edit'
        ? 'in_edit'
        : status === 'ready_for_review'
          ? 'ready_for_qc'
          : 'claimed';
      await EditJob.findByIdAndUpdate(request.correctionJob, { $set: { status: jobStatus } });
    }
    if (status === 'ready_for_review') {
      request.correctedBy = req.user.id;
      request.correctedAt = new Date();
      if (request.correctionJob) {
        const correctedVideo = await Video.findOne({ sourceJob: request.correctionJob })
          .sort({ uploadDate: -1 })
          .select('_id');
        request.correctedVideo = correctedVideo?._id || null;
      }
    }
    await request.save();

    await AuditLog.create({
      action: 'Update Correction Status',
      performedBy: req.user.id,
      details: {
        correctionRequestId: request._id,
        status,
        videoId: request.video,
        correctedBy: request.correctedBy || null,
        correctedVideoId: request.correctedVideo || null,
        resolvedBy: request.resolvedBy || null,
        resolutionNote: request.resolutionNote || '',
      },
    });
    const populated = await populateRequest(CorrectionRequest.findById(request._id));
    res.json({ message: 'Correction status je ažuriran.', correction: populated });
  } catch (error) {
    console.error('Error updating correction status:', error);
    res.status(500).json({ message: 'Correction status nije moguće ažurirati.' });
  }
});

module.exports = router;
