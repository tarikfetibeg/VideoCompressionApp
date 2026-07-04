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

function createHlsQueue() {
  if (isLocalProcessingQueue()) {
    console.warn('HLS queue mode: local/in-memory. Use Redis for production processing.');
    return new LocalVideoQueue();
  }
  if (process.env.REDIS_URL) {
    return new Queue('hls processing', process.env.REDIS_URL, { defaultJobOptions });
  }
  return new Queue('hls processing', { defaultJobOptions });
}

const hlsQueue = createHlsQueue();

hlsQueue.on('error', (error) => {
  console.error('HLS queue error:', getQueueErrorMessage(error));
});

async function enqueueHlsPreview(videoId, { force = false } = {}) {
  const job = await hlsQueue.add({
    videoId: videoId.toString(),
    force,
  });
  const video = await Video.findById(videoId).select('hlsPreview.status');
  const set = {
    'hlsPreview.buildStatus': 'queued',
    'hlsPreview.lastBuildError': '',
  };
  if (video?.hlsPreview?.status !== 'ready') {
    set['hlsPreview.status'] = 'queued';
    set['hlsPreview.error'] = '';
  }
  await Video.findByIdAndUpdate(videoId, { $set: set });
  if (typeof hlsQueue.kick === 'function') hlsQueue.kick();
  return job;
}

module.exports = {
  enqueueHlsPreview,
  hlsQueue,
  hlsQueueConcurrency: Math.min(
    Math.max(parseInt(process.env.HLS_QUEUE_CONCURRENCY || '1', 10) || 1, 1),
    4
  ),
  isLocalHlsQueue: isLocalProcessingQueue(),
  queueMode: getProcessingQueueMode(),
};
