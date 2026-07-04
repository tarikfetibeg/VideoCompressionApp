const mongoose = require('mongoose');

const MediaTicketSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true, index: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date },
  useCount: { type: Number, default: 0 },
}, {
  timestamps: true,
});

MediaTicketSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'media_ticket_expiry_idx' }
);

module.exports = mongoose.model('MediaTicket', MediaTicketSchema);
