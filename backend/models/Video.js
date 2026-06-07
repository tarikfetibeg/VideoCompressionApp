const mongoose = require('mongoose');

const TimecodeSchema = new mongoose.Schema({
  description: String,
  timestamp: Number, // Time in seconds
});

const VideoSchema = new mongoose.Schema({
  filename: String,
  filepath: String,
  originalFilename: String,

  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  event: { type: String },
  location: { type: String },
  tagDate: { type: Date },

  status: {
    type: String,
    enum: ['raw', 'edited'],
    default: 'raw',
  },

  processingStatus: {
    type: String,
    enum: ['uploaded', 'queued', 'processing', 'completed', 'failed'],
    default: 'completed',
  },

  processingMode: {
    type: String,
    enum: ['transcode', 'finalize'],
    default: 'transcode',
  },
  processingJobId: { type: String },
  processingProgress: { type: Number, default: 0 },
  processingStartedAt: { type: Date },
  processingCompletedAt: { type: Date },
  processingError: { type: String },

  qcStatus: {
    type: String,
    enum: ['pending', 'passed', 'failed'],
    default: 'pending',
  },
  qcNotes: { type: String },
  qcCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  qcCheckedAt: { type: Date },

  broadcastStatus: {
    type: String,
    enum: [
      'not_ready',
      'qc_pending',
      'qc_failed',
      'ready_for_approval',
      'approved_for_air',
      'aired',
      'archived',
    ],
    default: 'not_ready',
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: { type: Date },
  airedAt: { type: Date },
  archivedAt: { type: Date },

  rawPath: { type: String },
  compressedPath: { type: String },
  previewPath: { type: String },
  thumbnailPath: { type: String },

  codec: { type: String },
  resolution: { type: String },
  bitrate: { type: Number },
  framerate: { type: Number },

  sizeOriginal: { type: Number },
  sizeCompressed: { type: Number },
  sizePreview: { type: Number },
  sizeThumbnail: { type: Number },

  duration: { type: Number },

  rawRetentionDays: { type: Number, default: 0 },
  rawExpiresAt: { type: Date },
  rawDeleted: { type: Boolean, default: false },
  rawDeletedAt: { type: Date },

  isBroll: { type: Boolean, default: false },
  keywords: [{ type: String }],
  timecodes: [TimecodeSchema],

  finalCategory: { type: String },

  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', VideoSchema);
