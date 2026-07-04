const mongoose = require('mongoose');

const allowedKinds = [
  'video-single',
  'video-bulk',
  'edit-package',
  'edit-off-file',
  'air-package',
];

const allowedStatuses = [
  'created',
  'started',
  'completed',
  'aborted',
  'failed',
  'expired',
];

const DownloadTicketSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: allowedKinds, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: allowedStatuses, default: 'created', index: true },
  expiresAt: { type: Date, required: true },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  error: { type: String },
  useCount: { type: Number, default: 0 },
  lastUsedAt: { type: Date },
}, {
  timestamps: true,
});

DownloadTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'download_ticket_expiry_idx' });
DownloadTicketSchema.index({ createdBy: 1, status: 1, createdAt: -1 }, { name: 'download_ticket_user_status_idx' });

module.exports = mongoose.model('DownloadTicket', DownloadTicketSchema);
