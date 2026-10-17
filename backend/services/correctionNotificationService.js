const Notification = require('../models/Notification');
const User = require('../models/User');

const NOTIFICATION_RETENTION_DAYS = 180;

function getObjectId(value) {
  return value?._id || value?.id || value || null;
}

function getObjectIdString(value) {
  const objectId = getObjectId(value);
  return objectId ? String(objectId) : '';
}

function createExpiryDate() {
  return new Date(Date.now() + NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function createBodyPreview(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function getVideoTitle(video) {
  return video?.finalTitle || video?.originalFilename || video?.filename || 'Video';
}

async function resolveRecipientIds(request, correctionJob, actor) {
  const actorId = getObjectIdString(actor);
  const assignedEditorId = getObjectIdString(
    request?.assignedEditor || correctionJob?.assignedEditor
  );

  if (assignedEditorId) {
    return {
      recipientIds: assignedEditorId === actorId ? [] : [assignedEditorId],
      target: 'editor',
    };
  }

  let recipients = await User.find({ role: 'Producer' }).select('_id').lean();
  let target = 'producer';
  if (recipients.length === 0) {
    recipients = await User.find({ role: 'Admin' }).select('_id').lean();
    target = 'admin';
  }

  return {
    recipientIds: Array.from(new Set(
      recipients
        .map((recipient) => getObjectIdString(recipient))
        .filter((recipientId) => recipientId && recipientId !== actorId)
    )),
    target,
  };
}

async function createCorrectionNotifications({ request, correctionJob = null, video, actor }) {
  if (!request?._id || !video?._id || !getObjectId(actor)) {
    return { created: 0, refreshed: 0, recipients: 0, target: 'none' };
  }

  const { recipientIds, target } = await resolveRecipientIds(request, correctionJob, actor);
  if (recipientIds.length === 0) {
    return { created: 0, refreshed: 0, recipients: 0, target };
  }

  const title = getVideoTitle(video);
  const originLabel = request.origin === 'archive'
    ? 'Arhiva je prijavila problem'
    : request.origin === 'realization'
      ? 'Realizacija je prijavila problem'
      : 'Prijavljen je problem';
  const bodyPreview = createBodyPreview(`${originLabel}: ${request.note}`);
  const actorId = getObjectId(actor);
  const expiresAt = createExpiryDate();

  const operations = recipientIds.map((recipient) => ({
    updateOne: {
      filter: {
        recipient,
        kind: 'video_correction',
        correctionRequest: request._id,
      },
      update: {
        $set: {
          actor: actorId,
          job: correctionJob?._id || request.correctionJob || null,
          video: video._id,
          title: target === 'editor'
            ? `Nova ispravka: ${title}`
            : `Ispravka čeka dodjelu: ${title}`,
          bodyPreview,
          readAt: null,
          expiresAt,
        },
        $setOnInsert: {
          // Existing deployments use commentId as the notification deduplication key.
          commentId: request._id,
          correctionRequest: request._id,
          kind: 'video_correction',
          recipient,
          createdAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  const result = await Notification.bulkWrite(operations, { ordered: false });
  return {
    created: Number(result.upsertedCount || 0),
    refreshed: Number(result.modifiedCount || 0),
    recipients: recipientIds.length,
    target,
  };
}

module.exports = {
  createCorrectionNotifications,
  resolveRecipientIds,
};
