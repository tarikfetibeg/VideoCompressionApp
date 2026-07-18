const mongoose = require('mongoose');

const MediaAssetSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  node: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaNode', required: true },
  kind: {
    type: String,
    enum: ['raw', 'master', 'final', 'mp4_preview', 'hls', 'thumbnail', 'scrub', 'off_audio'],
    required: true,
  },
  relativePath: { type: String, required: true },
  storageClass: { type: String, enum: ['local', 'cloud_proxy'], default: 'local' },
  status: { type: String, enum: ['available', 'syncing', 'missing', 'failed'], default: 'available' },
  size: { type: Number, min: 0, default: 0 },
  sha256: { type: String, default: '' },
  version: { type: Number, min: 1, default: 1 },
  profileVersion: { type: Number, min: 1, default: null },
  verifiedAt: { type: Date, default: null },
  lastAccessedAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

MediaAssetSchema.index(
  { video: 1, kind: 1, node: 1, version: -1 },
  { name: 'media_asset_video_kind_node_idx' }
);
MediaAssetSchema.index(
  { node: 1, status: 1, kind: 1 },
  { name: 'media_asset_node_status_idx' }
);

module.exports = mongoose.model('MediaAsset', MediaAssetSchema);
