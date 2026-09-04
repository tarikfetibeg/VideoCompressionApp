const express = require('express');
const mongoose = require('mongoose');
const authenticateToken = require('../../middleware/authenticateToken');
const Video = require('../../models/Video');
const AuditLog = require('../../models/AuditLog');
const { enqueueTechnicalQc } = require('../../queues/technicalQcQueue');

const router = express.Router();
router.use(authenticateToken);

const RUN_ROLES = new Set(['Editor', 'VideoEditor', 'Producer', 'Archivist', 'Admin']);

router.get('/summary', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin vidi zbir tehničkog QC-a.' });
  const rows = await Video.aggregate([
    { $group: { _id: { $ifNull: ['$technicalQc.status', 'not_run'] }, count: { $sum: 1 } } },
  ]);
  return res.json({
    statuses: Object.fromEntries(rows.map((row) => [row._id, row.count])),
    generatedAt: new Date(),
  });
});

router.get('/:videoId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.videoId)) {
    return res.status(400).json({ message: 'Video ID nije ispravan.' });
  }
  const video = await Video.findById(req.params.videoId)
    .select('filename originalFilename technicalQc')
    .populate('technicalQc.requestedBy', 'username role')
    .lean();
  if (!video) return res.status(404).json({ message: 'Video nije pronađen.' });
  return res.json({ videoId: video._id, technicalQc: video.technicalQc || { status: 'not_run' } });
});

router.post('/:videoId/run', async (req, res) => {
  if (!RUN_ROLES.has(req.user.role)) {
    return res.status(403).json({ message: 'Nemaš pravo pokrenuti tehnički QC.' });
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.videoId)) {
    return res.status(400).json({ message: 'Video ID nije ispravan.' });
  }
  try {
    const job = await enqueueTechnicalQc(req.params.videoId, {
      requestedBy: req.user.id,
      force: req.body?.force === true,
    });
    await AuditLog.create({
      action: 'Queue Technical QC',
      performedBy: req.user.id,
      details: { videoId: req.params.videoId, queueJobId: job.id, force: req.body?.force === true },
    });
    return res.status(202).json({
      message: job.existing ? 'Tehnički QC je već u toku.' : 'Tehnički QC je dodat u lagani serijski red.',
      jobId: job.id,
      status: 'queued',
    });
  } catch (error) {
    const notFound = error.message === 'Video nije pronađen.';
    return res.status(notFound ? 404 : 500).json({ message: error.message || 'Tehnički QC se ne može pokrenuti.' });
  }
});

module.exports = router;
