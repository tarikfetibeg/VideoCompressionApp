const mongoose = require('mongoose');
const { buildVideoSearchPrefixes, buildVideoSearchText } = require('../utils/searchText');

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
  timestamp: { type: Number, min: 0, default: 0 },
  correctionRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'CorrectionRequest' },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reportedAt: { type: Date, default: Date.now },
  showDay: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowDay' },
  showDayItem: { type: mongoose.Schema.Types.ObjectId },
});

const ScrubPreviewSchema = new mongoose.Schema({
  folderPath: { type: String },
  frameCount: { type: Number },
  frameWidth: { type: Number },
  frameHeight: { type: Number },
  duration: { type: Number },
  createdAt: { type: Date },
  version: { type: String },
  profileVersion: { type: Number },
  jpegQuality: { type: Number },
  error: { type: String },
}, { _id: false });

const Mp4PreviewMetadataSchema = new mongoose.Schema({
  profileVersion: { type: Number },
  encoderRequested: { type: String },
  encoderUsed: { type: String },
  encoderPreset: { type: String },
  cpuFallbackUsed: { type: Boolean, default: false },
  fallbackReason: { type: String },
  width: { type: Number },
  height: { type: Number },
  videoBitrate: { type: Number },
  audioBitrate: { type: Number },
  framerate: { type: Number },
  size: { type: Number },
  processingMs: { type: Number },
  createdAt: { type: Date },
  error: { type: String },
}, { _id: false });

const ThumbnailMetadataSchema = new mongoose.Schema({
  profileVersion: { type: Number },
  width: { type: Number },
  height: { type: Number },
  jpegQuality: { type: Number },
  size: { type: Number },
  createdAt: { type: Date },
  error: { type: String },
}, { _id: false });

const PreviewMaintenanceSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['idle', 'queued', 'processing', 'failed'],
    default: 'idle',
  },
  assetTypes: [{ type: String, enum: ['mp4', 'thumbnail', 'scrub'] }],
  error: { type: String },
  startedAt: { type: Date },
  completedAt: { type: Date },
}, { _id: false });

const HlsRenditionSchema = new mongoose.Schema({
  name: { type: String },
  width: { type: Number },
  height: { type: Number },
  bitrate: { type: Number },
  playlist: { type: String },
}, { _id: false });

const HlsPreviewSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['missing', 'queued', 'processing', 'ready', 'failed'],
    default: 'missing',
  },
  buildStatus: {
    type: String,
    enum: ['idle', 'queued', 'processing', 'failed'],
    default: 'idle',
  },
  folderPath: { type: String },
  masterPlaylist: { type: String },
  renditions: [HlsRenditionSchema],
  segmentDuration: { type: Number },
  size: { type: Number },
  createdAt: { type: Date },
  version: { type: String },
  profileVersion: { type: Number },
  error: { type: String },
  encoderRequested: { type: String },
  encoderUsed: { type: String },
  encoderPreset: { type: String },
  cpuFallbackUsed: { type: Boolean, default: false },
  fallbackReason: { type: String },
  processingMs: { type: Number },
  lastBuildError: { type: String },
  lastBuildFailedAt: { type: Date },
}, { _id: false });

const PlaybackCompatibilitySchema = new mongoose.Schema({
  compatible: { type: Boolean, default: false },
  checkedAt: { type: Date },
  pathType: { type: String, enum: ['preview', 'compressed', 'filepath', 'none'], default: 'none' },
  container: { type: String },
  videoCodec: { type: String },
  pixelFormat: { type: String },
  audioCodec: { type: String },
  reason: { type: String },
}, { _id: false });

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
  activeCorrectionRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'CorrectionRequest' },
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
  mp4Preview: Mp4PreviewMetadataSchema,
  thumbnail: ThumbnailMetadataSchema,
  previewMaintenance: PreviewMaintenanceSchema,
  scrubPreview: ScrubPreviewSchema,
  hlsPreview: HlsPreviewSchema,
  playbackCompatibility: PlaybackCompatibilitySchema,

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

  searchText: { type: String, default: '', select: false },
  searchPrefixes: { type: [String], default: undefined, select: false },

  uploadDate: { type: Date, default: Date.now },
});

VideoSchema.pre('save', function updateSearchText(next) {
  this.searchText = buildVideoSearchText(this);
  this.searchPrefixes = buildVideoSearchPrefixes(this);
  next();
});

VideoSchema.index({ searchText: 'text' }, {
  name: 'video_search_text_idx',
  default_language: 'none',
});
VideoSchema.index({ searchPrefixes: 1 }, { name: 'video_search_prefixes_idx' });
VideoSchema.index({ uploadDate: -1 }, { name: 'video_upload_date_idx' });
VideoSchema.index({ processingStatus: 1, uploadDate: -1 }, { name: 'video_processing_upload_idx' });
VideoSchema.index({ status: 1, processingStatus: 1, uploadDate: -1 }, { name: 'video_status_processing_upload_idx' });
VideoSchema.index({ uploader: 1, uploadDate: -1 }, { name: 'video_uploader_upload_idx' });
VideoSchema.index({ status: 1, processingStatus: 1, broadcastStatus: 1, uploadDate: -1 }, { name: 'video_broadcast_workspace_idx' });
VideoSchema.index({ status: 1, processingStatus: 1, archiveReviewStatus: 1, uploadDate: -1 }, { name: 'video_archive_review_idx' });
VideoSchema.index({ contentType: 1, status: 1, processingStatus: 1, broadcastStatus: 1, uploadDate: -1 }, { name: 'video_content_type_library_idx' });
VideoSchema.index({ sourceJob: 1, uploadDate: -1 }, { name: 'video_source_job_idx', sparse: true });
VideoSchema.index({ program: 1, airDate: 1, uploadDate: -1 }, { name: 'video_program_air_date_idx', sparse: true });
VideoSchema.index({ tagDate: -1, uploadDate: -1 }, { name: 'video_tag_date_idx' });
VideoSchema.index(
  { correctionStatus: 1, activeCorrectionRequest: 1, correctionReportedAt: -1 },
  { name: 'video_correction_active_reported_idx' }
);

module.exports = mongoose.model('Video', VideoSchema);
