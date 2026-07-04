const mongoose = require('mongoose');

const StorageSettingsSchema = new mongoose.Schema({
  warningFreePercent: {
    type: Number,
    default: 20,
    min: 2,
    max: 50,
  },
  criticalFreePercent: {
    type: Number,
    default: 10,
    min: 1,
    max: 40,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('StorageSettings', StorageSettingsSchema);
