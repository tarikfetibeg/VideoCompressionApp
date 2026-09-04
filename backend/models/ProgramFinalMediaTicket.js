const mongoose = require('mongoose');

const ProgramFinalMediaTicketSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  programFinal: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinal', required: true },
  version: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinalVersion', required: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date, default: null },
  useCount: { type: Number, min: 0, default: 0 },
}, { timestamps: true });

ProgramFinalMediaTicketSchema.index({ tokenHash: 1 }, { name: 'program_final_ticket_token_idx', unique: true });
ProgramFinalMediaTicketSchema.index(
  { expiresAt: 1 },
  { name: 'program_final_ticket_expiry_idx', expireAfterSeconds: 0 }
);

module.exports = mongoose.model('ProgramFinalMediaTicket', ProgramFinalMediaTicketSchema);
