const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const { videoQueue } = require('../queues/videoQueue');
const { processVideoJob } = require('../services/videoProcessingService');

const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Error: MONGODB_URI is not defined');
  process.exit(1);
}

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log('Video worker connected to MongoDB');
  })
  .catch((error) => {
    console.error('Video worker MongoDB connection error:', error);
    process.exit(1);
  });

videoQueue.process(1, async (job) => {
  return processVideoJob(job.data, job);
});

videoQueue.on('completed', (job) => {
  console.log(`Video job completed: ${job.id}`);
});

videoQueue.on('failed', (job, error) => {
  console.error(`Video job failed: ${job.id}`, error);
});
