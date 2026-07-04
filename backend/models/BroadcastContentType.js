const mongoose = require('mongoose');

const BroadcastContentTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, required: true, trim: true, unique: true },
  description: { type: String },
  active: { type: Boolean, default: true },
  autoExpireJobs: { type: Boolean, default: true },
  jobSlaHours: { type: Number, min: 1, max: 720, default: 72 },
  jobGraceHours: { type: Number, min: 0, max: 168, default: 4 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

BroadcastContentTypeSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('BroadcastContentType', BroadcastContentTypeSchema);
