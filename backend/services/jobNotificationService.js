const Notification = require('../models/Notification');

const NOTIFICATION_RETENTION_DAYS = 180;

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

function createExpiryDate() {
  return new Date(Date.now() + NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function createBodyPreview(body) {
  const normalized = String(body || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

async function createCommentNotifications(job, actor, comment) {
  const recipientIds = getCommentRecipientIds(job, actor);
  if (recipientIds.length === 0 || !comment?._id) return 0;

  const expiresAt = createExpiryDate();
  const documents = recipientIds.map((recipient) => ({
    recipient,
    actor: actor.id || actor._id,
    kind: 'edit_job_comment',
    job: job._id,
    commentId: comment._id,
    title: `Novi komentar: ${job.title}`,
    bodyPreview: createBodyPreview(comment.body),
    expiresAt,
  }));

  try {
    const result = await Notification.insertMany(documents, { ordered: false });
    return result.length;
  } catch (error) {
    if (error?.code === 11000) {
      return Number(error?.result?.insertedCount || 0);
    }
    throw error;
  }
}

async function markJobNotificationsRead(jobId, userId) {
  return Notification.updateMany(
    {
      recipient: userId,
      job: jobId,
      readAt: null,
    },
    {
      $set: { readAt: new Date() },
    }
  );
}

module.exports = {
  createCommentNotifications,
  getCommentRecipientIds,
  markJobNotificationsRead,
};
