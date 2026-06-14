const mongoose = require('mongoose');

const TimecodeSchema = new mongoose.Schema({
  description: String,
  timestamp: Number, // Time in seconds
  type: {
    type: String,
    enum: ['marker', 'cut', 'in', 'out', 'note'],
    default: 'marker',
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

const CorrectionReportSchema = new mongoose.Schema({
  note: { type: String },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reportedAt: { type: Date, default: Date.now },
  showDay: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowDay' },
  showDayItem: { type: mongoose.Schema.Types.ObjectId },
});

const VideoSchema = new mongoose.Schema({
  filename: String,
  filepath: String,
  originalFilename: String,

  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  editor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

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
  approvalNotes: { type: String },
  qaResponsible: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  qaResponsibilityType: {
    type: String,
    enum: ['job_reporter', 'direct_editor', 'producer_override', 'admin_override'],
  },
  correctionStatus: {
    type: String,
    enum: ['none', 'needs_correction', 'resolved'],
    default: 'none',
  },
  correctionNote: { type: String },
  correctionReportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctionReportedAt: { type: Date },
  correctionResolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctionResolvedAt: { type: Date },
  correctionResolvedNote: { type: String },
  correctionReports: [CorrectionReportSchema],
  airedAt: { type: Date },
  archivedAt: { type: Date },

  archiveReviewStatus: {
    type: String,
    enum: ['unreviewed', 'reviewed', 'needs_metadata', 'duplicate'],
    default: 'unreviewed',
  },
  archiveReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archiveReviewedAt: { type: Date },
  archiveReviewNotes: { type: String },
  archiveTagsUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archiveTagsUpdatedAt: { type: Date },
  duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },

  rawPath: { type: String },
  compressedPath: { type: String },
  previewPath: { type: String },
  thumbnailPath: { type: String },

  codec: { type: String },
  resolution: { type: String },
  bitrate: { type: Number },
  framerate: { type: Number },

  sourceFormat: { type: String },
  sourceCodec: { type: String },
  sourceResolution: { type: String },
  sourceBitrate: { type: Number },
  sourceFramerate: { type: Number },
  sourceDuration: { type: Number },
  sourceAudioCodec: { type: String },
  sourceAudioChannels: { type: Number },
  sourceAudioSampleRate: { type: Number },

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
  sourceJob: { type: mongoose.Schema.Types.ObjectId, ref: 'EditJob' },
  program: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastProgram' },
  contentType: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastContentType' },
  airDate: { type: Date },
  finalTitle: { type: String },
  finalApprovalStatus: {
    type: String,
    enum: ['not_required', 'pending', 'approved', 'rejected'],
    default: 'not_required',
  },
  finalApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  finalApprovedAt: { type: Date },
  finalApprovalRole: { type: String },
  finalApprovalNotes: { type: String },

  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', VideoSchema);
