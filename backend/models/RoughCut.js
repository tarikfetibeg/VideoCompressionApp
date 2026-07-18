const mongoose = require('mongoose');

const RoughCutItemSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  inMs: { type: Number, min: 0, required: true },
  outMs: { type: Number, min: 1, required: true },
  order: { type: Number, min: 0, required: true },
  note: { type: String, maxlength: 1000, default: '' },
}, { _id: true });

const RoughCutSchema = new mongoose.Schema({
  job: { type: mongoose.Schema.Types.ObjectId, ref: 'EditJob', required: true },
  version: { type: Number, min: 1, required: true },
  status: {
    type: String,
    enum: ['draft', 'submitted', 'locked', 'superseded'],
    default: 'draft',
  },
  items: [RoughCutItemSchema],
  durationMs: { type: Number, min: 0, default: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedAt: { type: Date, default: null },
  lockedAt: { type: Date, default: null },
}, { timestamps: true });

RoughCutSchema.index({ job: 1, version: -1 }, { name: 'rough_cut_job_version_unique_idx', unique: true });
RoughCutSchema.index({ job: 1, status: 1, updatedAt: -1 }, { name: 'rough_cut_job_status_idx' });

module.exports = mongoose.model('RoughCut', RoughCutSchema);
