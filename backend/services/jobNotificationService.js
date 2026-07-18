const Notification = require('../models/Notification');
const { enqueueDomainEvent } = require('./domainEventService');

function getObjectIdString(value) {
  if (!value) return '';
  if (value._id) return value._id.toString();
  return value.toString();
}

function getCommentRecipientIds(job, actor) {
  const actorId = getObjectIdString(actor?.id || actor?._id);
  const recipientIds = [];

  if (actor?.role === 'Reporter') {
    recipientIds.push(getObjectIdString(job.assignedEditor));
  } else if (['Editor', 'VideoEditor'].includes(actor?.role)) {
    recipientIds.push(getObjectIdString(job.reporter));
  } else if (['Producer', 'Admin'].includes(actor?.role)) {
    recipientIds.push(
      getObjectIdString(job.reporter),
      getObjectIdString(job.assignedEditor)
    );
  }

  return Array.from(new Set(recipientIds.filter((id) => id && id !== actorId)));
}

function createBodyPreview(body) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

async function createCommentNotifications(job, actor, comment) {
  const recipientIds = getCommentRecipientIds(job, actor);
  if (recipientIds.length === 0 || !comment?._id) return 0;

  await enqueueDomainEvent({
    type: 'edit_job.comment_added',
    severity: 'action_required',
    actor: actor.id || actor._id,
    recipients: recipientIds,
    entityType: 'edit_job',
    entityId: job._id,
    entityVersion: Number(job.__v || 0),
    title: `Novi komentar: ${job.title}`,
    bodyPreview: createBodyPreview(comment.body),
    deepLink: `vca://job/${job._id}`,
    payload: { jobId: job._id, commentId: comment._id },
    dedupeKey: `edit_job.comment_added:${comment._id}`,
  });
  return recipientIds.length;
}

async function markJobNotificationsRead(jobId, userId) {
  return Notification.updateMany(
    {
      recipient: userId,
      job: jobId,
      state: 'unread',
    },
    {
      $set: { readAt: new Date(), state: 'read' },
    }
  );
}

module.exports = {
  createCommentNotifications,
  getCommentRecipientIds,
  markJobNotificationsRead,
};
