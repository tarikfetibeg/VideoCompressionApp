const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const Video = require('../models/Video');
const { buildVideoSearchPrefixes } = require('../utils/searchText');

const DEFAULT_BATCH_SIZE = 500;

function getBatchSize() {
  const argument = process.argv.find((value) => value.startsWith('--batch='));
  const parsed = argument ? parseInt(argument.split('=')[1], 10) : DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(parsed || DEFAULT_BATCH_SIZE, 50), 2000);
}

async function flush(operations) {
  if (operations.length === 0) return 0;
  const result = await Video.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  const batchSize = getBatchSize();
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });

  const cursor = Video.find({}).select('+searchText +searchPrefixes').lean().cursor();
  const operations = [];
  let scanned = 0;
  let modified = 0;

  for await (const video of cursor) {
    scanned += 1;
    operations.push({
      updateOne: {
        filter: { _id: video._id },
        update: { $set: { searchPrefixes: buildVideoSearchPrefixes(video) } },
      },
    });

    if (operations.length >= batchSize) {
      modified += await flush(operations.splice(0, operations.length));
      console.log(`Video prefixes: scanned ${scanned}, modified ${modified}`);
    }
  }

  modified += await flush(operations);
  console.log(JSON.stringify({ scanned, modified, batchSize }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
