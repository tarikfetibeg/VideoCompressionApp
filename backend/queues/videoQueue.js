const Queue = require('bull');
const Video = require('../models/Video');
const { getProcessingQueueMode, isLocalProcessingQueue } = require('../config/processingQueue');
const LocalVideoQueue = require('./localVideoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 30000,
  },
  removeOnComplete: 100,
  removeOnFail: 250,
};

function createQueue() {
  if (isLocalProcessingQueue()) {
    console.warn('Video queue mode: local/in-memory. Use Redis for production processing.');
    return new LocalVideoQueue();
  }

  if (process.env.REDIS_URL) {
    return new Queue('video processing', process.env.REDIS_URL, {
      defaultJobOptions,
    });
  }

  return new Queue('video processing', {
    defaultJobOptions,
  });
}

const videoQueue = createQueue();
const queueMode = getProcessingQueueMode();

videoQueue.on('error', (error) => {
  console.error('Video queue error:', getQueueErrorMessage(error));
});

async function enqueueVideoProcessing(videoId) {
  const job = await videoQueue.add({ videoId: videoId.toString() });

  await Video.findByIdAndUpdate(videoId, {
    processingStatus: 'queued',
    processingJobId: job.id.toString(),
    processingProgress: 0,
    processingError: null,
    processingStartedAt: null,
    processingCompletedAt: null,
  });

  if (typeof videoQueue.kick === 'function') {
    videoQueue.kick();
  }

  return job;
}

module.exports = {
  videoQueue,
  enqueueVideoProcessing,
  isLocalVideoQueue: isLocalProcessingQueue(),
  queueMode,
};
