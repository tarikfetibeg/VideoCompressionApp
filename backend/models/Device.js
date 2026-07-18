const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  hostname: { type: String, required: true },
  platform: { type: String, default: 'windows' },
  platformVersion: { type: String, default: '' },
  appVersion: { type: String, default: '2.0.0' },
  updateChannel: { type: String, enum: ['pilot', 'stable'], default: 'stable' },
  notificationPermission: {
    type: String,
    enum: ['unknown', 'granted', 'denied'],
    default: 'unknown',
  },
  edgeLatencyMs: { type: Number, min: 0, default: null },
  site: { type: String, default: 'primary' },
  lastSeenAt: { type: Date, default: Date.now },
  revokedAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

DeviceSchema.index({ user: 1, lastSeenAt: -1 }, { name: 'device_user_seen_idx' });
DeviceSchema.index({ lastSeenAt: -1, revokedAt: 1 }, { name: 'device_fleet_status_idx' });
DeviceSchema.index({ appVersion: 1, updateChannel: 1 }, { name: 'device_version_channel_idx' });

module.exports = mongoose.model('Device', DeviceSchema);
