const mongoose = require('mongoose');

const BroadcastProgramSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  description: { type: String },
  defaultTime: { type: String },
  daysOfWeek: [{ type: Number, min: 0, max: 6 }],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

BroadcastProgramSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('BroadcastProgram', BroadcastProgramSchema);
