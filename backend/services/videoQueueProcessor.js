const { enqueueHlsPreview } = require('../queues/hlsQueue');
const { enqueueTechnicalQc } = require('../queues/technicalQcQueue');
const { processVideoJob } = require('./videoProcessingService');
const { recordOperation } = require('./runtimeMetricsService');

async function processQueuedVideoTask(data, job) {
  const startedAt = Date.now();
  try {
    const video = await processVideoJob(data, job);
    await enqueueHlsPreview(video._id).catch((error) => {
      console.warn(`Could not enqueue HLS preview for ${video._id}:`, error.message);
    });
    if (process.env.TECHNICAL_QC_AUTO === 'true') {
      await enqueueTechnicalQc(video._id, { requestedBy: video.uploader }).catch((error) => {
        console.warn(`Could not enqueue technical QC for ${video._id}:`, error.message);
      });
    }
    recordOperation('video_processing', Date.now() - startedAt, 'completed');
    return video;
  } catch (error) {
    recordOperation('video_processing', Date.now() - startedAt, 'failed');
    throw error;
  }
}

module.exports = {
  processQueuedVideoTask,
};
