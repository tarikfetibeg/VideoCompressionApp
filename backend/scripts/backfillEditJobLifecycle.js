const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const EditJob = require('../models/EditJob');
const Video = require('../models/Video');

const DEFAULT_BATCH_SIZE = 250;

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const batchArgument = process.argv.find((value) => value.startsWith('--batch='));
  const batchSize = Math.min(
    Math.max(parseInt(batchArgument?.split('=')[1] || DEFAULT_BATCH_SIZE, 10) || DEFAULT_BATCH_SIZE, 25),
    1000
  );

  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  const cursor = EditJob.find({}).lean().cursor();
  const operations = [];
  let scanned = 0;
  let updated = 0;
  let inferredContentTypes = 0;

  const flush = async () => {
    if (operations.length === 0) return;
    const result = await EditJob.bulkWrite(operations.splice(0, operations.length), { ordered: false });
    updated += result.modifiedCount || 0;
  };

  for await (const job of cursor) {
    scanned += 1;
    const set = {};
    if (!job.workspaceState) set.workspaceState = 'active';
    if (!job.jobKind) set.jobKind = 'standard';

    if (!job.contentType) {
      const finalVideo = await Video.findOne({
        sourceJob: job._id,
        contentType: { $exists: true, $ne: null },
      })
        .sort({ uploadDate: -1 })
        .select('contentType')
        .lean();
      if (finalVideo?.contentType) {
        set.contentType = finalVideo.contentType;
        inferredContentTypes += 1;
      }
    }

    if (Object.keys(set).length > 0) {
      operations.push({
        updateOne: {
          filter: { _id: job._id },
          update: { $set: set },
        },
      });
    }

    if (operations.length >= batchSize) {
      await flush();
      console.log(`EditJob lifecycle: scanned ${scanned}, updated ${updated}`);
    }
  }

  await flush();
  console.log(JSON.stringify({
    scanned,
    updated,
    inferredContentTypes,
    autoExpired: 0,
    note: 'Existing jobs intentionally keep expiresAt unset.',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
