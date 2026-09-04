const mongoose = require('mongoose');

const CorrectionIssueSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['picture', 'audio', 'edit', 'graphics', 'wrong_version', 'technical', 'other'],
    default: 'other',
  },
  severity: {
    type: String,
    enum: ['minor', 'major', 'blocking'],
    default: 'major',
  },
  startSeconds: { type: Number, min: 0, default: 0 },
  endSeconds: { type: Number, min: 0 },
  note: { type: String, required: true, trim: true, maxlength: 1000 },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedAt: { type: Date, default: Date.now },
}, { _id: true });

const CorrectionRequestSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
  showDay: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowDay', index: true },
  showDayItem: { type: mongoose.Schema.Types.ObjectId },
  origin: {
    type: String,
    enum: ['realization', 'archive', 'video_status', 'admin'],
    default: 'realization',
    index: true,
  },
  sourceJob: { type: mongoose.Schema.Types.ObjectId, ref: 'EditJob' },
  correctionJob: { type: mongoose.Schema.Types.ObjectId, ref: 'EditJob' },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  assignedEditor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  note: { type: String, required: true, trim: true },
  timestamp: { type: Number, min: 0, default: 0 },
  issues: { type: [CorrectionIssueSchema], default: undefined },
  highestSeverity: {
    type: String,
    enum: ['minor', 'major', 'blocking'],
    default: 'major',
  },
  status: {
    type: String,
    enum: ['reported', 'assigned', 'in_edit', 'ready_for_review', 'resolved', 'dismissed'],
    default: 'reported',
    index: true,
  },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date },
  resolutionNote: { type: String },
  correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  correctedAt: { type: Date },
  correctedVideo: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, {
  timestamps: true,
});

CorrectionRequestSchema.index(
  { showDay: 1, showDayItem: 1, status: 1, updatedAt: -1 },
  { name: 'correction_show_item_status_idx' }
);
CorrectionRequestSchema.index(
  { assignedEditor: 1, status: 1, updatedAt: -1 },
  { name: 'correction_editor_status_idx', sparse: true }
);
CorrectionRequestSchema.index(
  { status: 1, updatedAt: -1 },
  { name: 'correction_status_updated_idx' }
);
CorrectionRequestSchema.index(
  { video: 1, status: 1, updatedAt: -1 },
  { name: 'correction_video_status_updated_idx' }
);
CorrectionRequestSchema.index(
  { status: 1, highestSeverity: 1, updatedAt: -1 },
  { name: 'correction_status_severity_idx' }
);

module.exports = mongoose.model('CorrectionRequest', CorrectionRequestSchema);
