const DOWNLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_HEARTBEAT_MS = 60 * 1000;
const downloadRetentionDeadline = (now = Date.now()) => new Date(Number(now) + DOWNLOAD_RETENTION_MS);
const isLegacyDownloadTtlIndex = (index) => Object.keys(index.key || {}).length === 1
  && [1, -1].includes(index.key.expiresAt) && typeof index.expireAfterSeconds === 'number';

module.exports = { DOWNLOAD_RETENTION_MS, DOWNLOAD_HEARTBEAT_MS, downloadRetentionDeadline, isLegacyDownloadTtlIndex };
