const path = require('node:path');
require('dotenv-flow').config({ cwd: path.resolve(__dirname, '../..') });
const mongoose = require('mongoose');
const { migrateDownloadTicketRetention } = require('../services/downloadTicketRetentionMigration');

(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--backup-confirmed')) throw new Error('Back up the database and pass --backup-confirmed before applying the migration.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
  console.log(JSON.stringify(await migrateDownloadTicketRetention({ apply }), null, 2));
})().catch((error) => {
  console.error(String(error.message).replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MONGODB_URI]'));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
