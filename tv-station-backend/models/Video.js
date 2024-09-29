const mongoose = require('mongoose');

const TimecodeSchema = new mongoose.Schema({
  description: String,
  timestamp: Number, // Time in seconds
});

const VideoSchema = new mongoose.Schema({
  filename: String,
  filepath: String,
  originalFilename: String,
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  events: [String],
  timecodes: [TimecodeSchema],
  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', VideoSchema);
