const mongoose = require('mongoose');

const EscalationPolicySchema = new mongoose.Schema({
  eventType: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: true },
  repeatAfterSeconds: { type: Number, min: 30, default: 90 },
  acknowledgeAfterSeconds: { type: Number, min: 60, default: 180 },
  escalationRoles: [{
    type: String,
    enum: ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin'],
  }],
  maxEscalationLevel: { type: Number, min: 1, max: 5, default: 2 },
}, { timestamps: true });

module.exports = mongoose.model('EscalationPolicy', EscalationPolicySchema);
