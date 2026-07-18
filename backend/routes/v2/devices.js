const express = require('express');
const { z } = require('zod');
const authenticateToken = require('../../middleware/authenticateToken');
const Device = require('../../models/Device');
const AuditLog = require('../../models/AuditLog');
const { revokeDevice, upsertDevice } = require('../../services/v2SessionService');

const router = express.Router();
router.use(authenticateToken);

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(200),
  hostname: z.string().min(1).max(160),
  platform: z.string().max(50).default('windows'),
  platformVersion: z.string().max(80).optional(),
  appVersion: z.string().max(40).default('2.0.0'),
  updateChannel: z.enum(['pilot', 'stable']).default('stable'),
  notificationPermission: z.enum(['unknown', 'granted', 'denied']).default('unknown'),
  site: z.string().max(80).default('primary'),
  edgeLatencyMs: z.number().min(0).max(120000).nullable().optional(),
});

router.post('/register', async (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Podaci uređaja nisu ispravni.' });

  try {
    const device = await upsertDevice(req.user.id, parsed.data);
    if (parsed.data.edgeLatencyMs != null) {
      device.edgeLatencyMs = parsed.data.edgeLatencyMs;
      await device.save();
    }
    return res.json(device);
  } catch (error) {
    console.error('Device registration failed:', error);
    return res.status(500).json({ message: 'Uređaj se ne može registrovati.' });
  }
});

router.patch('/heartbeat', async (req, res) => {
  const parsed = deviceSchema.partial().required({ deviceId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Heartbeat nije ispravan.' });

  try {
    const update = {
      user: req.user.id,
      lastSeenAt: new Date(),
    };
    for (const field of ['appVersion', 'notificationPermission', 'edgeLatencyMs', 'updateChannel']) {
      if (parsed.data[field] !== undefined) update[field] = parsed.data[field];
    }
    const device = await Device.findOneAndUpdate(
      { deviceId: parsed.data.deviceId, revokedAt: null },
      { $set: update },
      { new: true }
    );
    if (!device) return res.status(404).json({ message: 'Uređaj nije registrovan ili je opozvan.' });
    return res.json({ ok: true, serverTime: new Date(), device });
  } catch (error) {
    console.error('Device heartbeat failed:', error);
    return res.status(500).json({ message: 'Heartbeat nije sačuvan.' });
  }
});

router.get('/workspace', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin može pregledati uređaje.' });
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const filter = {};
  if (req.query.channel) filter.updateChannel = req.query.channel;
  if (req.query.notificationPermission) filter.notificationPermission = req.query.notificationPermission;

  const [items, total] = await Promise.all([
    Device.find(filter)
      .populate('user', 'username role')
      .sort({ lastSeenAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Device.countDocuments(filter),
  ]);
  const onlineThreshold = new Date(Date.now() - 90 * 1000);
  const [online, outdated, notificationsDenied] = await Promise.all([
    Device.countDocuments({ revokedAt: null, lastSeenAt: { $gte: onlineThreshold } }),
    Device.countDocuments({ revokedAt: null, appVersion: { $ne: process.env.DESKTOP_CURRENT_VERSION || '2.0.0' } }),
    Device.countDocuments({ revokedAt: null, notificationPermission: 'denied' }),
  ]);

  return res.json({
    items,
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1),
    summary: { online, offline: Math.max(total - online, 0), outdated, notificationsDenied },
  });
});

router.patch('/:deviceId', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin može mijenjati uređaj.' });
  const update = {};
  if (['pilot', 'stable'].includes(req.body?.updateChannel)) update.updateChannel = req.body.updateChannel;
  if (typeof req.body?.site === 'string' && req.body.site.trim()) update.site = req.body.site.trim().slice(0, 80);
  if (!Object.keys(update).length) return res.status(400).json({ message: 'Nema ispravnih promjena.' });
  const device = await Device.findOneAndUpdate(
    { deviceId: req.params.deviceId, revokedAt: null },
    { $set: update },
    { new: true }
  );
  if (!device) return res.status(404).json({ message: 'Uređaj nije pronađen.' });
  await AuditLog.create({
    action: 'Update Desktop Device',
    performedBy: req.user.id,
    details: { deviceId: device.deviceId, ...update },
  });
  return res.json({ message: 'Uređaj je ažuriran.', device });
});

router.patch('/:deviceId/revoke', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Samo Admin može opozvati uređaj.' });
  try {
    const device = await revokeDevice(req.params.deviceId, req.user.id);
    if (!device) return res.status(404).json({ message: 'Uređaj nije pronađen.' });
    await AuditLog.create({
      action: 'Revoke Desktop Device',
      performedBy: req.user.id,
      details: { deviceId: device.deviceId, hostname: device.hostname },
    });
    return res.json({ message: 'Uređaj i njegove sesije su opozvani.', device });
  } catch (error) {
    console.error('Device revoke failed:', error);
    return res.status(500).json({ message: 'Uređaj se ne može opozvati.' });
  }
});

module.exports = router;
