const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const Video = require('../models/Video');
const EditJob = require('../models/EditJob');
const Feedback = require('../models/Feedback');
const {
  buildEditJobSearchText,
  buildFeedbackSearchText,
  buildVideoSearchText,
} = require('../utils/searchText');

const DEFAULT_BATCH_SIZE = 500;

function getBatchSize() {
  const argument = process.argv.find((value) => value.startsWith('--batch='));
  const parsed = argument ? parseInt(argument.split('=')[1], 10) : DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(parsed || DEFAULT_BATCH_SIZE, 50), 2000);
}

async function flushBatch(model, operations) {
  if (operations.length === 0) return 0;
  const result = await model.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || result.upsertedCount || 0;
}

async function backfillModel({ model, name, buildSearchText, batchSize }) {
  const cursor = model.find({}).lean().cursor();
  const operations = [];
  let scanned = 0;
  let modified = 0;

  for await (const document of cursor) {
    scanned += 1;
    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: { $set: { searchText: buildSearchText(document) } },
      },
    });

    if (operations.length >= batchSize) {
      modified += await flushBatch(model, operations.splice(0, operations.length));
      console.log(`${name}: scanned ${scanned}, modified ${modified}`);
    }
  }

  modified += await flushBatch(model, operations);
  console.log(`${name}: done, scanned ${scanned}, modified ${modified}`);
  return { scanned, modified };
}

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    throw new Error('MONGODB_URI is required.');
  }

  const batchSize = getBatchSize();
  await mongoose.connect(mongoURI, {
    autoIndex: false,
  });

  const results = {};
  results.videos = await backfillModel({
    model: Video,
    name: 'Video',
    buildSearchText: buildVideoSearchText,
    batchSize,
  });
  results.editJobs = await backfillModel({
    model: EditJob,
    name: 'EditJob',
    buildSearchText: buildEditJobSearchText,
    batchSize,
  });
  results.feedback = await backfillModel({
    model: Feedback,
    name: 'Feedback',
    buildSearchText: buildFeedbackSearchText,
    batchSize,
  });

  console.log(JSON.stringify({ batchSize, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
