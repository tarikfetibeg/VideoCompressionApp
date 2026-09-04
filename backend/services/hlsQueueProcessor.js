const { buildHlsPreviewForVideo } = require('./hlsPreviewService');
const { recordOperation } = require('./runtimeMetricsService');

async function processHlsQueueTask(data, job) {
  const startedAt = Date.now();
  try {
    const result = await buildHlsPreviewForVideo(data.videoId, {
      force: data.force === true,
      onProgress: (percent) => {
        if (job && typeof job.progress === 'function') return job.progress(percent);
        return undefined;
      },
    });
    recordOperation('hls_build', Date.now() - startedAt, 'completed');
    return result;
  } catch (error) {
    recordOperation('hls_build', Date.now() - startedAt, 'failed');
    throw error;
  }
}

module.exports = {
  processHlsQueueTask,
};
