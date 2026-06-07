const mongoose = require('mongoose');

const TimecodeSchema = new mongoose.Schema({
  description: String,
  timestamp: Number, // Vrijeme u sekundama
});

const VideoSchema = new mongoose.Schema({
  filename: String,
  filepath: String,
  originalFilename: String,
  uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  event: { type: String },      //kategorija događaja
  location: { type: String },   //kategorija lokacija
  tagDate: { type: Date },      //datum
  status: {
    type: String,
    enum: ['raw', 'edited'],  //Kategorisanje video materijala kao sirovi materijal ili editovani
    default: 'raw',
  },
  isBroll: { type: Boolean, default: false },  // Kategorija za tagovanje inserata
  keywords: [{ type: String }],               // Kategorija za "keywords"
  timecodes: [TimecodeSchema],                // tag nije implementiran
  uploadDate: { type: Date, default: Date.now },
});

module.exports = mongoose.model('Video', VideoSchema);
