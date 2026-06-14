const express = require('express');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');

const router = express.Router();

const allowedRoles = ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'];
const allowedTypes = ['bug', 'suggestion', 'workflow_issue', 'urgent_production_issue'];
const allowedPriorities = ['low', 'normal', 'high', 'urgent'];
const allowedStatuses = ['new', 'reviewing', 'planned', 'fixed', 'rejected'];
const allowedAreas = ['reporter', 'editor', 'producer', 'realizator', 'admin', 'login', 'processing', 'archive', 'other'];

router.use(authenticateToken);
router.use(authorize(allowedRoles));

function normalizeEnum(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function buildFeedbackFilter(query, user) {
  const filter = {};

  if (user.role !== 'Admin') {
    filter.submittedBy = user.id;
  }

  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.type && query.type !== 'all') filter.type = query.type;
  if (query.priority && query.priority !== 'all') filter.priority = query.priority;
  if (query.area && query.area !== 'all') filter.area = query.area;

  if (query.search) {
    const searchRegex = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { title: searchRegex },
      { description: searchRegex },
      { adminComment: searchRegex },
      { adminResponse: searchRegex },
    ];
  }

  return filter;
}

function populateFeedback(query) {
  return query
    .populate('submittedBy', 'username role')
    .populate('assignedTo', 'username role')
    .populate('adminSeenBy', 'username role')
    .populate('adminResponseBy', 'username role')
    .populate('comments.author', 'username role');
}

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const feedback = await populateFeedback(Feedback.find(buildFeedbackFilter(req.query, req.user)))
      .sort({ priority: -1, updatedAt: -1 })
      .limit(limit);

    if (req.user.role !== 'Admin') {
      return res.json(feedback.map((item) => {
        const output = item.toObject();
        delete output.adminComment;
        delete output.comments;
        delete output.userAgent;
        return output;
      }));
    }

    res.json(feedback);
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ message: 'Error fetching feedback' });
  }
});

router.post('/', async (req, res) => {
  const {
    title,
    description,
    type = 'suggestion',
    priority = 'normal',
    area = 'other',
    pageUrl = '',
  } = req.body;

  if (!title || !title.trim() || !description || !description.trim()) {
    return res.status(400).json({ message: 'Title and description are required.' });
  }

  try {
    const feedback = await Feedback.create({
      title: title.trim(),
      description: description.trim(),
      type: normalizeEnum(type, allowedTypes, 'suggestion'),
      priority: normalizeEnum(priority, allowedPriorities, 'normal'),
      area: normalizeEnum(area, allowedAreas, 'other'),
      submittedBy: req.user.id,
      submittedByRole: req.user.role,
      pageUrl,
      userAgent: req.get('user-agent') || '',
    });

    await AuditLog.create({
      action: 'Submit Feedback',
      performedBy: req.user.id,
      details: {
        feedbackId: feedback._id,
        title: feedback.title,
        type: feedback.type,
        priority: feedback.priority,
        area: feedback.area,
      },
    });

    const populatedFeedback = await populateFeedback(Feedback.findById(feedback._id));

    res.status(201).json({ message: 'Feedback submitted.', feedback: populatedFeedback });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({ message: 'Error submitting feedback' });
  }
});

router.patch('/:feedbackId', authorize(['Admin']), async (req, res) => {
  try {
    const { status, priority, assignedTo, adminComment, adminResponse } = req.body;
    const existingFeedback = await Feedback.findById(req.params.feedbackId)
      .select('adminSeenAt adminResponse status');

    if (!existingFeedback) return res.status(404).json({ message: 'Feedback not found.' });

    const now = new Date();
    const update = { updatedAt: now };

    if (status && status !== 'all') {
      if (!allowedStatuses.includes(status)) return res.status(400).json({ message: 'Invalid feedback status.' });
      update.status = status;
    }

    if (priority && priority !== 'all') {
      if (!allowedPriorities.includes(priority)) return res.status(400).json({ message: 'Invalid feedback priority.' });
      update.priority = priority;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'adminComment')) {
      update.adminComment = adminComment || '';
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'adminResponse')) {
      const responseText = String(adminResponse || '').trim();
      update.adminResponse = responseText;

      if (responseText && responseText !== (existingFeedback.adminResponse || '')) {
        update.adminResponseAt = now;
        update.adminResponseBy = req.user.id;
      }

      if (!responseText) {
        update.adminResponseAt = null;
        update.adminResponseBy = null;
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, 'assignedTo')) {
      if (assignedTo) {
        const assignee = await User.findById(assignedTo).select('_id');
        if (!assignee) return res.status(404).json({ message: 'Assigned user not found.' });
        update.assignedTo = assignee._id;
      } else {
        update.assignedTo = null;
      }
    }

    if (!existingFeedback.adminSeenAt) {
      update.adminSeenAt = now;
      update.adminSeenBy = req.user.id;
    }

    const feedback = await populateFeedback(Feedback.findByIdAndUpdate(
      existingFeedback._id,
      update,
      { new: true }
    ));

    await AuditLog.create({
      action: 'Update Feedback',
      performedBy: req.user.id,
      details: {
        feedbackId: feedback._id,
        title: feedback.title,
        update,
      },
    });

    res.json({ message: 'Feedback updated.', feedback });
  } catch (error) {
    console.error('Error updating feedback:', error);
    res.status(500).json({ message: 'Error updating feedback' });
  }
});

router.post('/:feedbackId/seen', authorize(['Admin']), async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.feedbackId);
    if (!feedback) return res.status(404).json({ message: 'Feedback not found.' });

    const wasAlreadySeen = Boolean(feedback.adminSeenAt);

    if (!feedback.adminSeenAt) {
      feedback.adminSeenAt = new Date();
      feedback.adminSeenBy = req.user.id;
    }

    if (feedback.status === 'new') {
      feedback.status = 'reviewing';
    }

    await feedback.save();

    if (!wasAlreadySeen) {
      await AuditLog.create({
        action: 'Mark Feedback Seen',
        performedBy: req.user.id,
        details: {
          feedbackId: feedback._id,
          title: feedback.title,
        },
      });
    }

    const populatedFeedback = await populateFeedback(Feedback.findById(feedback._id));

    res.json({ message: 'Feedback marked as seen.', feedback: populatedFeedback });
  } catch (error) {
    console.error('Error marking feedback as seen:', error);
    res.status(500).json({ message: 'Error marking feedback as seen' });
  }
});

router.post('/:feedbackId/comments', authorize(['Admin']), async (req, res) => {
  const { body } = req.body;

  if (!body || !body.trim()) {
    return res.status(400).json({ message: 'Comment is required.' });
  }

  try {
    const feedback = await Feedback.findById(req.params.feedbackId);
    if (!feedback) return res.status(404).json({ message: 'Feedback not found.' });

    if (!feedback.adminSeenAt) {
      feedback.adminSeenAt = new Date();
      feedback.adminSeenBy = req.user.id;
    }

    feedback.comments.push({
      body: body.trim(),
      author: req.user.id,
      authorRole: req.user.role,
    });
    await feedback.save();

    await AuditLog.create({
      action: 'Comment Feedback',
      performedBy: req.user.id,
      details: {
        feedbackId: feedback._id,
        title: feedback.title,
      },
    });

    const populatedFeedback = await populateFeedback(Feedback.findById(feedback._id));

    res.status(201).json({ message: 'Feedback comment added.', feedback: populatedFeedback });
  } catch (error) {
    console.error('Error adding feedback comment:', error);
    res.status(500).json({ message: 'Error adding feedback comment' });
  }
});

router.delete('/:feedbackId', authorize(['Admin']), async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.feedbackId)
      .populate('submittedBy', 'username role');

    if (!feedback) return res.status(404).json({ message: 'Feedback not found.' });

    const deletedInfo = {
      feedbackId: feedback._id,
      title: feedback.title,
      type: feedback.type,
      priority: feedback.priority,
      status: feedback.status,
      submittedBy: feedback.submittedBy
        ? {
          id: feedback.submittedBy._id,
          username: feedback.submittedBy.username,
          role: feedback.submittedBy.role,
        }
        : null,
      createdAt: feedback.createdAt,
    };

    await feedback.deleteOne();

    await AuditLog.create({
      action: 'Delete Feedback',
      performedBy: req.user.id,
      details: deletedInfo,
    });

    res.json({ message: 'Feedback deleted.', deleted: deletedInfo });
  } catch (error) {
    console.error('Error deleting feedback:', error);
    res.status(500).json({ message: 'Error deleting feedback' });
  }
});

module.exports = router;
