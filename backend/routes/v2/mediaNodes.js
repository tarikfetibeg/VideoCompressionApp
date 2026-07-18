const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const authenticateEdge = require('../../middleware/authenticateEdge');
const MediaAsset = require('../../models/MediaAsset');
const MediaNode = require('../../models/MediaNode');
const MediaTask = require('../../models/MediaTask');
const TransferSession = require('../../models/TransferSession');

const router = express.Router();
router.use(authenticateEdge);

const registrationSchema = z.object({
  nodeId: z.string().min(3).max(120),
  name: z.string().min(2).max(160),
  site: z.string().min(1).max(80).default('primary'),
  baseUrl: z.url(),
  capabilities: z.record(z.string(), z.unknown()).default({}),
  storage: z.record(z.string(), z.unknown()).default({}),
});

router.post('/register', async (req, res) => {
  const parsed = registrationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Media Edge podaci nisu ispravni.' });

  const node = await MediaNode.findOneAndUpdate(
    { nodeId: parsed.data.nodeId },
    {
      $set: {
        ...parsed.data,
        kind: 'edge',
        status: 'online',
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return res.json({ node, serverTime: new Date() });
});

router.patch('/:nodeId/heartbeat', async (req, res) => {
  const node = await MediaNode.findOneAndUpdate(
    { nodeId: req.params.nodeId },
    {
      $set: {
        status: req.body?.status === 'degraded' ? 'degraded' : 'online',
        lastSeenAt: new Date(),
        capabilities: req.body?.capabilities || {},
        storage: req.body?.storage || {},
      },
    },
    { new: true }
  );
  if (!node) return res.status(404).json({ message: 'Media Edge nije registrovan.' });
  return res.json({ ok: true, serverTime: new Date() });
});

router.post('/:nodeId/tasks/claim', async (req, res) => {
  const node = await MediaNode.findOne({ nodeId: req.params.nodeId });
  if (!node) return res.status(404).json({ message: 'Media Edge nije registrovan.' });
  const now = new Date();
  const task = await MediaTask.findOneAndUpdate(
    {
      node: node._id,
      $or: [
        { status: 'queued' },
        { status: 'claimed', leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'claimed',
        claimedAt: now,
        leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      $inc: { attempts: 1 },
    },
    { new: true, sort: { createdAt: 1 } }
  );
  return res.json({ task });
});

router.patch('/:nodeId/tasks/:taskId', async (req, res) => {
  const node = await MediaNode.findOne({ nodeId: req.params.nodeId });
  if (!node) return res.status(404).json({ message: 'Media Edge nije registrovan.' });
  const status = ['processing', 'completed', 'failed'].includes(req.body?.status)
    ? req.body.status
    : 'processing';
  const task = await MediaTask.findOneAndUpdate(
    { taskId: req.params.taskId, node: node._id },
    {
      $set: {
        status,
        result: req.body?.result || {},
        error: String(req.body?.error || '').slice(0, 2000),
        completedAt: ['completed', 'failed'].includes(status) ? new Date() : null,
      },
    },
    { new: true }
  );
  if (!task) return res.status(404).json({ message: 'Media task nije pronađen.' });
  return res.json(task);
});

router.post('/:nodeId/transfers/:transferId/complete', async (req, res) => {
  const node = await MediaNode.findOne({ nodeId: req.params.nodeId });
  if (!node) return res.status(404).json({ message: 'Media Edge nije registrovan.' });
  const transfer = await TransferSession.findOne({
    transferId: req.params.transferId,
    mediaNode: node._id,
    direction: 'upload',
  });
  if (!transfer) return res.status(404).json({ message: 'Transfer nije pronađen.' });

  transfer.status = 'completed';
  transfer.transferredBytes = Number(req.body?.size || transfer.totalBytes || 0);
  transfer.sha256 = String(req.body?.sha256 || transfer.sha256 || '');
  transfer.completedAt = new Date();
  transfer.error = '';
  await transfer.save();

  if (transfer.entityType === 'video' && transfer.entityId && req.body?.relativePath) {
    const kind = ['raw', 'master', 'final', 'mp4_preview', 'hls', 'thumbnail', 'scrub']
      .includes(transfer.kind) ? transfer.kind : 'raw';
    await MediaAsset.findOneAndUpdate(
      {
        video: transfer.entityId,
        node: node._id,
        kind,
        relativePath: req.body.relativePath,
      },
      {
        $set: {
          status: 'available',
          size: transfer.transferredBytes,
          sha256: transfer.sha256,
          verifiedAt: transfer.sha256 ? new Date() : null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return res.json({ ok: true, transfer });
});

router.post('/:nodeId/tasks', async (req, res) => {
  const node = await MediaNode.findOne({ nodeId: req.params.nodeId });
  if (!node) return res.status(404).json({ message: 'Media Edge nije registrovan.' });
  const task = await MediaTask.create({
    taskId: crypto.randomUUID(),
    node: node._id,
    kind: req.body.kind,
    video: req.body.videoId || null,
    payload: req.body.payload || {},
  });
  return res.status(201).json(task);
});

module.exports = router;
