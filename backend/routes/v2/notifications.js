const express = require('express');
const mongoose = require('mongoose');
const authenticateToken = require('../../middleware/authenticateToken');
const Notification = require('../../models/Notification');

const router = express.Router();
router.use(authenticateToken);

function encodeCursor(item) {
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item._id })).toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed.createdAt || !mongoose.Types.ObjectId.isValid(parsed.id)) return null;
    return { createdAt: new Date(parsed.createdAt), id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    return null;
  }
}

function populate(query) {
  return query
    .populate('actor', 'username role')
    .populate('job', 'title status workspaceState')
    .populate('acknowledgedBy', 'username role');
}

router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 100);
  const filter = { recipient: req.user.id };
  if (req.query.state) filter.state = req.query.state;
  if (req.query.severity) filter.severity = req.query.severity;
  if (String(req.query.unreadOnly || '') === 'true') filter.state = 'unread';

  const cursor = decodeCursor(req.query.cursor);
  if (cursor) {
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  try {
    const [items, unreadCount, criticalCount] = await Promise.all([
      populate(Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)),
      Notification.countDocuments({ recipient: req.user.id, state: 'unread' }),
      Notification.countDocuments({
        recipient: req.user.id,
        severity: 'critical',
        state: { $nin: ['acknowledged', 'resolved'] },
      }),
    ]);
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    return res.json({
      items: pageItems,
      unreadCount,
      criticalCount,
      nextCursor: hasMore ? encodeCursor(pageItems[pageItems.length - 1]) : null,
    });
  } catch (error) {
    console.error('V2 notifications load failed:', error);
    return res.status(500).json({ message: 'Notifikacije se ne mogu učitati.' });
  }
});

router.patch('/read-all', async (req, res) => {
  const now = new Date();
  const result = await Notification.updateMany(
    { recipient: req.user.id, state: 'unread', severity: { $ne: 'critical' } },
    { $set: { state: 'read', readAt: now } }
  );
  return res.json({ updated: result.modifiedCount });
});

router.patch('/:notificationId/read', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) {
    return res.status(400).json({ message: 'Notifikacija nije ispravna.' });
  }
  const notification = await populate(Notification.findOneAndUpdate(
    { _id: req.params.notificationId, recipient: req.user.id },
    { $set: { state: 'read', readAt: new Date() } },
    { new: true }
  ));
  if (!notification) return res.status(404).json({ message: 'Notifikacija nije pronađena.' });
  return res.json(notification);
});

router.post('/:notificationId/ack', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) {
    return res.status(400).json({ message: 'Notifikacija nije ispravna.' });
  }
  const now = new Date();
  const notification = await populate(Notification.findOneAndUpdate(
    { _id: req.params.notificationId, recipient: req.user.id },
    {
      $set: {
        state: 'acknowledged',
        readAt: now,
        acknowledgedAt: now,
        acknowledgedBy: req.user.id,
      },
    },
    { new: true }
  ));
  if (!notification) return res.status(404).json({ message: 'Notifikacija nije pronađena.' });
  return res.json(notification);
});

module.exports = router;
