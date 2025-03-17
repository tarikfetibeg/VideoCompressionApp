const mongoose = require('mongoose');

const FfmpegSettingsSchema = new mongoose.Schema({
  codec: { type: String, default: 'libx264' },
  resolution: { type: String, default: '1920x1080' },
  bitrate: { type: Number, default: 1500 }, // in Kbps
  framerate: { type: Number, default: 30 }
});

module.exports = mongoose.model('FfmpegSettings', FfmpegSettingsSchema);
