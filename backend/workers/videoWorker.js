const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const { isLocalVideoQueue, videoQueue } = require('../queues/videoQueue');
const { processQueuedVideoTask } = require('../services/videoQueueProcessor');

if (isLocalVideoQueue) {
  console.log('PROCESSING_QUEUE=local: video processing runs inside the web process. Worker is not needed.');
  process.exit(0);
}

const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Error: MONGODB_URI is not defined');
  process.exit(1);
}

mongoose
  .connect(mongoURI, {
    autoIndex: process.env.MONGOOSE_AUTO_INDEX === 'true',
  })
  .then(() => {
    console.log('Video worker connected to MongoDB');
  })
  .catch((error) => {
    console.error('Video worker MongoDB connection error:', error);
    process.exit(1);
  });

videoQueue.process(1, async (job) => {
  return processQueuedVideoTask(job.data, job);
});

videoQueue.on('completed', (job) => {
  console.log(`Video job completed: ${job.id}`);
});

videoQueue.on('failed', (job, error) => {
  console.error(`Video job failed: ${job.id}`, error);
});
