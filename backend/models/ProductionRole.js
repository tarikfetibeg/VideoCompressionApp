const mongoose = require('mongoose');

const ProductionRoleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
  group: {
    type: String,
    enum: ['editorial', 'studio', 'technical', 'postproduction', 'other'],
    default: 'other',
  },
  order: { type: Number, min: 0, default: 100 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

ProductionRoleSchema.index({ active: 1, order: 1, name: 1 }, { name: 'production_role_active_order_idx' });

module.exports = mongoose.model('ProductionRole', ProductionRoleSchema);
