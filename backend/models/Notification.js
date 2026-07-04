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
    required: true,
  },
  kind: {
    type: String,
    enum: ['edit_job_comment'],
    required: true,
  },
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EditJob',
    required: true,
  },
  commentId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
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
  { name: 'notification_recipient_comment_unique_idx', unique: true }
);
NotificationSchema.index(
  { expiresAt: 1 },
  { name: 'notification_expiry_ttl_idx', expireAfterSeconds: 0 }
);

module.exports = mongoose.model('Notification', NotificationSchema);
