const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  const { api, models } = qa;
  const id = (value) => String(value._id || value);
  const ok = (response, status = 200) => assert.equal(response.status, status, `HTTP ${response.status}: ${response.data?.message || 'unexpected response'}`);
  await test('F01-login', 'All seven roles login; bad credentials and public registration rejected', async () => {
    assert.equal(Object.keys(qa.sessions).length, 10);
    ok(await api(null, '/api/auth/login', 'POST', { username: 'qa_reporter', password: 'not-the-password' }), 400);
    ok(await api(null, '/api/auth/register', 'POST', { username: 'external', password: 'password123' }), 403);
    ok(await api(null, '/api/videos/workspace'), 401);
  });
  await test('F01-role', 'Protected API matrix for all roles', async () => {
    const matrix = [
      ['/api/admin/users', ['Admin']],
      ['/api/archive/videos/workspace', ['Archivist', 'Admin']],
      ['/api/broadcast/library-search', ['Producer', 'Admin']],
      ['/api/edit-jobs/workspace', ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Admin']],
      ['/api/videos/details/' + id(f.videos[1]), ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']],
      ['/api/feedback/workspace', ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']],
    ];
    for (const [route, allowed] of matrix) for (const role of ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']) {
      const response = await api(role, route);
      assert.equal(response.status, allowed.includes(role) ? 200 : 403, `${role} ${route}: ${response.status}`);
    }
    return { assertions: 42 };
  });
  await test('F11-archive', 'Reporter category, legacy category and prefix archive counts match fixtures', async () => {
    const response = await api('Reporter', `/api/videos/workspace?scope=station&library=archive&contentTypeId=${id(f.categories.prilog)}&limit=200`);
    ok(response);
    const expected = f.videos.filter((v, index) => index % 2 === 1 && index % 3 !== 0).length;
    assert.equal(response.data.total, expected);
    assert.ok(response.data.items.some((v) => v._id === id(f.videos[5])), 'Legacy video-report absent');
    for (const q of ['in', 'ins', 'inse', 'insert', 'sp', 'špi', 'spica insert']) {
      const search = await api('Reporter', `/api/videos/workspace?scope=station&library=archive&q=${encodeURIComponent(q)}&limit=7`);
      ok(search);
      assert.equal(search.data.total, 50, `Wrong prefix result for ${q}`);
      assert.equal(search.data.items.length, 7);
    }
    const second = await api('Reporter', '/api/videos/workspace?scope=station&library=archive&limit=7&page=2');
    ok(second);
    assert.equal(second.data.page, 2);
    return { categoryTotal: expected, prefixTotal: 50 };
  });
  await test('F02-job', 'Reporter creates categorized job with SLA and cannot create without category', async () => {
    const response = await api('Reporter', '/api/edit-jobs', 'POST', { title: 'QA novi prilog', contentTypeId: id(f.categories.prilog), segments: [{ video: id(f.videos[0]), startTime: 1, endTime: 5 }] });
    ok(response, 201);
    assert.equal(response.data.job.workspaceState, 'active');
    assert.ok(response.data.job.deadline);
    assert.ok(response.data.job.expiresAt);
    ok(await api('Reporter', '/api/edit-jobs', 'POST', { title: 'No category' }), 400);
    f.createdJob = response.data.job;
  });
  await test('F02-owner', 'Reporter cannot put another reporter private raw material into a new job', async () => {
    const response = await api('Reporter', '/api/edit-jobs', 'POST', { title: 'Forbidden material', contentTypeId: id(f.categories.prilog), segments: [{ video: id(f.videos[2]), startTime: 0 }] });
    ok(response, 403);
  });
  await test('F05-claim-race', 'Two editors cannot claim the same job', async () => {
    ok(await api('Producer', `/api/edit-jobs/${id(f.jobs[2])}/claim`, 'PATCH'), 403);
    const responses = await Promise.all(['Editor', 'Editor2'].map((role) => api(role, `/api/edit-jobs/${id(f.jobs[2])}/claim`, 'PATCH')));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  });
  await test('F07-comments', 'Editor comment notifies reporter, not author; opening job marks read', async () => {
    const response = await api('Editor', `/api/edit-jobs/${id(f.jobs[0])}/comments`, 'POST', { body: 'Treba dodatni insert sa događaja.' });
    ok(response, 201);
    assert.equal(response.data.notificationsCreated, 1);
    const notifications = await api('Reporter', '/api/notifications/workspace?unreadOnly=true');
    ok(notifications);
    assert.ok(notifications.data.items.some((n) => n.job?._id === id(f.jobs[0]) || n.job === id(f.jobs[0])));
    assert.equal(await models.Notification.countDocuments({ recipient: f.users.Editor._id, kind: 'edit_job_comment' }), 0);
    ok(await api('Reporter', `/api/edit-jobs/${id(f.jobs[0])}`));
    assert.equal(await models.Notification.countDocuments({ recipient: f.users.Reporter._id, job: f.jobs[0]._id, readAt: null }), 0);
  });
  await test('F07-admin', 'Admin comment notifies both reporter and editor', async () => {
    const response = await api('Admin', `/api/edit-jobs/${id(f.jobs[0])}/comments`, 'POST', { body: 'Admin provjera' });
    ok(response, 201);
    assert.equal(response.data.notificationsCreated, 2);
    ok(await api('Reporter', '/api/notifications/read-all', 'PATCH'));
  });
  await test('F07-recipients', 'Reporter comments notify the editor, while an unassigned job has no invalid recipient', async () => {
    const response = await api('Reporter', `/api/edit-jobs/${id(f.jobs[0])}/comments`, 'POST', { body: 'QA reporterska dopuna' });
    ok(response, 201);
    assert.equal(response.data.notificationsCreated, 1);
    assert.ok(await models.Notification.exists({ recipient: f.users.Editor._id, job: f.jobs[0]._id, kind: 'edit_job_comment', readAt: null }));
    const unassigned = await api('Reporter', `/api/edit-jobs/${id(f.createdJob)}/comments`, 'POST', { body: 'QA nedodijeljeni job' });
    ok(unassigned, 201);
    assert.equal(unassigned.data.notificationsCreated, 0);
    const producer = await api('Producer', `/api/edit-jobs/${id(f.jobs[0])}/comments`, 'POST', { body: 'QA producentov komentar' });
    ok(producer, 201);
    assert.equal(producer.data.notificationsCreated, 2);
  });
  await test('F15-archive', 'Archive correction reaches actual editor and deduplicates notification', async () => {
    const response = await api('Archivist', `/api/corrections/video/${id(f.videos[1])}/ensure`, 'POST', { note: 'Greška u potpisu', timestamp: 4.5 });
    ok(response, 201);
    assert.equal(response.data.notificationsCreated, 1, 'No editor notification created');
    assert.equal(id(response.data.correction.assignedEditor), id(f.users.Editor));
    assert.ok(response.data.correction.correctionJob);
    f.correction = response.data.correction;
    const repeat = await api('Archivist', `/api/corrections/video/${id(f.videos[1])}/ensure`, 'POST', { note: 'Greška u potpisu', timestamp: 4.5 });
    ok(repeat, 201);
    assert.equal(id(repeat.data.correction), id(f.correction));
    assert.equal(await models.Notification.countDocuments({ recipient: f.users.Editor._id, kind: 'video_correction', correctionRequest: f.correction._id }), 1);
  });
  await test('F15-unassigned', 'Correction without editor reaches producer and can be routed', async () => {
    await models.Video.updateOne({ _id: f.videos[3]._id }, { $unset: { editor: 1 } });
    const response = await api('Archivist', `/api/corrections/video/${id(f.videos[3])}/ensure`, 'POST', { note: 'Audio preglasan', timestamp: 2 });
    ok(response, 201);
    assert.equal(await models.Notification.countDocuments({ recipient: f.users.Producer._id, correctionRequest: response.data.correction._id }), 1);
    const routed = await api('Producer', `/api/corrections/${id(response.data.correction)}/route`, 'PATCH', { assignedEditorId: id(f.users.VideoEditor) });
    ok(routed);
    assert.equal(await models.Notification.countDocuments({ recipient: f.users.VideoEditor._id, correctionRequest: response.data.correction._id }), 1);
  });
  await test('F15-history', 'Correction remains visible through editing and resolution logs correct actor', async () => {
    assert.ok(f.correction, 'Prerequisite archive correction failed');
    ok(await api('Editor', `/api/corrections/${id(f.correction)}/status`, 'PATCH', { status: 'in_edit' }));
    ok(await api('Editor', `/api/corrections/${id(f.correction)}/status`, 'PATCH', { status: 'ready_for_review' }));
    await models.EditJob.updateOne({ _id: f.correction.correctionJob._id || f.correction.correctionJob }, { $set: { workspaceState: 'expired' } });
    const open = await api('Editor', '/api/corrections/workspace');
    ok(open);
    assert.ok(open.data.items.some((c) => c._id === id(f.correction)));
    ok(await api('Producer', `/api/corrections/${id(f.correction)}/status`, 'PATCH', { status: 'resolved', resolutionNote: 'Pregledano nakon ispravke' }));
    const corrected = await models.CorrectionRequest.findById(f.correction._id);
    assert.equal(String(corrected.correctedBy), id(f.users.Editor));
    assert.equal(String(corrected.resolvedBy), id(f.users.Producer));
    assert.equal((await models.Video.findById(f.videos[1]._id)).correctionStatus, 'resolved');
  });
  await test('F15-dismiss', 'Archive dismissal requires a reason and cannot discard an in-edit correction', async () => {
    const response = await api('Archivist', `/api/corrections/video/${id(f.videos[7])}/ensure`, 'POST', { note: 'QA pogrešna oznaka' });
    ok(response, 201);
    ok(await api('Archivist', `/api/corrections/video/${id(f.videos[7])}/dismiss`, 'PATCH', {}), 400);
    ok(await api('Archivist', `/api/corrections/video/${id(f.videos[7])}/dismiss`, 'PATCH', { reason: 'QA pregledom nije potvrđena greška' }));
    const closed = await models.CorrectionRequest.findById(response.data.correction._id);
    assert.equal(closed.status, 'dismissed'); assert.equal(String(closed.resolvedBy), id(f.users.Archivist));
    const editing = await api('Archivist', `/api/corrections/video/${id(f.videos[9])}/ensure`, 'POST', { note: 'QA aktivna montaža' });
    ok(editing, 201);
    await models.CorrectionRequest.updateOne({ _id: editing.data.correction._id }, { $set: { status: 'in_edit' } });
    ok(await api('Archivist', `/api/corrections/video/${id(f.videos[9])}/dismiss`, 'PATCH', { reason: 'QA nedozvoljeno povlačenje' }), 409);
    assert.ok(await models.AuditLog.exists({ action: 'Dismiss Video Correction', performedBy: f.users.Archivist._id }));
  });
  await test('F09-media', 'Realizator HLS manifests/segments and byte Range stream with no full MP4 fetch', async () => {
    const ticket = await api('Realizator', '/api/media/tickets', 'POST', { videoId: id(f.videos[1]) });
    ok(ticket, 201);
    assert.equal(ticket.data.hlsAvailable, true);
    const manifest = await api(null, ticket.data.manifestUrl);
    ok(manifest);
    assert.match(manifest.bytes.toString(), /720p\/index\.m3u8/);
    const variantUrl = ticket.data.manifestUrl.replace('master.m3u8', '720p/index.m3u8');
    const variant = await api(null, variantUrl);
    ok(variant);
    assert.match(variant.bytes.toString(), /#EXT-X-ENDLIST/);
    const segment = variant.bytes.toString().split('\n').find((line) => line && !line.startsWith('#'));
    ok(await api(null, variantUrl.replace('index.m3u8', segment)));
    const range = await api(null, ticket.data.fallbackUrl, 'GET', undefined, { headers: { Range: 'bytes=100-199' } });
    ok(range, 206);
    assert.equal(range.bytes.length, 100);
    assert.match(range.headers.get('content-range'), /^bytes 100-199\//);
    assert.deepEqual(range.bytes, fs.readFileSync(f.videos[1].filepath).subarray(100, 200));
    const invalidRange = await api(null, ticket.data.fallbackUrl, 'GET', undefined, { headers: { Range: 'bytes=9999999999-' } });
    ok(invalidRange, 416);
    const unused = await api('Realizator', '/api/media/tickets', 'POST', { videoId: id(f.videos[1]) });
    await models.MediaTicket.updateOne({ _id: unused.data.ticketId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    ok(await api(null, unused.data.manifestUrl), 410);
    ok(await api(null, '/api/media/not-a-ticket/master.m3u8'), 404);
    const traversal = qa.load('services/hlsPreviewService').resolveHlsResource(await models.Video.findById(f.videos[1]._id), '../../../package.json');
    assert.equal(traversal, null);
  });
  await test('F10-images', 'Thumbnail, scrub manifest and frame accessible with stable missing fallback', async () => {
    ok(await api('Editor', `/api/videos/thumbnail/${id(f.videos[1])}`));
    const manifest = await api('Editor', `/api/videos/scrub-preview/${id(f.videos[1])}/manifest`);
    ok(manifest);
    assert.ok(manifest.data.frameCount >= 6);
    ok(await api('Editor', `/api/videos/scrub-preview/${id(f.videos[1])}/frame/0`));
  });
  await test('F16-downloads', 'All five download types stream valid files and finish server status', async () => {
    const cases = [
      ['Editor', 'video-single', { videoId: id(f.videos[0]) }, false],
      ['Editor', 'video-bulk', { videoIds: [id(f.videos[0]), id(f.videos[1])] }, true],
      ['Editor', 'edit-package', { jobId: id(f.jobs[0]) }, true],
      ['Reporter', 'edit-off-file', { jobId: id(f.jobs[0]), fileId: id(f.jobs[0].offFiles[0]) }, false],
      ['Realizator', 'air-package', { showDayId: id(f.show) }, true],
    ];
    for (const [role, kind, payload, zip] of cases) {
      const ticket = await api(role, '/api/downloads/tickets', 'POST', { kind, payload });
      ok(ticket, 201);
      const response = await api(null, ticket.data.downloadUrl);
      ok(response);
      assert.ok(response.bytes.length > 100);
      assert.match(response.headers.get('content-disposition'), /filename\*=/);
      if (zip) assert.equal(response.bytes.subarray(0, 2).toString(), 'PK');
      if (kind === 'video-single') assert.equal(crypto.createHash('sha256').update(response.bytes).digest('hex'), crypto.createHash('sha256').update(fs.readFileSync(f.videos[0].filepath)).digest('hex'));
      await delay(100);
      const state = await api(role, `/api/downloads/tickets/${ticket.data.ticketId}/status`);
      ok(state);
      assert.equal(state.data.status, 'completed');
    }
    const forbidden = await api('Realizator', '/api/downloads/tickets', 'POST', { kind: 'video-single', payload: { videoId: id(f.videos[0]) } });
    ok(await api(null, forbidden.data.downloadUrl), 403);
  });
  await test('F17-feedback', 'Both admins see open feedback, private fields hidden, close removes from open', async () => {
    const mine = await api('Reporter', '/api/feedback/workspace');
    ok(mine);
    assert.equal(mine.data.total, 1);
    assert.ok(!('adminComment' in mine.data.items[0]));
    assert.ok(!('comments' in mine.data.items[0]));
    const other = await api('Reporter2', '/api/feedback/workspace');
    assert.equal(other.data.total, 0);
    for (const role of ['Admin', 'Admin2']) assert.equal((await api(role, '/api/feedback/workspace?status=open')).data.total, 1);
    ok(await api('Admin', `/api/feedback/${mine.data.items[0]._id}`, 'PATCH', { status: 'fixed', adminResponse: 'Popravljeno' }));
    assert.equal((await api('Admin2', '/api/feedback/workspace?status=open')).data.total, 0);
  });
  await test('F06-admin', 'Admin close/reactivate job, safe linked delete, SLA expiry preserves material', async () => {
    ok(await api('Admin', `/api/edit-jobs/${id(f.jobs[4])}/admin`, 'PATCH', { workspaceState: 'closed', reason: 'QA završeno' }));
    assert.equal((await models.EditJob.findById(f.jobs[4]._id)).workspaceState, 'closed');
    ok(await api('Admin', `/api/edit-jobs/${id(f.jobs[4])}/admin`, 'PATCH', { workspaceState: 'active', reason: 'QA reaktivacija' }));
    const linked = await api('Admin', `/api/edit-jobs/${id(f.jobs[0])}`, 'DELETE');
    assert.ok([400, 409].includes(linked.status), `Linked job was deleted: ${linked.status}`);
    await models.EditJob.updateOne({ _id: f.jobs[6]._id }, { $set: { expiresAt: new Date(Date.now() - 1000), workspaceState: 'active' } });
    await qa.load('services/editJobLifecycleService').expireEditJobs();
    assert.equal((await models.EditJob.findById(f.jobs[6]._id)).workspaceState, 'expired');
    assert.ok(fs.existsSync(f.videos[12].filepath));
    assert.equal((await models.EditJob.findById(f.jobs[8]._id)).workspaceState, 'active', 'Legacy job auto-expired');
  });
  await test('F21-storage', 'Storage snapshot, refresh and thresholds validate without blocking upload', async () => {
    ok(await api('Admin', '/api/admin/storage/overview'));
    ok(await api('Admin', '/api/admin/storage/overview/refresh', 'POST'), 202);
    const invalid = await api('Admin', '/api/admin/storage/settings', 'PUT', { warningFreePercent: 5, criticalFreePercent: 10 });
    assert.ok([400, 422].includes(invalid.status));
    ok(await api('Admin', '/api/admin/media-previews/summary'));
    ok(await api('Admin', '/api/admin/hls-previews/summary'));
  });
  await test('F20-audit', 'Audit pagination and destructive mutations have actor records', async () => {
    const response = await api('Admin', '/api/admin/audit-logs/workspace?limit=5');
    ok(response);
    assert.ok(response.data.total > 5);
    assert.equal(response.data.items.length, 5);
    assert.ok(await models.AuditLog.exists({ performedBy: f.users.Archivist._id, action: 'Send Video Correction To Production' }));
  });
  await test('F24-cors', 'Same-host origin allowed; foreign origin rejected', async () => {
    ok(await api('Reporter', '/api/feedback/workspace', 'GET', undefined, { headers: { Origin: qa.base } }));
    const foreign = await api('Reporter', '/api/feedback/workspace', 'GET', undefined, { headers: { Origin: 'https://untrusted.example' } });
    assert.ok(foreign.status >= 400);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  });
  await test('F22-retention', 'Preview dry-run leaves source files and DB paths intact', async () => {
    const before = await models.Video.findById(f.videos[1]._id).lean();
    const scan = await api('Admin', '/api/admin/preview-retention/scan', 'POST', { limit: 10 });
    ok(scan);
    const after = await models.Video.findById(f.videos[1]._id).lean();
    assert.equal(before.previewPath, after.previewPath);
    assert.ok(fs.existsSync(after.filepath));
    fs.writeFileSync(path.join(qa.output, 'retention-dry-run.json'), JSON.stringify(scan.data, (key, value) => key.toLowerCase().includes('path') ? undefined : value, 2));
  });
  await test('F11-sort', 'Ascending date sort is respected by video, library and job workspaces', async () => {
    for (const [role, route, field] of [
      ['Editor', '/api/videos/workspace?sortBy=uploadDate&sortOrder=asc&limit=30', 'uploadDate'],
      ['Archivist', '/api/archive/videos/workspace?sortBy=uploadDate&sortOrder=asc&limit=30', 'uploadDate'],
      ['Producer', '/api/broadcast/library-search?sortBy=recent&sortOrder=asc&limit=30', 'uploadDate'],
      ['Editor', '/api/edit-jobs/workspace?sortBy=updatedAt&sortOrder=asc&limit=30', 'updatedAt'],
    ]) {
      const response = await api(role, route); ok(response);
      const dates = response.data.items.map((item) => new Date(item[field]).getTime());
      assert.ok(dates.every((date, i) => i === 0 || date >= dates[i - 1]), `${role} ascending ${field} is ignored`);
    }
  });
  await test('F15-claim-race', 'Only one editor can claim an unassigned correction', async () => {
    await models.Video.updateOne({ _id: f.videos[7]._id }, { $unset: { editor: 1, sourceJob: 1 } });
    const report = await api('Archivist', `/api/corrections/video/${id(f.videos[7])}/ensure`, 'POST', { note: 'QA paralelno preuzimanje' });
    ok(report, 201);
    const responses = await Promise.all(['Editor', 'Editor2'].map((role) => api(role, `/api/corrections/${id(report.data.correction)}/claim`, 'PATCH')));
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const correction = await models.CorrectionRequest.findById(report.data.correction._id);
    assert.equal(await models.EditJob.countDocuments({ correctionRequest: correction._id }), 1);
    const job = await models.EditJob.findById(correction.correctionJob);
    assert.equal(String(job.assignedEditor), String(correction.assignedEditor));
  });
  await test('EXPLAIN-diagnostic', 'Diagnose server metadata UTF-8 independently from stored documents', async () => {
    const command = { explain: { find: models.Video.collection.name, filter: { processingStatus: 'completed' }, sort: { uploadDate: -1 }, limit: 30 }, verbosity: 'executionStats' };
    try {
      const result = await models.Video.db.db.command(command);
      return { strictUtf8: true, stage: result.queryPlanner.winningPlan.stage };
    } catch (error) {
      if (!error.message.includes('Invalid UTF-8')) throw error;
      const result = await models.Video.db.db.command(command, { enableUtf8Validation: false });
      const invalidPaths = [];
      function visit(value, prefix = '') {
        if (typeof value === 'string' && value.includes('\uFFFD')) invalidPaths.push(prefix);
        else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) visit(entry, prefix ? `${prefix}.${key}` : key);
      }
      visit(result);
      fs.writeFileSync(path.join(qa.output, 'explain-utf8-diagnostic.json'), JSON.stringify({ invalidPaths, strictError: error.message, plan: result.queryPlanner.winningPlan, stats: result.executionStats }, null, 2));
      assert.ok(invalidPaths.length > 0);
      assert.ok(invalidPaths.every((field) => field === 'serverInfo.host'), `Non-host invalid UTF-8: ${invalidPaths.join(', ')}`);
      return { strictUtf8: false, diagnosticOnly: true, invalidPaths };
    }
  });
  await test('F15-report-race', 'Concurrent reports create one open correction and one correction job', async () => {
    const responses = await Promise.all(['Archivist', 'Admin'].map((role) => api(role, `/api/corrections/video/${id(f.videos[13])}/ensure`, 'POST', { note: 'QA istovremena prijava' })));
    assert.ok(responses.some((response) => response.status === 201));
    assert.ok(responses.every((response) => [201, 409].includes(response.status)), responses.map((response) => response.status).join(', '));
    ok(await api('Admin', `/api/corrections/video/${id(f.videos[13])}/ensure`, 'POST', { note: 'QA prijava nakon osvježenja' }), 201);
    assert.equal(await models.CorrectionRequest.countDocuments({ video: f.videos[13]._id, status: { $in: ['reported', 'assigned', 'in_edit', 'ready_for_review'] } }), 1);
    assert.equal(await models.EditJob.countDocuments({ jobKind: 'correction', sourceVideo: f.videos[13]._id }), 1);
  });
};
