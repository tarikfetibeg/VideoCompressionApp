const EventOutbox = require('../models/EventOutbox');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { publishRealtimeEvent } = require('../realtime/realtimeGateway');

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 180;

function uniqueIds(values = []) {
  return Array.from(new Set(values.filter(Boolean).map((value) => value.toString())));
}

function eventExpiryDate() {
  return new Date(Date.now() + DEFAULT_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

async function enqueueDomainEvent(input) {
  const dedupeKey = String(input.dedupeKey || `${input.type}:${input.entityType}:${input.entityId}:${Date.now()}`);
  return EventOutbox.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        type: input.type,
        severity: input.severity || 'info',
        actor: input.actor || null,
        recipients: uniqueIds(input.recipients),
        recipientRoles: Array.from(new Set(input.recipientRoles || [])),
        entityType: input.entityType,
        entityId: input.entityId || null,
        entityVersion: Number(input.entityVersion || 0),
        title: input.title,
        bodyPreview: String(input.bodyPreview || '').slice(0, 500),
        deepLink: input.deepLink || '',
        payload: input.payload || {},
        dedupeKey,
        occurredAt: input.occurredAt || new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function resolveRecipients(event) {
  const ids = uniqueIds(event.recipients);
  if (event.recipientRoles?.length) {
    const users = await User.find({ role: { $in: event.recipientRoles } }).select('_id');
    ids.push(...users.map((user) => user._id.toString()));
  }
  const actorId = event.actor?.toString();
  return uniqueIds(ids).filter((id) => id !== actorId || event.payload?.includeActor === true);
}

function toEnvelope(event) {
  return {
    id: event._id.toString(),
    type: event.type,
    severity: event.severity,
    entity: {
      type: event.entityType,
      id: event.entityId?.toString() || event._id.toString(),
    },
    version: Number(event.entityVersion || 0),
    occurredAt: event.occurredAt.toISOString(),
    payload: {
      ...event.payload,
      title: event.title,
      bodyPreview: event.bodyPreview,
      deepLink: event.deepLink,
    },
  };
}

async function materializeNotifications(event, recipients) {
  const ackDeadlineAt = event.severity === 'critical'
    ? new Date(Date.now() + 180 * 1000)
    : null;
  const expiresAt = eventExpiryDate();
  const documents = recipients.map((recipient) => ({
    recipient,
    actor: event.actor || null,
    kind: event.type,
    sourceEvent: event._id,
    severity: event.severity,
    state: 'unread',
    entityType: event.entityType,
    entityId: event.entityId || null,
    job: event.entityType === 'edit_job' ? event.entityId : event.payload?.jobId || null,
    title: event.title,
    bodyPreview: event.bodyPreview,
    deepLink: event.deepLink,
    actionRequired: event.severity !== 'info',
    dedupeKey: `${event.dedupeKey}:${recipient}`,
    payload: event.payload,
    ackDeadlineAt,
    expiresAt,
  }));

  if (!documents.length) return [];
  try {
    return await Notification.insertMany(documents, { ordered: false });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Notification.find({ sourceEvent: event._id, recipient: { $in: recipients } });
  }
}

async function processOutboxEvent(event) {
  const recipients = await resolveRecipients(event);
  await materializeNotifications(event, recipients);
  const envelope = toEnvelope(event);
  await publishRealtimeEvent({ envelope, recipients, roles: event.recipientRoles || [] });
  event.processedAt = event.processedAt || new Date();
  event.publishedAt = new Date();
  event.lastError = '';
  await event.save();
  return { eventId: event._id, recipients: recipients.length };
}

async function processOutboxBatch(limit = 50) {
  const events = await EventOutbox.find({
    publishedAt: null,
    nextAttemptAt: { $lte: new Date() },
  }).sort({ occurredAt: 1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const result = { processed: 0, failed: 0 };
  for (const event of events) {
    try {
      await processOutboxEvent(event);
      result.processed += 1;
    } catch (error) {
      event.attempts += 1;
      event.lastError = String(error.message || error).slice(0, 1000);
      event.nextAttemptAt = new Date(Date.now() + Math.min(60, 2 ** event.attempts) * 1000);
      await event.save();
      result.failed += 1;
    }
  }
  return result;
}

module.exports = {
  enqueueDomainEvent,
  processOutboxBatch,
  processOutboxEvent,
  toEnvelope,
};
