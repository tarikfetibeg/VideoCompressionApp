const { runTechnicalQc } = require('./technicalQcService');

async function processTechnicalQcTask(data, job) {
  if (job && typeof job.progress === 'function') await job.progress(5);
  const result = await runTechnicalQc(data.videoId, { requestedBy: data.requestedBy });
  if (job && typeof job.progress === 'function') await job.progress(100);
  return result;
}

module.exports = { processTechnicalQcTask };
