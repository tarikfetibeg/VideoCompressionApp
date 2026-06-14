const mongoose = require('mongoose');

const FeedbackCommentSchema = new mongoose.Schema({
  body: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const FeedbackSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  type: {
    type: String,
    enum: ['bug', 'suggestion', 'workflow_issue', 'urgent_production_issue'],
    default: 'suggestion',
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal',
  },
  status: {
    type: String,
    enum: ['new', 'reviewing', 'planned', 'fixed', 'rejected'],
    default: 'new',
  },
  area: {
    type: String,
    enum: ['reporter', 'editor', 'producer', 'realizator', 'admin', 'login', 'processing', 'archive', 'other'],
    default: 'other',
  },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  submittedByRole: { type: String },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  adminSeenAt: { type: Date },
  adminSeenBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  adminComment: { type: String },
  adminResponse: { type: String },
  adminResponseAt: { type: Date },
  adminResponseBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pageUrl: { type: String },
  userAgent: { type: String },
  comments: [FeedbackCommentSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

FeedbackSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Feedback', FeedbackSchema);
