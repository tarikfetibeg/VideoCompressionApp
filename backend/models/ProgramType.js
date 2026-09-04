const mongoose = require('mongoose');

const ProgramTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  description: { type: String, default: '', trim: true },
  recommendedRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductionRole' }],
  active: { type: Boolean, default: true },
}, { timestamps: true });

ProgramTypeSchema.index({ active: 1, name: 1 }, { name: 'program_type_active_name_idx' });

module.exports = mongoose.model('ProgramType', ProgramTypeSchema);
