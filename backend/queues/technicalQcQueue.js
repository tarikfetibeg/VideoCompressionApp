const Queue = require('bull');
const Video = require('../models/Video');
const { getProcessingQueueMode, isLocalProcessingQueue } = require('../config/processingQueue');
const LocalVideoQueue = require('./localVideoQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');

function createTechnicalQcQueue() {
  if (isLocalProcessingQueue()) return new LocalVideoQueue();
  const options = {
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 250,
    },
  };
  return process.env.REDIS_URL
    ? new Queue('technical qc', process.env.REDIS_URL, options)
    : new Queue('technical qc', options);
}

const technicalQcQueue = createTechnicalQcQueue();
technicalQcQueue.on('error', (error) => {
  console.error('Technical QC queue error:', getQueueErrorMessage(error));
});

async function enqueueTechnicalQc(videoId, { requestedBy = null, force = false } = {}) {
  const video = await Video.findById(videoId).select('technicalQc.status');
  if (!video) throw new Error('Video nije pronađen.');
  if (!force && ['queued', 'processing'].includes(video.technicalQc?.status)) {
    return { id: `existing-${videoId}`, existing: true };
  }
  const job = await technicalQcQueue.add({
    videoId: String(videoId),
    requestedBy: requestedBy ? String(requestedBy) : null,
  });
  await Video.findByIdAndUpdate(videoId, {
    $set: {
      'technicalQc.status': 'queued',
      'technicalQc.requestedBy': requestedBy || null,
      'technicalQc.error': '',
    },
  });
  if (typeof technicalQcQueue.kick === 'function') technicalQcQueue.kick();
  return job;
}

module.exports = {
  enqueueTechnicalQc,
  isLocalTechnicalQcQueue: isLocalProcessingQueue(),
  technicalQcQueue,
  technicalQcQueueConcurrency: 1,
  queueMode: getProcessingQueueMode(),
};
