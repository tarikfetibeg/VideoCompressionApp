function isRedisQueueError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  return [
    'max retries per request',
    'econnrefused',
    'connection is closed',
    'connect etimedout',
    'redis connection',
    'ready check failed',
  ].some((needle) => message.includes(needle) || code.includes(needle));
}

function getQueueErrorMessage(error) {
  if (isRedisQueueError(error)) {
    return [
      'Processing queue is not reachable. Redis is probably not running or REDIS_URL is wrong.',
      'The raw file was saved locally, so start Redis and use Retry Processing instead of uploading again.',
    ].join(' ');
  }

  return `Failed to queue video processing: ${error.message}`;
}

module.exports = {
  getQueueErrorMessage,
  isRedisQueueError,
};
