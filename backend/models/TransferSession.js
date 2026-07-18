const mongoose = require('mongoose');

const TransferSessionSchema = new mongoose.Schema({
  transferId: { type: String, required: true, unique: true },
  idempotencyKey: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  mediaNode: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaNode' },
  mediaAsset: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
  direction: { type: String, enum: ['upload', 'download'], required: true },
  kind: { type: String, required: true },
  entityType: { type: String, enum: ['video', 'edit_job', 'show_day', 'off_audio'], required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  status: {
    type: String,
    enum: ['queued', 'preparing', 'transferring', 'paused', 'verifying', 'completed', 'failed', 'cancelled'],
    default: 'queued',
  },
  filename: { type: String, default: '' },
  totalBytes: { type: Number, min: 0, default: 0 },
  transferredBytes: { type: Number, min: 0, default: 0 },
  sha256: { type: String, default: '' },
  etag: { type: String, default: '' },
  resumableUrl: { type: String, default: '' },
  ticketExpiresAt: { type: Date, default: null },
  error: { type: String, default: '' },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

TransferSessionSchema.index(
  { user: 1, idempotencyKey: 1 },
  { name: 'transfer_user_idempotency_unique_idx', unique: true }
);
TransferSessionSchema.index({ user: 1, status: 1, updatedAt: -1 }, { name: 'transfer_user_status_idx' });
TransferSessionSchema.index({ expiresAt: 1 }, { name: 'transfer_expiry_ttl_idx', expireAfterSeconds: 0 });

module.exports = mongoose.model('TransferSession', TransferSessionSchema);
