const mongoose = require('mongoose');

const ShowDayItemSchema = new mongoose.Schema({
  video: { type: mongoose.Schema.Types.ObjectId, ref: 'Video', required: true },
  contentType: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastContentType' },
  title: { type: String },
  order: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['scheduled', 'ready', 'aired', 'removed'],
    default: 'scheduled',
  },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  addedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const ShowDayActivitySchema = new mongoose.Schema({
  action: { type: String, required: true },
  summary: { type: String, required: true },
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  details: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

const ShowDayDownloadStateSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastDownloadedAt: { type: Date, default: Date.now },
  downloadCount: { type: Number, default: 0 },
});

const ShowDaySchema = new mongoose.Schema({
  program: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastProgram', required: true },
  airDate: { type: Date, required: true },
  producers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  airedAt: { type: Date },
  airedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  archiveConfirmedAt: { type: Date },
  archiveConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [ShowDayItemSchema],
  activityLog: [ShowDayActivitySchema],
  downloadStates: [ShowDayDownloadStateSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

ShowDaySchema.index({ program: 1, airDate: 1 }, { unique: true });

ShowDaySchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ShowDay', ShowDaySchema);
