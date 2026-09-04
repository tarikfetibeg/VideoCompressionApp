const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({ cwd: path.resolve(__dirname, '..', '..') });

const mongoose = require('mongoose');
const {
  programFinalQueue,
  programFinalQueueConcurrency,
} = require('../queues/programFinalQueue');
const { processProgramFinalQueueTask } = require('../services/programFinalQueueProcessor');

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  programFinalQueue.process(programFinalQueueConcurrency, (job) => processProgramFinalQueueTask(job.data, job));
  console.log(`Program Final worker started; concurrency=${programFinalQueueConcurrency}.`);
}

start().catch((error) => {
  console.error('Program Final worker failed:', error);
  process.exitCode = 1;
});
