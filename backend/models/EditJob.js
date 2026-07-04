const mongoose = require('mongoose');
const { buildEditJobSearchText } = require('../utils/searchText');

const JobSegmentSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  order: { type: Number, default: 0 },
  title: { type: String },
  notes: { type: String },
  type: {
    type: String,
    enum: [
      'sot',
      'broll',
      'standup',
      'nat_sound',
      'cutaway',
      'graphic',
      'lower_third',
      'do_not_use',
      'other',
    ],
    default: 'other',
  },
  startTime: { type: Number, default: 0 },
  endTime: { type: Number },
  sourceInMarker: { type: String },
  sourceOutMarker: { type: String },
  required: { type: Boolean, default: true },
});

const JobCommentSchema = new mongoose.Schema({
  body: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now },
});

const OffAudioSchema = new mongoose.Schema({
  originalName: { type: String, required: true },
  filename: { type: String, required: true },
  storagePath: { type: String, required: true },
  mimetype: { type: String },
  size: { type: Number },
  uploadedAt: { type: Date, default: Date.now },
});

const JobChangeSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'job_created',
      'brief_updated',
      'segments_added',
      'segment_removed',
      'segment_replaced',
      'off_added',
      'reporter_note_added',
      'comment_added',
      'final_uploaded',
      'final_approved',
      'final_rejected',
      'status_updated',
    ],
    required: true,
  },
  summary: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorRole: { type: String },
  recipientUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

const JobViewerStateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastViewedAt: { type: Date, default: Date.now },
});

const JobDownloadStateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  downloadedSegmentIds: [{ type: mongoose.Schema.Types.ObjectId }],
  downloadedOffFileIds: [{ type: mongoose.Schema.Types.ObjectId }],
  lastDownloadedAt: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 },
});

const EditJobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  scriptText: { type: String },
  offFiles: [OffAudioSchema],
  program: { type: String },
  contentType: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastContentType' },
  deadline: { type: Date },
  expiresAt: { type: Date },
  workspaceState: {
    type: String,
    enum: ['active', 'expired', 'closed', 'cancelled'],
    default: 'active',
  },
  workspaceStateChangedAt: { type: Date },
  workspaceStateChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  workspaceStateReason: { type: String },
  slaAppliedAt: { type: Date },
  jobKind: {
    type: String,
    enum: ['standard', 'correction'],
    default: 'standard',
  },
  parentJob: { type: mongoose.Schema.Types.ObjectId, ref: 'EditJob' },
  sourceVideo: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
  correctionRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'CorrectionRequest' },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  status: {
    type: String,
    enum: [
      'draft',
      'submitted',
      'claimed',
      'in_edit',
      'needs_info',
      'ready_for_qc',
      'approved',
      'aired',
      'archived',
    ],
    default: 'submitted',
  },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedEditor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  segments: [JobSegmentSchema],
  comments: [JobCommentSchema],
  changeLog: [JobChangeSchema],
  lastReporterChangeAt: { type: Date },
  viewerStates: [JobViewerStateSchema],
  downloadStates: [JobDownloadStateSchema],
  searchText: { type: String, default: '', select: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

EditJobSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  this.searchText = buildEditJobSearchText(this);
  next();
});

EditJobSchema.index({ searchText: 'text' }, {
  name: 'edit_job_search_text_idx',
  default_language: 'none',
});
EditJobSchema.index({ status: 1, updatedAt: -1 }, { name: 'edit_job_status_updated_idx' });
EditJobSchema.index({ assignedEditor: 1, status: 1, updatedAt: -1 }, { name: 'edit_job_editor_status_updated_idx', sparse: true });
EditJobSchema.index({ reporter: 1, status: 1, updatedAt: -1 }, { name: 'edit_job_reporter_status_updated_idx' });
EditJobSchema.index({ priority: 1, updatedAt: -1 }, { name: 'edit_job_priority_updated_idx' });
EditJobSchema.index({ deadline: 1, updatedAt: -1 }, { name: 'edit_job_deadline_updated_idx', sparse: true });
EditJobSchema.index({ workspaceState: 1, expiresAt: 1, status: 1 }, { name: 'edit_job_workspace_expiry_idx' });
EditJobSchema.index({ contentType: 1, workspaceState: 1, updatedAt: -1 }, { name: 'edit_job_content_type_workspace_idx', sparse: true });
EditJobSchema.index({ jobKind: 1, workspaceState: 1, updatedAt: -1 }, { name: 'edit_job_kind_workspace_idx' });
EditJobSchema.index({ correctionRequest: 1 }, { name: 'edit_job_correction_request_idx', sparse: true });

module.exports = mongoose.model('EditJob', EditJobSchema);
