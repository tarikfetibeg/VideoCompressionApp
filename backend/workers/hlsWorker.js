const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const {
  hlsQueue,
  hlsQueueConcurrency,
  isLocalHlsQueue,
} = require('../queues/hlsQueue');
const { processHlsQueueTask } = require('../services/hlsQueueProcessor');

if (isLocalHlsQueue) {
  console.log('PROCESSING_QUEUE=local: HLS processing runs inside the web process.');
  process.exit(0);
}

if (!process.env.MONGODB_URI) {
  console.error('Error: MONGODB_URI is not defined');
  process.exit(1);
}

mongoose
  .connect(process.env.MONGODB_URI, {
    autoIndex: process.env.MONGOOSE_AUTO_INDEX === 'true',
  })
  .then(() => console.log(`HLS worker connected to MongoDB; concurrency=${hlsQueueConcurrency}`))
  .catch((error) => {
    console.error('HLS worker MongoDB connection error:', error);
    process.exit(1);
  });

hlsQueue.process(hlsQueueConcurrency, async (job) => processHlsQueueTask(job.data, job));
hlsQueue.on('completed', (job) => console.log(`HLS job completed: ${job.id}`));
hlsQueue.on('failed', (job, error) => console.error(`HLS job failed: ${job.id}`, error));
