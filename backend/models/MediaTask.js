const mongoose = require('mongoose');

const MediaTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  node: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaNode', required: true },
  kind: {
    type: String,
    enum: ['video_processing', 'hls_build', 'preview_rebuild', 'proxy_sync', 'checksum'],
    required: true,
  },
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: {
    type: String,
    enum: ['queued', 'claimed', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'queued',
  },
  claimedAt: { type: Date, default: null },
  leaseExpiresAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  error: { type: String, default: '' },
  result: { type: mongoose.Schema.Types.Mixed, default: {} },
  attempts: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

MediaTaskSchema.index({ node: 1, status: 1, createdAt: 1 }, { name: 'media_task_node_queue_idx' });
MediaTaskSchema.index({ leaseExpiresAt: 1, status: 1 }, { name: 'media_task_lease_idx' });

module.exports = mongoose.model('MediaTask', MediaTaskSchema);
