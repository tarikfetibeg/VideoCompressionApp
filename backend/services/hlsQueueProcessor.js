const { buildHlsPreviewForVideo } = require('./hlsPreviewService');

async function processHlsQueueTask(data, job) {
  return buildHlsPreviewForVideo(data.videoId, {
    force: data.force === true,
    onProgress: (percent) => {
      if (job && typeof job.progress === 'function') return job.progress(percent);
      return undefined;
    },
  });
}

module.exports = {
  processHlsQueueTask,
};
