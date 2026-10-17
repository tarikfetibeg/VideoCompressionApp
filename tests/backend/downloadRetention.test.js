const test = require('node:test');
const assert = require('node:assert/strict');
const { DOWNLOAD_RETENTION_MS, DOWNLOAD_HEARTBEAT_MS, downloadRetentionDeadline, isLegacyDownloadTtlIndex } = require('../../backend/utils/downloadTicketRetention');
const DownloadTicket = require('../../backend/models/DownloadTicket');

test('URL expiry and 24h metadata retention are independent, with purgeAt TTL only', () => {
  assert.equal(DOWNLOAD_RETENTION_MS, 86400000); assert.equal(DOWNLOAD_HEARTBEAT_MS, 60000);
  assert.equal(downloadRetentionDeadline(new Date(1000)).getTime(), 86401000);
  const now = Date.now();
  const ticket = new DownloadTicket({ tokenHash: 'hash', createdBy: '000000000000000000000001', kind: 'video-single', expiresAt: new Date(now + 900000) });
  assert.ok(!Number.isNaN(ticket.purgeAt.getTime()));
  assert.ok(ticket.purgeAt.getTime() - now >= 86400000);
  const ttl = DownloadTicket.schema.indexes().filter(([, options]) => options.expireAfterSeconds !== undefined);
  assert.equal(ttl.length, 1); assert.deepEqual(ttl[0][0], { purgeAt: 1 });
  assert.equal(isLegacyDownloadTtlIndex({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }), true);
  assert.equal(isLegacyDownloadTtlIndex({ key: { expiresAt: -1 }, expireAfterSeconds: 60 }), true);
  assert.equal(isLegacyDownloadTtlIndex({ key: { expiresAt: 1 } }), false);
  assert.equal(isLegacyDownloadTtlIndex({ key: { purgeAt: 1 }, expireAfterSeconds: 0 }), false);
});
