const mongoose = require('mongoose');

const MediaNodeSchema = new mongoose.Schema({
  nodeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  site: { type: String, default: 'primary' },
  kind: { type: String, enum: ['edge', 'cloud_proxy'], default: 'edge' },
  baseUrl: { type: String, required: true },
  lanCidrs: [{ type: String }],
  status: { type: String, enum: ['online', 'degraded', 'offline', 'maintenance'], default: 'offline' },
  capabilities: {
    nvenc: { type: Boolean, default: false },
    hls: { type: Boolean, default: true },
    resumableUploads: { type: Boolean, default: true },
    codecs: [{ type: String }],
  },
  storage: {
    root: { type: String, select: false },
    totalBytes: { type: Number, default: 0 },
    freeBytes: { type: Number, default: 0 },
  },
  lastSeenAt: { type: Date, default: null },
  registrationHash: { type: String, select: false },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

MediaNodeSchema.index({ site: 1, status: 1, lastSeenAt: -1 }, { name: 'media_node_site_status_idx' });

module.exports = mongoose.model('MediaNode', MediaNodeSchema);
