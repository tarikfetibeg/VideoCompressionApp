const mongoose = require('mongoose');

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
      'off_added',
      'reporter_note_added',
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
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

const JobViewerStateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastViewedAt: { type: Date, default: Date.now },
});

const EditJobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  scriptText: { type: String },
  offFiles: [OffAudioSchema],
  program: { type: String },
  deadline: { type: Date },
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
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

EditJobSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('EditJob', EditJobSchema);
