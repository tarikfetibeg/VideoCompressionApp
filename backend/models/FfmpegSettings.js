const mongoose = require('mongoose');

const FfmpegSettingsSchema = new mongoose.Schema({
  codec: { type: String, default: 'libx264' },
  resolution: { type: String, default: '1920x1080' },
  bitrate: { type: Number, default: 1500 }, // in Kbps
  framerate: { type: Number, default: 30 },

  // 0 = raw file is deleted immediately after successful processing.
  // 1-365 = raw file is kept for the defined number of days.
  rawRetentionDays: {
    type: Number,
    default: 0,
    min: 0,
    max: 365,
  },
});

module.exports = mongoose.model('FfmpegSettings', FfmpegSettingsSchema);