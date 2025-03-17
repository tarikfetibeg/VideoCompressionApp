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
  // New tagging fields:
  event: { type: String },
  location: { type: String },
  tagDate: { type: Date },
  status: { // "raw" or "edited"
    type: String,
    enum: ['raw', 'edited'],
    default: 'raw',
  },
  timecodes: [TimecodeSchema],
  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', VideoSchema);
