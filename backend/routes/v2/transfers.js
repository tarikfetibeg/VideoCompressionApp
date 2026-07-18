const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const authenticateToken = require('../../middleware/authenticateToken');
const MediaAsset = require('../../models/MediaAsset');
const MediaNode = require('../../models/MediaNode');
const TransferSession = require('../../models/TransferSession');

const router = express.Router();
router.use(authenticateToken);

const createSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  direction: z.enum(['upload', 'download']),
  kind: z.string().min(1).max(80),
  entityType: z.enum(['video', 'edit_job', 'show_day', 'off_audio']),
  entityId: z.string().min(1),
  filename: z.string().min(1).max(500),
  totalBytes: z.number().int().nonnegative().default(0),
  sha256: z.string().max(128).optional(),
  mediaAssetId: z.string().optional(),
  nodeId: z.string().optional(),
  site: z.string().default('primary'),
});

function signTransferToken(transfer, node) {
  const secret = process.env.EDGE_TRANSFER_SECRET || process.env.JWT_SECRET;
  return jwt.sign({
    tokenType: 'edge-transfer',
    transferId: transfer.transferId,
    userId: transfer.user,
    nodeId: node.nodeId,
    direction: transfer.direction,
    mediaAssetId: transfer.mediaAsset ? transfer.mediaAsset.toString() : undefined,
  }, secret, { expiresIn: '24h' });
}

async function chooseNode(input) {
  if (input.nodeId) return MediaNode.findOne({ nodeId: input.nodeId, status: { $in: ['online', 'degraded'] } });
  return MediaNode.findOne({ site: input.site, kind: 'edge', status: { $in: ['online', 'degraded'] } })
    .sort({ lastSeenAt: -1 });
}

router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Transfer zahtjev nije ispravan.' });

  try {
    const existing = await TransferSession.findOne({
      user: req.user.id,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    if (existing) return res.json(existing);

    let asset = null;
    let node = null;
    if (parsed.data.direction === 'download') {
      asset = parsed.data.mediaAssetId
        ? await MediaAsset.findById(parsed.data.mediaAssetId).populate('node')
        : await MediaAsset.findOne({
          video: parsed.data.entityId,
          kind: parsed.data.kind,
          status: 'available',
        }).populate('node');
      node = asset?.node || null;
    } else {
      node = await chooseNode(parsed.data);
    }
    if (!node) return res.status(503).json({ message: 'Nijedan Media Edge trenutno nije dostupan.' });

    const transfer = await TransferSession.create({
      transferId: crypto.randomUUID(),
      idempotencyKey: parsed.data.idempotencyKey,
      user: req.user.id,
      mediaNode: node._id,
      mediaAsset: asset?._id,
      direction: parsed.data.direction,
      kind: parsed.data.kind,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      filename: parsed.data.filename,
      totalBytes: parsed.data.totalBytes || asset?.size || 0,
      sha256: parsed.data.sha256 || asset?.sha256 || '',
      status: 'queued',
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    const token = signTransferToken(transfer, node);
    transfer.resumableUrl = parsed.data.direction === 'upload'
      ? `${node.baseUrl.replace(/\/$/, '')}/files`
      : `${node.baseUrl.replace(/\/$/, '')}/api/edge/assets/${asset?._id}`;
    transfer.ticketExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await transfer.save();

    return res.status(201).json({
      ...transfer.toObject(),
      authorization: `Bearer ${token}`,
      tusVersion: parsed.data.direction === 'upload' ? '1.0.0' : undefined,
      acceptRanges: parsed.data.direction === 'download' ? 'bytes' : undefined,
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await TransferSession.findOne({
        user: req.user.id,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return res.json(existing);
    }
    console.error('Transfer creation failed:', error);
    return res.status(500).json({ message: 'Transfer se ne može pripremiti.' });
  }
});

router.get('/:transferId', async (req, res) => {
  const transfer = await TransferSession.findOne({ transferId: req.params.transferId, user: req.user.id });
  if (!transfer) return res.status(404).json({ message: 'Transfer nije pronađen.' });
  return res.json(transfer);
});

router.patch('/:transferId', async (req, res) => {
  const requestedStatus = req.body?.status;
  if (!['paused', 'cancelled'].includes(requestedStatus)) {
    return res.status(400).json({ message: 'Dozvoljeno je pauziranje ili otkazivanje transfera.' });
  }
  const transfer = await TransferSession.findOneAndUpdate(
    {
      transferId: req.params.transferId,
      user: req.user.id,
      status: { $nin: ['completed', 'cancelled'] },
    },
    { $set: { status: requestedStatus } },
    { new: true }
  );
  if (!transfer) return res.status(404).json({ message: 'Aktivni transfer nije pronađen.' });
  return res.json(transfer);
});

module.exports = router;
