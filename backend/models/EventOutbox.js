const mongoose = require('mongoose');

const EventOutboxSchema = new mongoose.Schema({
  type: { type: String, required: true },
  severity: {
    type: String,
    enum: ['info', 'action_required', 'critical'],
    default: 'info',
  },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  recipients: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  recipientRoles: [{
    type: String,
    enum: ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'],
  }],
  entityType: {
    type: String,
    enum: ['edit_job', 'video', 'show_day', 'correction', 'transfer', 'system'],
    required: true,
  },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  entityVersion: { type: Number, min: 0, default: 0 },
  title: { type: String, required: true },
  bodyPreview: { type: String, default: '' },
  deepLink: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  dedupeKey: { type: String, required: true, unique: true },
  occurredAt: { type: Date, default: Date.now },
  nextAttemptAt: { type: Date, default: Date.now },
  attempts: { type: Number, min: 0, default: 0 },
  lastError: { type: String, default: '' },
  processedAt: { type: Date, default: null },
  publishedAt: { type: Date, default: null },
}, { timestamps: true });

EventOutboxSchema.index(
  { processedAt: 1, nextAttemptAt: 1, occurredAt: 1 },
  { name: 'event_outbox_pending_idx' }
);
EventOutboxSchema.index(
  { entityType: 1, entityId: 1, occurredAt: -1 },
  { name: 'event_outbox_entity_idx' }
);

module.exports = mongoose.model('EventOutbox', EventOutboxSchema);
