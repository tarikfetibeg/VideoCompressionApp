const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({ cwd: path.resolve(__dirname, '..', '..') });

const mongoose = require('mongoose');
const { technicalQcQueue } = require('../queues/technicalQcQueue');
const { processTechnicalQcTask } = require('../services/technicalQcQueueProcessor');

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  technicalQcQueue.process(1, (job) => processTechnicalQcTask(job.data, job));
  console.log('Technical QC worker je pokrenut sa concurrency=1.');
}

start().catch((error) => {
  console.error('Technical QC worker failed:', error);
  process.exit(1);
});
