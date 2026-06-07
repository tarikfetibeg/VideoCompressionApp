const Queue = require('bull');
const Video = require('../models/Video');

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

async function enqueueVideoProcessing(videoId) {
  const job = await videoQueue.add({ videoId: videoId.toString() });

  await Video.findByIdAndUpdate(videoId, {
    processingStatus: 'queued',
    processingJobId: job.id.toString(),
    processingProgress: 0,
    processingError: null,
  });

  return job;
}

module.exports = {
  videoQueue,
  enqueueVideoProcessing,
};
