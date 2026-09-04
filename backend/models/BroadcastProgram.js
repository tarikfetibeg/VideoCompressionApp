const mongoose = require('mongoose');

const BroadcastProgramSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, trim: true, lowercase: true, default: undefined },
  programType: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramType', default: null },
  description: { type: String },
  defaultTime: { type: String },
  daysOfWeek: [{ type: Number, min: 0, max: 6 }],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

BroadcastProgramSchema.index(
  { slug: 1 },
  { name: 'broadcast_program_slug_unique_idx', unique: true, sparse: true }
);
BroadcastProgramSchema.index({ programType: 1, active: 1, name: 1 }, { name: 'broadcast_program_type_active_idx' });

BroadcastProgramSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('BroadcastProgram', BroadcastProgramSchema);
