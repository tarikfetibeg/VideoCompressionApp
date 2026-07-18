const express = require('express');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const authenticateToken = require('../middleware/authenticateToken');

const router = express.Router();

router.use(authenticateToken);

function parsePagination(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '20', 10) || 20, 1), 50);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function populateNotification(query) {
  return query
    .populate('actor', 'username role')
    .populate('job', 'title status workspaceState');
}

router.get('/workspace', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { recipient: req.user.id };
    if (String(req.query.unreadOnly || '').toLowerCase() === 'true') {
      filter.state = 'unread';
    }

    const unreadFilter = { recipient: req.user.id, state: 'unread' };
    const [items, total, unreadCount] = await Promise.all([
      populateNotification(
        Notification.find(filter)
          .sort({ readAt: 1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
      ),
      Notification.countDocuments(filter),
      Notification.countDocuments(unreadFilter),
    ]);

    res.json({
      items,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    console.error('Error loading notifications:', error);
    res.status(500).json({ message: 'Notifikacije se ne mogu učitati.' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user.id, state: 'unread', severity: { $ne: 'critical' } },
      { $set: { readAt: new Date(), state: 'read' } }
    );
    res.json({ message: 'Sve notifikacije su označene kao pročitane.', updated: result.modifiedCount });
  } catch (error) {
    console.error('Error marking all notifications read:', error);
    res.status(500).json({ message: 'Notifikacije se ne mogu ažurirati.' });
  }
});

router.patch('/read-job/:jobId', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.jobId)) {
    return res.status(400).json({ message: 'Neispravan job ID.' });
  }

  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user.id,
        job: req.params.jobId,
        state: 'unread',
      },
      { $set: { readAt: new Date(), state: 'read' } }
    );
    return res.json({ message: 'Job notifikacije su označene kao pročitane.', updated: result.modifiedCount });
  } catch (error) {
    console.error('Error marking job notifications read:', error);
    return res.status(500).json({ message: 'Notifikacije se ne mogu ažurirati.' });
  }
});

router.patch('/:notificationId/read', async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.notificationId)) {
    return res.status(400).json({ message: 'Neispravan notification ID.' });
  }

  try {
    const notification = await populateNotification(
      Notification.findOneAndUpdate(
        {
          _id: req.params.notificationId,
          recipient: req.user.id,
        },
        { $set: { readAt: new Date(), state: 'read' } },
        { new: true }
      )
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notifikacija nije pronađena.' });
    }

    return res.json(notification);
  } catch (error) {
    console.error('Error marking notification read:', error);
    return res.status(500).json({ message: 'Notifikacija se ne može ažurirati.' });
  }
});

module.exports = router;
