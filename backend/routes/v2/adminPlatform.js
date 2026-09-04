const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const authenticateToken = require('../../middleware/authenticateToken');
const MediaNode = require('../../models/MediaNode');
const MediaTask = require('../../models/MediaTask');
const EscalationPolicy = require('../../models/EscalationPolicy');
const AuditLog = require('../../models/AuditLog');
const {
  loadPlatformHealth,
  loadPlatformOverview,
} = require('../../services/platformOverviewService');

const router = express.Router();
router.use(authenticateToken);
router.use((req, res, next) => (
  req.user.role === 'Admin' ? next() : res.status(403).json({ message: 'Samo Admin ima pristup platformi.' })
));

const policySchema = z.object({
  eventType: z.string().min(3).max(160),
  enabled: z.boolean(),
  repeatAfterSeconds: z.number().int().min(30).max(3600),
  acknowledgeAfterSeconds: z.number().int().min(60).max(7200),
  escalationRoles: z.array(z.enum(['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'])).max(7),
  maxEscalationLevel: z.number().int().min(1).max(5),
});

router.get('/', async (req, res) => {
  try {
    return res.json(await loadPlatformOverview());
  } catch (error) {
    console.error('Admin platform load failed:', error);
    return res.status(500).json({ message: 'Platform pregled se ne može učitati.' });
  }
});

router.get('/health', async (req, res) => {
  try {
    return res.json(await loadPlatformHealth());
  } catch (error) {
    console.error('Admin platform health failed:', error);
    return res.status(500).json({ message: 'Health pregled se ne može učitati.' });
  }
});

router.put('/escalation-policy/:eventType', async (req, res) => {
  const parsed = policySchema.safeParse({ ...req.body, eventType: req.params.eventType });
  if (!parsed.success) return res.status(400).json({ message: 'Pravila eskalacije nisu ispravna.' });

  const policy = await EscalationPolicy.findOneAndUpdate(
    { eventType: parsed.data.eventType },
    { $set: parsed.data },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await AuditLog.create({
    action: 'Update Notification Escalation Policy',
    performedBy: req.user.id,
    details: parsed.data,
  });
  return res.json({ message: 'Pravilo eskalacije je sačuvano.', policy });
});

router.patch('/media-nodes/:nodeId/status', async (req, res) => {
  const status = ['online', 'degraded', 'offline', 'maintenance'].includes(req.body?.status)
    ? req.body.status
    : null;
  if (!status) return res.status(400).json({ message: 'Status Media Edge čvora nije ispravan.' });
  const node = await MediaNode.findOneAndUpdate({ nodeId: req.params.nodeId }, { $set: { status } }, { new: true });
  if (!node) return res.status(404).json({ message: 'Media Edge nije pronađen.' });
  await AuditLog.create({
    action: 'Update Media Node Status',
    performedBy: req.user.id,
    details: { nodeId: node.nodeId, status },
  });
  return res.json({ message: 'Status Media Edge čvora je ažuriran.', node });
});

router.post('/media-nodes/:nodeId/tasks', async (req, res) => {
  const kind = ['video_processing', 'hls_build', 'preview_rebuild', 'proxy_sync', 'checksum'].includes(req.body?.kind)
    ? req.body.kind
    : null;
  if (!kind) return res.status(400).json({ message: 'Vrsta Media Edge zadatka nije podržana.' });
  const node = await MediaNode.findOne({ nodeId: req.params.nodeId });
  if (!node) return res.status(404).json({ message: 'Media Edge nije pronađen.' });
  const task = await MediaTask.create({
    taskId: crypto.randomUUID(),
    node: node._id,
    kind,
    video: req.body.videoId || null,
    payload: req.body.payload || {},
  });
  await AuditLog.create({
    action: 'Queue Media Edge Task',
    performedBy: req.user.id,
    details: { nodeId: node.nodeId, taskId: task.taskId, kind },
  });
  return res.status(201).json(task);
});

module.exports = router;
