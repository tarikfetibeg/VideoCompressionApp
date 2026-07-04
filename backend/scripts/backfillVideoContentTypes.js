const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const BroadcastContentType = require('../models/BroadcastContentType');
const Video = require('../models/Video');
const { defaultContentTypes } = require('../config/broadcastDefaults');
const { getCanonicalFinalCategory, normalizeFinalCategory } = require('../utils/contentTypeFilters');
const { buildVideoSearchText } = require('../utils/searchText');

const DEFAULT_BATCH_SIZE = 500;

function getBatchSize() {
  const argument = process.argv.find((value) => value.startsWith('--batch='));
  const parsed = argument ? parseInt(argument.split('=')[1], 10) : DEFAULT_BATCH_SIZE;
  return Math.min(Math.max(parsed || DEFAULT_BATCH_SIZE, 50), 2000);
}

async function ensureDefaultContentTypes() {
  const count = await BroadcastContentType.countDocuments();
  if (count > 0) return;
  await BroadcastContentType.insertMany(defaultContentTypes.map((type) => ({ ...type, active: true })));
}

async function buildContentTypeMap() {
  await ensureDefaultContentTypes();
  const contentTypes = await BroadcastContentType.find({ active: true }).select('_id slug').lean();
  return new Map(contentTypes.map((type) => [normalizeFinalCategory(type.slug), type]));
}

async function flushBatch(operations) {
  if (operations.length === 0) return 0;
  const result = await Video.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || result.upsertedCount || 0;
}

function incrementCounter(counter, key) {
  const normalizedKey = key || 'empty';
  counter[normalizedKey] = (counter[normalizedKey] || 0) + 1;
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

  const contentTypeBySlug = await buildContentTypeMap();
  const cursor = Video.find({
    $and: [
      {
        $or: [
          { contentType: { $exists: false } },
          { contentType: null },
        ],
      },
      { finalCategory: { $exists: true, $nin: [null, ''] } },
    ],
  }).lean().cursor();

  const operations = [];
  const skippedUnknownCategory = {};
  const skippedMissingContentType = {};
  let matched = 0;
  let updated = 0;

  for await (const video of cursor) {
    matched += 1;
    const originalCategory = normalizeFinalCategory(video.finalCategory);
    const canonicalCategory = getCanonicalFinalCategory(originalCategory);

    if (!canonicalCategory) {
      incrementCounter(skippedUnknownCategory, originalCategory);
      continue;
    }

    const contentType = contentTypeBySlug.get(canonicalCategory);
    if (!contentType) {
      incrementCounter(skippedMissingContentType, canonicalCategory);
      continue;
    }

    const nextVideo = {
      ...video,
      contentType: contentType._id,
      finalCategory: canonicalCategory,
    };

    operations.push({
      updateOne: {
        filter: {
          _id: video._id,
          $or: [
            { contentType: { $exists: false } },
            { contentType: null },
          ],
        },
        update: {
          $set: {
            contentType: contentType._id,
            finalCategory: canonicalCategory,
            searchText: buildVideoSearchText(nextVideo),
          },
        },
      },
    });

    if (operations.length >= batchSize) {
      updated += await flushBatch(operations.splice(0, operations.length));
      console.log(`Video content types: matched ${matched}, updated ${updated}`);
    }
  }

  updated += await flushBatch(operations);

  console.log(JSON.stringify({
    batchSize,
    matched,
    updated,
    skippedUnknownCategory,
    skippedMissingContentType,
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
