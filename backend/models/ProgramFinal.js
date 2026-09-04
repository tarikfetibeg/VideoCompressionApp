const mongoose = require('mongoose');

const ProgramFinalCreditSchema = new mongoose.Schema({
  person: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionPerson', required: true },
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductionRole', required: true },
  personNameSnapshot: { type: String, required: true, trim: true },
  roleNameSnapshot: { type: String, required: true, trim: true },
}, { _id: true });

const ProgramFinalSchema = new mongoose.Schema({
  programType: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramType', default: null },
  program: { type: mongoose.Schema.Types.ObjectId, ref: 'BroadcastProgram', required: true },
  airDate: { type: Date, required: true },
  airTime: { type: String, required: true, trim: true },
  editionLabel: { type: String, default: '', trim: true },
  editionKey: { type: String, required: true, trim: true },
  title: { type: String, required: true, trim: true },
  showDay: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowDay', default: null },
  historical: { type: Boolean, default: false },
  credits: { type: [ProgramFinalCreditSchema], default: [] },
  status: {
    type: String,
    enum: [
      'draft',
      'waiting_for_file',
      'ingesting',
      'processing',
      'waiting_for_air',
      'ready_for_archive_review',
      'archived',
      'quarantined',
    ],
    default: 'draft',
  },
  activeVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinalVersion', default: null },
  pendingVersion: { type: mongoose.Schema.Types.ObjectId, ref: 'ProgramFinalVersion', default: null },
  versionSequence: { type: Number, min: 0, default: 0 },
  airedAt: { type: Date, default: null },
  airedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  archiveConfirmedAt: { type: Date, default: null },
  archiveConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  archiveOverrideReason: { type: String, default: '', trim: true },
  archiveWarnings: { type: [String], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  searchText: { type: String, default: '' },
  searchPrefixes: { type: [String], default: [] },
  tombstone: {
    purgedAt: { type: Date, default: null },
    purgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, default: '' },
    checksum: { type: String, default: '' },
  },
}, { timestamps: true });

ProgramFinalSchema.index(
  { program: 1, airDate: 1, airTime: 1, editionKey: 1 },
  { name: 'program_final_edition_unique_idx', unique: true }
);
ProgramFinalSchema.index({ status: 1, airDate: -1 }, { name: 'program_final_status_date_idx' });
ProgramFinalSchema.index({ programType: 1, program: 1, airDate: -1 }, { name: 'program_final_type_program_date_idx' });
ProgramFinalSchema.index({ 'credits.person': 1, airDate: -1 }, { name: 'program_final_credit_person_idx' });
ProgramFinalSchema.index({ 'credits.role': 1, airDate: -1 }, { name: 'program_final_credit_role_idx' });
ProgramFinalSchema.index({ searchPrefixes: 1 }, { name: 'program_final_search_prefix_idx' });
ProgramFinalSchema.index({ activeVersion: 1 }, { name: 'program_final_active_version_idx' });
ProgramFinalSchema.index(
  { showDay: 1 },
  {
    name: 'program_final_show_day_unique_idx',
    unique: true,
    partialFilterExpression: { showDay: { $type: 'objectId' } },
  }
);

module.exports = mongoose.model('ProgramFinal', ProgramFinalSchema);
