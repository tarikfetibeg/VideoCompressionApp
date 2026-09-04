const Queue = require('bull');
const LocalVideoQueue = require('./localVideoQueue');
const ProgramFinal = require('../models/ProgramFinal');
const ProgramFinalVersion = require('../models/ProgramFinalVersion');
const { getProcessingQueueMode, isLocalProcessingQueue } = require('../config/processingQueue');
const { getQueueErrorMessage } = require('../utils/queueErrors');

const defaultJobOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30000 },
  removeOnComplete: 100,
  removeOnFail: 250,
};

function createQueue() {
  if (isLocalProcessingQueue()) {
    console.warn('Program Final queue mode: local/in-memory. Use Redis in production.');
    return new LocalVideoQueue();
  }
  return process.env.REDIS_URL
    ? new Queue('program final processing', process.env.REDIS_URL, { defaultJobOptions })
    : new Queue('program final processing', { defaultJobOptions });
}

const programFinalQueue = createQueue();
programFinalQueue.on('error', (error) => console.error('Program Final queue error:', getQueueErrorMessage(error)));

async function enqueueProgramFinalProcessing(versionId, { force = false } = {}) {
  const version = await ProgramFinalVersion.findById(versionId).select('programFinal status');
  if (!version) throw new Error('Verzija finala nije pronađena.');
  await Promise.all([
    ProgramFinalVersion.updateOne(
      { _id: version._id },
      { $set: { status: 'processing', 'proxy.error': '' } }
    ),
    ProgramFinal.updateOne(
      { _id: version.programFinal },
      { $set: { status: 'processing', pendingVersion: version._id } }
    ),
  ]);
  const job = await programFinalQueue.add({ versionId: String(versionId), force });
  if (typeof programFinalQueue.kick === 'function') programFinalQueue.kick();
  return job;
}

module.exports = {
  enqueueProgramFinalProcessing,
  isLocalProgramFinalQueue: isLocalProcessingQueue(),
  programFinalQueue,
  programFinalQueueConcurrency: Math.min(
    Math.max(parseInt(process.env.PROGRAM_FINAL_QUEUE_CONCURRENCY || '1', 10) || 1, 1),
    2
  ),
  queueMode: getProcessingQueueMode(),
};
