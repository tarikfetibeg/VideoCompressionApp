const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device' },
  tokenHash: { type: String, required: true, unique: true },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: Date.now },
  rotatedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokeReason: { type: String, default: '' },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  createdByIp: { type: String, default: '' },
  userAgent: { type: String, default: '' },
}, { timestamps: true });

SessionSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 }, { name: 'session_user_active_idx' });
SessionSchema.index({ device: 1, revokedAt: 1 }, { name: 'session_device_active_idx', sparse: true });
SessionSchema.index({ expiresAt: 1 }, { name: 'session_expiry_ttl_idx', expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);
