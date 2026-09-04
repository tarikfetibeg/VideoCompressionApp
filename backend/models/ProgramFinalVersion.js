const mongoose = require('mongoose');

const ProgramFinalVersionSchema = new mongoose.Schema({
  programFinal: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinal', required: true },
  versionNumber: { type: Number, min: 1, required: true },
  originalFilename: { type: String, required: true, trim: true },
  masterRelativePath: { type: String, required: true, trim: true },
  mediaNode: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaNode', default: null },
  size: { type: Number, min: 0, default: 0 },
  sha256: { type: String, required: true, lowercase: true },
  sharedFromVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinalVersion', default: null },
  codecMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  ingestSource: {
    type: String,
    enum: ['resumable_upload', 'watched_folder', 'admin_import'],
    required: true,
  },
  sourceCandidate: { type: mongoose.Schema.Types.ObjectId, ref: 'FinalIngestCandidate', default: null },
  status: {
    type: String,
    enum: ['processing', 'ready', 'active', 'superseded', 'failed', 'quarantined', 'purged'],
    default: 'processing',
  },
  replacementReason: { type: String, default: '', trim: true },
  proxy: {
    rootRelativePath: { type: String, default: '' },
    hlsMaster: { type: String, default: '' },
    accessMp4: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    scrubFolder: { type: String, default: '' },
    scrubFrameCount: { type: Number, min: 0, default: 0 },
    scrubWidth: { type: Number, min: 0, default: 0 },
    scrubHeight: { type: Number, min: 0, default: 0 },
    duration: { type: Number, min: 0, default: null },
    profileVersions: { type: mongoose.Schema.Types.Mixed, default: {} },
    encoder: { type: String, default: '' },
    fallbackReason: { type: String, default: '' },
    size: { type: Number, min: 0, default: 0 },
    processingMs: { type: Number, min: 0, default: 0 },
    error: { type: String, default: '' },
    createdAt: { type: Date, default: null },
  },
  fixity: {
    algorithm: { type: String, default: 'sha256' },
    lastCheckedAt: { type: Date, default: null },
    lastResult: { type: String, enum: ['', 'ok', 'mismatch', 'missing', 'error'], default: '' },
    lastComputedHash: { type: String, default: '' },
    error: { type: String, default: '' },
  },
  quarantinedAt: { type: Date, default: null },
  quarantinedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  quarantineReason: { type: String, default: '' },
  statusBeforeQuarantine: {
    type: String,
    enum: ['', 'ready', 'active', 'superseded'],
    default: '',
  },
  quarantineOriginalRelativePath: { type: String, default: '' },
  purgeEligibleAt: { type: Date, default: null },
  purgedAt: { type: Date, default: null },
  purgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  activatedAt: { type: Date, default: null },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

ProgramFinalVersionSchema.index(
  { programFinal: 1, versionNumber: 1 },
  { name: 'program_final_version_number_unique_idx', unique: true }
);
ProgramFinalVersionSchema.index({ sha256: 1, status: 1 }, { name: 'program_final_version_checksum_idx' });
ProgramFinalVersionSchema.index(
  { status: 1, 'fixity.lastCheckedAt': 1 },
  { name: 'program_final_version_fixity_queue_idx' }
);
ProgramFinalVersionSchema.index({ purgeEligibleAt: 1, status: 1 }, { name: 'program_final_version_purge_idx' });

module.exports = mongoose.model('ProgramFinalVersion', ProgramFinalVersionSchema);
