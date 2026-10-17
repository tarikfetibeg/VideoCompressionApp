const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  await test('TICKET-controlled-migration', 'Dry-run is read-only; apply replaces only the legacy expiry TTL and backfills legacy metadata', async () => {
    const collection = qa.models.DownloadTicket.collection;
    const id = new qa.models.DownloadTicket.base.Types.ObjectId();
    await collection.insertOne({ _id: id, tokenHash: 'qa-legacy-ticket', createdBy: f.users.Editor._id, kind: 'video-single', payload: {}, status: 'created', expiresAt: new Date(Date.now() + 900000) });
    await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'download_ticket_expiry_idx' });
    const migration = qa.load('services/downloadTicketRetentionMigration');
    const before = await collection.indexes();
    const dry = await migration.migrateDownloadTicketRetention();
    assert.equal(dry.dryRun, true); assert.equal(dry.matched, 1);
    assert.equal((await collection.findOne({ _id: id })).purgeAt, undefined);
    assert.deepEqual((await collection.indexes()).map((index) => index.name).sort(), before.map((index) => index.name).sort());
    const apply = await migration.migrateDownloadTicketRetention({ apply: true });
    assert.equal(apply.updated, 1);
    const after = await collection.indexes();
    assert.ok(!after.some((index) => index.name === 'download_ticket_expiry_idx'));
    assert.ok(after.some((index) => index.name === 'download_ticket_retention_idx' && index.expireAfterSeconds === 0));
    assert.ok(before.filter((index) => index.name !== 'download_ticket_expiry_idx').every((index) => after.some((current) => current.name === index.name)));
    assert.ok((await collection.findOne({ _id: id })).purgeAt > new Date());
    assert.equal((await migration.migrateDownloadTicketRetention({ apply: true })).updated, 0);
  });
  await test('TICKET-active-expiry', 'A started transfer is still reported as started after URL expiry, until completion or abort', async () => {
    const file = path.join(qa.load('utils/storagePaths').paths.compressed, 'qa-large-transfer.bin');
    const descriptor = fs.openSync(file, 'w'); fs.ftruncateSync(descriptor, 64 * 1024 * 1024); fs.closeSync(descriptor);
    const video = await qa.models.Video.create({ filename: 'qa-large-transfer.bin', originalFilename: 'QA large transfer.bin', filepath: file, uploader: f.users.Editor._id, status: 'raw', processingStatus: 'completed' });
    const ticket = await qa.api('Editor', '/api/downloads/tickets', 'POST', { kind: 'video-single', payload: { videoId: String(video._id) } });
    assert.equal(ticket.status, 201);
    let request; let response;
    try {
      await new Promise((resolve, reject) => {
        request = http.get(qa.base + ticket.data.downloadUrl, (stream) => {
          response = stream; stream.on('error', () => {});
          stream.once('data', () => { stream.pause(); request.setTimeout(0); resolve(); });
        });
        request.on('error', reject);
        request.setTimeout(15000, () => { request.destroy(); reject(new Error('Large transfer did not start')); });
      });
      const before = await qa.api('Editor', `/api/downloads/tickets/${ticket.data.ticketId}/status`);
      assert.equal(before.data.status, 'started');
      await qa.models.DownloadTicket.updateOne({ _id: ticket.data.ticketId }, { $set: { purgeAt: new Date(Date.now() + 120000) } });
      await qa.models.DownloadTicket.updateOne({ _id: ticket.data.ticketId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const after = await qa.api('Editor', `/api/downloads/tickets/${ticket.data.ticketId}/status`);
      fs.writeFileSync(path.join(qa.output, 'active-ticket-expiry.json'), JSON.stringify({ fixture: '64MiB disposable binary transfer, client paused', before: before.data.status, afterHttp: after.status, after: after.data?.status, message: after.data?.error || after.data?.message, physicalStreamStillOpen: !response.destroyed }, null, 2));
      assert.equal(after.status, 200); assert.equal(after.data.status, 'started');
      assert.equal((await qa.api(null, ticket.data.downloadUrl)).status, 410);
      assert.equal((await qa.api('Editor', `/api/downloads/tickets/${ticket.data.ticketId}/status`)).data.status, 'started');
      const lastActivity = (await qa.models.DownloadTicket.findById(ticket.data.ticketId)).lastUsedAt.getTime();
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const current = await qa.models.DownloadTicket.findById(ticket.data.ticketId);
        if (current.lastUsedAt.getTime() > lastActivity) { assert.ok(current.purgeAt.getTime() - Date.now() > 23 * 3600000); break; }
        if (attempt === 69) throw new Error('Active transfer heartbeat was not persisted');
        await delay(1000);
      }
      assert.equal((await qa.api('Editor', `/api/downloads/tickets/${ticket.data.ticketId}/status`)).data.status, 'started');
    } finally { response?.destroy(); request?.destroy(); }
    let settled;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      settled = await qa.models.DownloadTicket.findById(ticket.data.ticketId);
      if (settled.status === 'aborted') break;
      await delay(100);
    }
    assert.equal(settled.status, 'aborted');
    assert.ok(settled.purgeAt.getTime() - Date.now() > 23 * 3600000);
  });
};
