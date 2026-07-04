const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..', '..'),
});

const mongoose = require('mongoose');
const {
  isLocalPreviewMaintenanceQueue,
  previewMaintenanceConcurrency,
  previewMaintenanceQueue,
} = require('../queues/previewMaintenanceQueue');
const { processPreviewMaintenanceTask } = require('../services/previewMaintenanceService');

if (isLocalPreviewMaintenanceQueue) {
  console.log('PROCESSING_QUEUE=local: preview maintenance runs inside the web process.');
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
  .then(() => console.log('Preview maintenance worker connected to MongoDB'))
  .catch((error) => {
    console.error('Preview maintenance worker MongoDB connection error:', error);
    process.exit(1);
  });

previewMaintenanceQueue.process(
  previewMaintenanceConcurrency,
  async (job) => processPreviewMaintenanceTask(job.data, job)
);
previewMaintenanceQueue.on('completed', (job) => console.log(`Preview maintenance completed: ${job.id}`));
previewMaintenanceQueue.on('failed', (job, error) => {
  console.error(`Preview maintenance failed: ${job.id}`, error);
});
