const mongoose = require('mongoose');

const ProductionPersonSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  normalizedName: { type: String, required: true, trim: true, lowercase: true },
  aliases: [{ type: String, trim: true }],
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  active: { type: Boolean, default: true },
}, { timestamps: true });

ProductionPersonSchema.index(
  { normalizedName: 1 },
  { name: 'production_person_normalized_unique_idx', unique: true }
);
ProductionPersonSchema.index({ active: 1, name: 1 }, { name: 'production_person_active_name_idx' });
ProductionPersonSchema.index({ aliases: 1 }, { name: 'production_person_aliases_idx' });

module.exports = mongoose.model('ProductionPerson', ProductionPersonSchema);
