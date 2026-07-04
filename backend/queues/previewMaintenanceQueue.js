const Queue = require('bull');
const Video = require('../models/Video');
const { getProcessingQueueMode, isLocalProcessingQueue } = require('../config/processingQueue');
const LocalVideoQueue = require('./localVideoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');

const defaultJobOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 30000,
  },
  removeOnComplete: 100,
  removeOnFail: 250,
};

function createPreviewMaintenanceQueue() {
  if (isLocalProcessingQueue()) {
    console.warn('Preview maintenance queue mode: local/in-memory. Use Redis in production.');
    return new LocalVideoQueue();
  }
  if (process.env.REDIS_URL) {
    return new Queue('preview maintenance', process.env.REDIS_URL, { defaultJobOptions });
  }
  return new Queue('preview maintenance', { defaultJobOptions });
}

const previewMaintenanceQueue = createPreviewMaintenanceQueue();

previewMaintenanceQueue.on('error', (error) => {
  console.error('Preview maintenance queue error:', getQueueErrorMessage(error));
});

async function enqueuePreviewMaintenance(videoId, assetTypes) {
  const normalizedTypes = Array.from(new Set(assetTypes || []))
    .filter((assetType) => ['mp4', 'thumbnail', 'scrub'].includes(assetType));
  if (normalizedTypes.length === 0) throw new Error('Nije odabran maintenance asset.');
  const job = await previewMaintenanceQueue.add({
    videoId: videoId.toString(),
    assetTypes: normalizedTypes,
  });
  await Video.findByIdAndUpdate(videoId, {
    $set: {
      previewMaintenance: {
        status: 'queued',
        assetTypes: normalizedTypes,
        error: '',
      },
    },
  });
  if (typeof previewMaintenanceQueue.kick === 'function') previewMaintenanceQueue.kick();
  return job;
}

module.exports = {
  enqueuePreviewMaintenance,
  isLocalPreviewMaintenanceQueue: isLocalProcessingQueue(),
  previewMaintenanceConcurrency: 1,
  previewMaintenanceQueue,
  queueMode: getProcessingQueueMode(),
};
