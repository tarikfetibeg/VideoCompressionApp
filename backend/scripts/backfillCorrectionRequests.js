const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const Video = require('../models/Video');
const { syncTaggedCorrectionRequests } = require('../services/correctionWorkflowService');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const batchArgument = process.argv.find((value) => value.startsWith('--batch='));
  const batchSize = Math.min(
    Math.max(parseInt(batchArgument?.split('=')[1] || '100', 10) || 100, 1),
    500
  );

  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const totals = { checked: 0, createdOrLinked: 0, skipped: 0, batches: 0 };

  while (true) {
    const result = await syncTaggedCorrectionRequests({ limit: batchSize });
    totals.checked += result.checked;
    totals.createdOrLinked += result.createdOrLinked;
    totals.skipped += result.skipped;
    totals.batches += 1;

    console.log(`Correction backfill: batch ${totals.batches}, linked ${result.createdOrLinked}, skipped ${result.skipped}`);
    if (result.checked === 0 || result.createdOrLinked === 0) break;
  }

  const remaining = await Video.countDocuments({
    correctionStatus: 'needs_correction',
    $or: [
      { activeCorrectionRequest: { $exists: false } },
      { activeCorrectionRequest: null },
    ],
  });

  console.log(JSON.stringify({ ...totals, remaining }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
