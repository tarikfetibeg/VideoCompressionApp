const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({ cwd: path.resolve(__dirname, '..', '..') });

const mongoose = require('mongoose');
const BroadcastProgram = require('../models/BroadcastProgram');
const { ensureBroadcastProgramSlugs } = require('../services/programFinalCatalogService');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const [total, missingSlug, missingType] = await Promise.all([
    BroadcastProgram.countDocuments({}),
    BroadcastProgram.countDocuments({ $or: [{ slug: { $exists: false } }, { slug: '' }] }),
    BroadcastProgram.countDocuments({ programType: null }),
  ]);
  console.log(JSON.stringify({ dryRun, total, missingSlug, missingType }, null, 2));
  if (!dryRun) {
    const result = await ensureBroadcastProgramSlugs({ applyProgramType: true });
    console.log(JSON.stringify({ applied: true, updated: result.updated }, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
