const { buildProgramFinalProxies } = require('./programFinalProcessingService');
const { recordOperation } = require('./runtimeMetricsService');

async function processProgramFinalQueueTask(data, job) {
  const startedAt = Date.now();
  try {
    const result = await buildProgramFinalProxies(data.versionId, {
      force: data.force === true,
      onProgress: (percent) => job?.progress?.(percent),
    });
    recordOperation('program_final_proxy_build', Date.now() - startedAt, 'completed');
    return result;
  } catch (error) {
    recordOperation('program_final_proxy_build', Date.now() - startedAt, 'failed');
    throw error;
  }
}

module.exports = { processProgramFinalQueueTask };
