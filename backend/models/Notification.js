const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({
  recipient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  actor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  kind: {
    type: String,
    required: true,
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EditJob',
    default: null,
  },
  commentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  sourceEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'EventOutbox' },
  severity: {
    type: String,
    enum: ['info', 'action_required', 'critical'],
    default: 'info',
  },
  state: {
    type: String,
    enum: ['unread', 'read', 'acknowledged', 'resolved'],
    default: 'unread',
  },
  entityType: {
    type: String,
    enum: ['edit_job', 'video', 'show_day', 'correction', 'transfer', 'system'],
    default: 'system',
  },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  deepLink: { type: String, default: '' },
  actionRequired: { type: Boolean, default: false },
  dedupeKey: { type: String },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  title: {
    type: String,
    required: true,
  },
  bodyPreview: {
    type: String,
    default: '',
  },
  readAt: {
    type: Date,
    default: null,
  },
  acknowledgedAt: { type: Date, default: null },
  acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  ackDeadlineAt: { type: Date, default: null },
  escalationLevel: { type: Number, min: 0, default: 0 },
  escalatedAt: { type: Date, default: null },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
});

NotificationSchema.index(
  { recipient: 1, readAt: 1, createdAt: -1 },
  { name: 'notification_recipient_read_created_idx' }
);
NotificationSchema.index(
  { recipient: 1, job: 1, readAt: 1 },
  { name: 'notification_recipient_job_read_idx' }
);
NotificationSchema.index(
  { recipient: 1, commentId: 1 },
  {
    name: 'notification_recipient_comment_unique_idx',
    unique: true,
    partialFilterExpression: { commentId: { $type: 'objectId' } },
  }
);
NotificationSchema.index(
  { recipient: 1, dedupeKey: 1 },
  {
    name: 'notification_recipient_dedupe_unique_idx',
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: 'string' } },
  }
);
NotificationSchema.index(
  { severity: 1, state: 1, ackDeadlineAt: 1 },
  { name: 'notification_escalation_idx' }
);
NotificationSchema.index(
  { expiresAt: 1 },
  { name: 'notification_expiry_ttl_idx', expireAfterSeconds: 0 }
);

module.exports = mongoose.model('Notification', NotificationSchema);
