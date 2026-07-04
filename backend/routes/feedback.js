const express = require('express');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/authenticateToken');
const authorize = require('../middleware/authorize');
const { addTextSearchFilter, buildFeedbackSearchText } = require('../utils/searchText');

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

function parseWorkspacePagination(query = {}) {
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || '30', 10) || 30, 1), 150);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

function buildFeedbackFilter(query, user) {
  const filter = {};

  if (user.role !== 'Admin') {
    filter.submittedBy = user.id;
  }

  if (query.status && query.status !== 'all') {
    if (query.status === 'open') {
      filter.status = { $in: ['new', 'reviewing', 'planned'] };
    } else {
      filter.status = query.status;
    }
  }
  if (query.type && query.type !== 'all') filter.type = query.type;
  if (query.priority && query.priority !== 'all') filter.priority = query.priority;
  if (query.area && query.area !== 'all') filter.area = query.area;

  const search = query.q || query.search;
  addTextSearchFilter(filter, search);

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

function sanitizeFeedbackForRole(item, user) {
  const output = typeof item.toObject === 'function' ? item.toObject() : { ...item };

  if (user.role !== 'Admin') {
    delete output.adminComment;
    delete output.comments;
    delete output.userAgent;
  }

  return output;
}

async function buildFeedbackWorkspaceSummary(filter, user) {
  const userFilter = user.role === 'Admin' ? {} : { submittedBy: user.id };
  const scopedFilter = { ...userFilter };

  const [
    total,
    filtered,
    newCount,
    reviewing,
    planned,
    fixed,
    rejected,
    urgent,
    high,
  ] = await Promise.all([
    Feedback.countDocuments(scopedFilter),
    Feedback.countDocuments(filter),
    Feedback.countDocuments({ ...scopedFilter, status: 'new' }),
    Feedback.countDocuments({ ...scopedFilter, status: 'reviewing' }),
    Feedback.countDocuments({ ...scopedFilter, status: 'planned' }),
    Feedback.countDocuments({ ...scopedFilter, status: 'fixed' }),
    Feedback.countDocuments({ ...scopedFilter, status: 'rejected' }),
    Feedback.countDocuments({ ...scopedFilter, priority: 'urgent' }),
    Feedback.countDocuments({ ...scopedFilter, priority: 'high' }),
  ]);

  return {
    total,
    filtered,
    new: newCount,
    reviewing,
    planned,
    fixed,
    rejected,
    urgent,
    high,
  };
}

async function buildFeedbackWorkspaceFacets(filter) {
  const [statuses, priorities, areas, types] = await Promise.all([
    Feedback.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Feedback.aggregate([{ $match: filter }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
    Feedback.aggregate([{ $match: filter }, { $group: { _id: '$area', count: { $sum: 1 } } }]),
    Feedback.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
  ]);

  const normalizeFacet = (items) => items.map((item) => ({
    value: item._id || 'none',
    count: item.count,
  }));

  return {
    statuses: normalizeFacet(statuses),
    priorities: normalizeFacet(priorities),
    areas: normalizeFacet(areas),
    types: normalizeFacet(types),
  };
}

router.get('/workspace', async (req, res) => {
  try {
    const { page, limit, skip } = parseWorkspacePagination(req.query);
    const filter = buildFeedbackFilter(req.query, req.user);

    const [total, feedback, summary, facets] = await Promise.all([
      Feedback.countDocuments(filter),
      populateFeedback(Feedback.find(filter))
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      buildFeedbackWorkspaceSummary(filter, req.user),
      buildFeedbackWorkspaceFacets(filter),
    ]);

    res.json({
      items: feedback.map((item) => sanitizeFeedbackForRole(item, req.user)),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
      summary,
      facets,
    });
  } catch (error) {
    console.error('Error fetching feedback workspace:', error);
    res.status(500).json({ message: 'Error fetching feedback workspace' });
  }
});

router.get('/', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const feedback = await populateFeedback(Feedback.find(buildFeedbackFilter(req.query, req.user)))
      .sort({ priority: -1, updatedAt: -1 })
      .limit(limit);

    res.json(feedback.map((item) => sanitizeFeedbackForRole(item, req.user)));
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
      .select('+searchText');

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

    update.searchText = buildFeedbackSearchText({
      ...existingFeedback.toObject(),
      ...update,
    });

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
