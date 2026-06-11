function getProcessingQueueMode() {
  return String(process.env.PROCESSING_QUEUE || 'redis').trim().toLowerCase();
}

function isLocalProcessingQueue() {
  return ['local', 'memory', 'in-memory', 'inline'].includes(getProcessingQueueMode());
}

module.exports = {
  getProcessingQueueMode,
  isLocalProcessingQueue,
};
