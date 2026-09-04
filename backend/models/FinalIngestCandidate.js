const mongoose = require('mongoose');

const FinalIngestCandidateSchema = new mongoose.Schema({
  candidateKey: { type: String, required: true, unique: true },
  mediaNode: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaNode', default: null },
  sourcePath: { type: String, required: true, select: false },
  relativePath: { type: String, required: true },
  filename: { type: String, required: true },
  size: { type: Number, min: 0, default: 0 },
  modifiedAt: { type: Date, required: true },
  stableSince: { type: Date, default: null },
  status: {
    type: String,
    enum: ['observing', 'ready', 'needs_mapping', 'importing', 'imported', 'duplicate', 'failed'],
    default: 'observing',
  },
  parsed: {
    programSlug: { type: String, default: '' },
    airDate: { type: String, default: '' },
    airTime: { type: String, default: '' },
    title: { type: String, default: '' },
    editionLabel: { type: String, default: '' },
  },
  sidecar: { type: mongoose.Schema.Types.Mixed, default: {} },
  mappedProgram: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastProgram', default: null },
  importedFinal: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinal', default: null },
  importedVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinalVersion', default: null },
  sha256: { type: String, default: '' },
  processedPath: { type: String, default: '', select: false },
  error: { type: String, default: '' },
}, { timestamps: true });

FinalIngestCandidateSchema.index({ status: 1, updatedAt: -1 }, { name: 'final_ingest_candidate_status_idx' });
FinalIngestCandidateSchema.index({ mediaNode: 1, status: 1 }, { name: 'final_ingest_candidate_node_status_idx' });

module.exports = mongoose.model('FinalIngestCandidate', FinalIngestCandidateSchema);
