const { enqueueHlsPreview } = require('../queues/hlsQueue');
const { processVideoJob } = require('./videoProcessingService');

async function processQueuedVideoTask(data, job) {
  const video = await processVideoJob(data, job);
  await enqueueHlsPreview(video._id).catch((error) => {
    console.warn(`Could not enqueue HLS preview for ${video._id}:`, error.message);
  });
  return video;
}

module.exports = {
  processQueuedVideoTask,
};
