const DownloadTicket = require('../models/DownloadTicket');
const { downloadRetentionDeadline, isLegacyDownloadTtlIndex } = require('../utils/downloadTicketRetention');

async function ticketIndexes() {
  try { return await DownloadTicket.collection.indexes(); }
  catch (error) { if (error.code === 26) return []; throw error; }
}

async function migrateDownloadTicketRetention({ apply = false } = {}) {
  const before = await ticketIndexes();
  const legacy = before.filter(isLegacyDownloadTtlIndex);
  const missing = { $or: [{ purgeAt: { $exists: false } }, { purgeAt: null }] };
  const count = await DownloadTicket.collection.countDocuments(missing);
  const result = { dryRun: !apply, legacyTtlIndexes: legacy.map((index) => index.name), matched: count, updated: 0, newIndex: 'download_ticket_retention_idx' };
  if (!apply) return result;
  // Only the known single-field URL-expiry TTL is replaced; other indexes stay intact.
  for (const index of legacy) await DownloadTicket.collection.dropIndex(index.name);
  const updated = await DownloadTicket.collection.updateMany(missing, { $set: { purgeAt: downloadRetentionDeadline() } });
  result.updated = updated.modifiedCount;
  await DownloadTicket.collection.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0, name: result.newIndex });
  return result;
}

async function warnLegacyDownloadTtl() {
  const legacy = (await ticketIndexes()).filter(isLegacyDownloadTtlIndex);
  if (legacy.length) console.warn('Legacy download URL TTL is still active. Run the documented downloads:retention-migrate procedure before relying on long-transfer tracking.');
}

module.exports = { migrateDownloadTicketRetention, warnLegacyDownloadTtl };
