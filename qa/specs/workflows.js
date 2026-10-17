const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  const { api, models } = qa;
  const id = (value) => String(value._id || value);
  const ok = (response, status = 200) => assert.equal(response.status, status, `HTTP ${response.status}: ${response.data?.message || 'unexpected response'}`);
  const multipart = (fields, field, file, filename) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
    if (file) form.append(field, new Blob([fs.readFileSync(file)]), filename || path.basename(file));
    return form;
  };
  async function completed(videoId) {
    const until = Date.now() + 120000;
    while (Date.now() < until) {
      const video = await models.Video.findById(videoId);
      if (video?.processingStatus === 'completed') return video;
      if (video?.processingStatus === 'failed') throw new Error(`Processing failed: ${video.processingError}`);
      await delay(300);
    }
    throw new Error('Processing did not finish within 120 seconds');
  }
  await test('F08-markers', 'Marker create/delete, invalid time and Realizator read-only API', async () => {
    const response = await api('Editor', `/api/videos/${id(f.videos[0])}/timecodes`, 'POST', { timestamp: 3.5, description: 'QA marker', type: 'in' });
    ok(response);
    const marker = response.data.timecodes.find((item) => item.description === 'QA marker');
    assert.ok(marker);
    ok(await api('Realizator', `/api/videos/${id(f.videos[0])}/timecodes`, 'POST', { timestamp: 2 }), 403);
    ok(await api('Editor', `/api/videos/${id(f.videos[0])}/timecodes`, 'POST', { timestamp: -1 }), 400);
    ok(await api('Editor', `/api/videos/${id(f.videos[0])}/timecodes/${id(marker)}`, 'DELETE'));
  });
  await test('F02-server-append', 'Reporter appends station archive but not another reporter private raw clip', async () => {
    const response = await api('Reporter', `/api/edit-jobs/${id(f.jobs[0])}/reporter-update`, 'PATCH', { segments: [{ video: id(f.videos[11]), startTime: 0, endTime: 5, type: 'broll' }] });
    ok(response);
    assert.ok(response.data.job.segments.some((segment) => id(segment.video) === id(f.videos[11])));
    ok(await api('Reporter', `/api/edit-jobs/${id(f.jobs[0])}/reporter-update`, 'PATCH', { segments: [{ video: id(f.videos[2]), startTime: 0 }] }), 400);
    ok(await api('Reporter2', `/api/edit-jobs/${id(f.jobs[0])}/material-upload`, 'POST', multipart({}, 'videos', f.source)), 403);
  });
  await test('F04-job-upload', 'Direct job upload keeps context, creates segment and completes local processing', async () => {
    const before = await models.EditJob.findById(f.jobs[0]._id);
    const response = await api('Reporter', `/api/edit-jobs/${id(f.jobs[0])}/material-upload`, 'POST', multipart({}, 'videos', f.source, 'Naknadni insert.mp4'));
    ok(response, 202);
    assert.equal(response.data.queueFailures.length, 0);
    assert.equal(response.data.job.segments.length, before.segments.length + 1);
    const video = await completed(response.data.videos[0]._id);
    assert.ok(fs.existsSync(video.compressedPath));
    assert.equal(video.event, 'QA događaj');
    assert.ok(fs.existsSync(video.thumbnailPath));
    f.appendedVideo = video;
  });
  await test('F03-brief', 'Text brief imports Unicode and rejects unsupported/empty input', async () => {
    const form = new FormData();
    form.append('briefDocument', new Blob(['Naslov: Špica\nTekst za čitanje.']), 'brief.txt');
    const response = await api('Reporter', '/api/edit-jobs/import-brief', 'POST', form); ok(response);
    assert.match(response.data.text, /Špica/);
    const empty = new FormData(); empty.append('briefDocument', new Blob(['']), 'empty.txt');
    ok(await api('Reporter', '/api/edit-jobs/import-brief', 'POST', empty), 400);
  });
  await test('F05-final-upload', 'Assigned editor uploads final; other editor and Producer cannot upload it', async () => {
    const fields = { programId: id(f.program), contentTypeId: id(f.categories.prilog), airDate: new Date().toISOString().slice(0, 10), finalTitle: 'QA final čćžšđ' };
    for (const role of ['Editor2', 'Producer']) ok(await api(role, `/api/edit-jobs/${id(f.jobs[0])}/final-upload`, 'POST', multipart(fields, 'finalVideo', f.source)), 403);
    const response = await api('Editor', `/api/edit-jobs/${id(f.jobs[0])}/final-upload`, 'POST', multipart(fields, 'finalVideo', f.source));
    ok(response, 202);
    f.finalVideo = await completed(response.data.video._id);
    assert.equal(f.finalVideo.sourceJob.toString(), id(f.jobs[0]));
    assert.equal((await models.EditJob.findById(f.jobs[0]._id)).status, 'ready_for_qc');
  });
  await test('F08-approval', 'Responsible reporter reject/approve updates final and job; foreign reporter denied', async () => {
    assert.ok(f.finalVideo, 'Final upload prerequisite failed');
    const route = `/api/broadcast/final-videos/${id(f.finalVideo)}/approve`;
    ok(await api('Reporter2', route, 'POST', { approved: true }), 403);
    ok(await api('Reporter', route, 'POST', { approved: false, notes: 'QA ispravka teksta' }));
    assert.equal((await models.Video.findById(f.finalVideo._id)).qcStatus, 'failed');
    ok(await api('Reporter', route, 'POST', { approved: true }));
    assert.equal((await models.EditJob.findById(f.jobs[0]._id)).status, 'approved');
    assert.equal((await models.Video.findById(f.finalVideo._id)).broadcastStatus, 'approved_for_air');
    ok(await api('Realizator', `/api/videos/${id(f.finalVideo)}/qc`, 'PATCH', { qcStatus: 'passed' }), 403);
  });
  await test('F12-rundown', 'Producer adds, rejects duplicate and reorders; Realizator cannot add', async () => {
    assert.ok(f.finalVideo);
    const route = `/api/broadcast/show-day/${id(f.show)}/items`;
    const payload = { videoId: id(f.finalVideo), contentTypeId: id(f.categories.prilog) };
    ok(await api('Realizator', route, 'POST', payload), 403);
    const added = await api('Producer', route, 'POST', payload); ok(added, 201);
    ok(await api('Producer', route, 'POST', payload), 409);
    const active = added.data.showDay.items.filter((item) => item.status !== 'removed');
    const order = active.map(id).reverse();
    const reorder = await api('Producer', `${route}/reorder`, 'PATCH', { itemIds: order }); ok(reorder);
    assert.deepEqual(reorder.data.showDay.items.filter((item) => item.status !== 'removed').sort((a, b) => a.order - b.order).map(id), order);
    f.rundownItem = active.find((item) => id(item.video) === id(f.finalVideo));
  });
  await test('F13-F15-correction-final', 'Realizator timestamp -> assigned correction -> real new final -> Producer replacement resolves', async () => {
    assert.ok(f.rundownItem);
    const itemRoute = `/api/broadcast/show-day/${id(f.show)}/items/${id(f.rundownItem)}`;
    const report = await api('Realizator', `${itemRoute}/report-error`, 'POST', { note: 'QA audio greška', timestamp: 2.5 }); ok(report);
    const correction = await models.CorrectionRequest.findOne({ video: f.finalVideo._id, status: { $in: ['reported', 'assigned', 'in_edit', 'ready_for_review'] } });
    assert.ok(correction?.correctionJob);
    assert.equal(String(correction.assignedEditor), id(f.users.Editor));
    assert.equal(correction.timestamp, 2.5);
    const fields = { programId: id(f.program), contentTypeId: id(f.categories.prilog), airDate: new Date().toISOString().slice(0, 10), finalTitle: 'QA ispravljeni final' };
    const uploaded = await api('Editor', `/api/edit-jobs/${id(correction.correctionJob)}/final-upload`, 'POST', multipart(fields, 'finalVideo', f.source)); ok(uploaded, 202);
    const corrected = await completed(uploaded.data.video._id);
    assert.equal((await models.CorrectionRequest.findById(correction._id)).status, 'ready_for_review');
    ok(await api('Producer', `/api/broadcast/final-videos/${id(corrected)}/approve`, 'POST', { approved: true }));
    ok(await api('Producer', `${itemRoute}/replace`, 'PATCH', { videoId: id(corrected), contentTypeId: id(f.categories.prilog) }));
    const resolved = await models.CorrectionRequest.findById(correction._id);
    assert.equal(resolved.status, 'resolved');
    assert.equal(String(resolved.correctedBy), id(f.users.Editor));
    assert.equal(String(resolved.resolvedBy), id(f.users.Producer));
    assert.equal((await models.Video.findById(f.finalVideo._id)).correctionStatus, 'resolved');
  });
  await test('F13-airing', 'Air package and confirm aired work; Producer cannot mark aired', async () => {
    const route = `/api/broadcast/show-day/${id(f.show)}`;
    ok(await api('Producer', `${route}/mark-aired`, 'POST'), 403);
    const ticket = await api('Realizator', '/api/downloads/tickets', 'POST', { kind: 'air-package', payload: { showDayId: id(f.show) } }); ok(ticket, 201);
    ok(await api(null, ticket.data.downloadUrl));
    const response = await api('Realizator', `${route}/mark-aired`, 'POST'); ok(response);
    assert.ok(response.data.showDay.airedAt);
    assert.ok(await models.AuditLog.exists({ action: 'Confirm Show Aired', performedBy: f.users.Realizator._id }));
  });
  await test('F14-archive-metadata', 'Archive tags, category and review preserve prefix search and actor', async () => {
    const route = `/api/archive/videos/${id(f.videos[9])}`;
    ok(await api('Archivist', `${route}/tags`, 'PATCH', { add: ['Kontrolisani vokabular', 'Banjalučki insert'] }));
    ok(await api('Archivist', `${route}/content-type`, 'PATCH', { contentTypeId: id(f.categories.promo) }));
    ok(await api('Archivist', `${route}/review`, 'PATCH', { status: 'reviewed', notes: 'QA pregled' }));
    const video = await models.Video.findById(f.videos[9]._id).select('+searchPrefixes');
    assert.equal(String(video.archiveReviewedBy), id(f.users.Archivist));
    assert.ok(video.searchPrefixes.includes('banja'));
    assert.equal(video.finalCategory, 'promo');
  });
  await test('F18-admin-users', 'Admin user create, role update and password reset authenticate correctly', async () => {
    const create = await api('Admin', '/api/admin/users', 'POST', { username: 'qa_new_user', password: qa.password, role: 'Reporter' }); ok(create, 201);
    const user = await models.User.findOne({ username: 'qa_new_user' }); assert.ok(user);
    ok(await api('Admin', `/api/admin/users/${id(user)}`, 'PUT', { username: 'qa_new_user', role: 'Editor' }));
    ok(await api('Admin', `/api/admin/users/${id(user)}/reset-password`, 'PUT', { newPassword: qa.password + 'reset' }));
    const login = await api(null, '/api/auth/login', 'POST', { username: 'qa_new_user', password: qa.password + 'reset' }); ok(login);
    assert.equal(login.data.user.role, 'Editor');
  });
  await test('F21-profiles', 'Preview profile boundaries, NVENC gate and precise version increments', async () => {
    const settings = (await api('Admin', '/api/admin/ffmpeg-settings')).data;
    for (const update of [{ mp4PreviewEncoder: 'libx265' }, { mp4PreviewVideoBitrate: 499 }, { mp4PreviewVideoBitrate: 8001 }, { hlsSegmentDuration: 3 }, { scrubFrameCount: 25 }, { scrubFrameCount: 5 }, { thumbnailResolution: '1920x1080' }, { thumbnailJpegQuality: 9 }]) {
      ok(await api('Admin', '/api/admin/ffmpeg-settings', 'PUT', update), 400);
    }
    ok(await api('Admin', '/api/admin/ffmpeg-settings', 'PUT', { hlsEncoder: 'h264_nvenc' }), 409);
    const changed = await api('Admin', '/api/admin/ffmpeg-settings', 'PUT', { scrubFrameCount: 6 }); ok(changed);
    assert.equal(changed.data.settings.scrubProfileVersion, settings.scrubProfileVersion + 1);
    assert.equal(changed.data.settings.hlsProfileVersion, settings.hlsProfileVersion);
    const same = await api('Admin', '/api/admin/ffmpeg-settings', 'PUT', { scrubFrameCount: 6 }); ok(same);
    assert.equal(same.data.settings.scrubProfileVersion, changed.data.settings.scrubProfileVersion);
    ok(await api('Admin', '/api/admin/ffmpeg-settings', 'PUT', { scrubFrameCount: settings.scrubFrameCount }));
  });
  await test('F17-feedback-triage', 'Submit, seen, internal comment and admin response are scoped correctly', async () => {
    const response = await api('Reporter', '/api/feedback', 'POST', { title: 'QA druga prijava', description: 'Dovoljno detaljan opis problema.', type: 'bug', area: 'archive' }); ok(response, 201);
    const feedback = await models.Feedback.findOne({ title: 'QA druga prijava' }); assert.ok(feedback);
    ok(await api('Admin2', `/api/feedback/${id(feedback)}/seen`, 'POST'));
    ok(await api('Admin2', `/api/feedback/${id(feedback)}/comments`, 'POST', { body: 'Interna provjera' }), 201);
    ok(await api('Admin', `/api/feedback/${id(feedback)}`, 'PATCH', { status: 'reviewing', priority: 'high', assignedTo: id(f.users.Admin2), adminResponse: 'Provjera u toku' }));
    const mine = await api('Reporter', '/api/feedback/workspace'); ok(mine);
    assert.ok(!('comments' in mine.data.items.find((item) => item._id === id(feedback))));
    ok(await api('Reporter', `/api/feedback/${id(feedback)}/comments`, 'POST', { body: 'Nije admin' }), 403);
  });
  await test('F16-negative-tickets', 'Invalid kind, private status, expired ticket and missing video fail clearly', async () => {
    ok(await api('Editor', '/api/downloads/tickets', 'POST', { kind: 'unknown' }), 400);
    const ticket = await api('Editor', '/api/downloads/tickets', 'POST', { kind: 'video-single', payload: { videoId: id(f.videos[0]) } }); ok(ticket, 201);
    ok(await api('Reporter2', `/api/downloads/tickets/${ticket.data.ticketId}/status`), 403);
    await models.DownloadTicket.updateOne({ _id: ticket.data.ticketId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    ok(await api(null, ticket.data.downloadUrl), 410);
    const missing = await api('Editor', '/api/downloads/tickets', 'POST', { kind: 'video-single', payload: { videoId: '000000000000000000000000' } }); ok(missing, 201);
    ok(await api(null, missing.data.downloadUrl), 404);
    await delay(100);
    const status = await api('Editor', `/api/downloads/tickets/${missing.data.ticketId}/status`); ok(status);
    assert.equal(status.data.status, 'failed');
  });
  await test('F20-audit-delete', 'Filtered audit deletion preserves unrelated history and records actor', async () => {
    await models.AuditLog.create({ action: 'QA disposable log', performedBy: f.users.Admin._id, details: { label: 'Čćžšđ' } });
    const count = await models.AuditLog.countDocuments();
    const response = await api('Admin', '/api/admin/audit-logs', 'DELETE', { action: 'QA disposable log' }); ok(response);
    assert.equal(response.data.deletedCount, 1);
    assert.equal(await models.AuditLog.countDocuments(), count);
    assert.ok(await models.AuditLog.exists({ action: 'Delete Audit Logs', performedBy: f.users.Admin._id }));
  });
  await test('F20-audit-large', 'Audit total, last page and text search include records beyond the old scan cap', async () => {
    const before = await models.AuditLog.countDocuments();
    for (let start = 0; start < 12000; start += 1000) {
      await models.AuditLog.collection.insertMany(Array.from({ length: 1000 }, (_, offset) => ({ action: 'QA large log', performedBy: f.users.Admin._id, timestamp: new Date(946684800000 - start - offset), details: { label: start + offset === 11999 ? 'Čćžšđ stari zapis' : 'QA pregled' } })));
    }
    const response = await api('Admin', '/api/admin/audit-logs/workspace?limit=30'); ok(response);
    assert.equal(response.data.total, before + 12000);
    assert.equal(response.data.items.length, 30);
    const last = await api('Admin', `/api/admin/audit-logs/workspace?limit=30&page=${response.data.totalPages}`); ok(last);
    assert.ok(last.data.items.length > 0);
    const search = await api('Admin', '/api/admin/audit-logs/workspace?q=' + encodeURIComponent('Čćžšđ stari zapis')); ok(search);
    assert.equal(search.data.total, 1);
  });
  await test('F22-retention-validity', 'Retention refuses damaged HLS and cross-field shared fallback files', async () => {
    const video = await models.Video.findById(f.videos[1]._id);
    const { paths } = qa.load('utils/storagePaths');
    const preview = path.join(paths.previews, 'retention-copy.mp4'); fs.copyFileSync(f.source, preview);
    video.previewPath = preview; await video.save();
    const hls = qa.load('services/hlsPreviewService');
    const variant = fs.readFileSync(path.join(hls.getActiveHlsFolder(video), '720p/index.m3u8'), 'utf8');
    const segment = variant.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
    const segmentPath = path.join(hls.getActiveHlsFolder(video), '720p', segment);
    fs.renameSync(segmentPath, segmentPath + '.held');
    try {
      const scan = await api('Admin', '/api/admin/preview-retention/scan', 'POST', { videoIds: [id(video)] }); ok(scan);
      assert.equal(scan.data.result.eligibleCount, 0, 'Broken HLS accepted for retention cleanup');
    } finally { fs.renameSync(segmentPath + '.held', segmentPath); }
  });
  await test('F18-shared-delete', 'Admin and owner deletion never unlink another video shared media or external file', async () => {
    for (const route of ['/api/admin/videos/', '/api/videos/', '/api/archive/videos/']) {
      const template = f.videos[98].toObject(); delete template._id;
      const duplicate = await models.Video.create({ ...template, filename: 'qa-shared-alias.mp4' });
      ok(await api('Admin', route + id(duplicate) + (route.includes('/archive/') ? '/duplicate' : ''), 'DELETE', route.includes('/archive/') ? { duplicateOf: id(f.videos[98]), reason: 'QA zajednički fajl' } : undefined));
      assert.ok(fs.existsSync(f.videos[98].filepath), `${route} destroyed shared master`);
      assert.ok(fs.existsSync(f.videos[98].thumbnailPath), `${route} destroyed shared thumbnail`);
      assert.ok(await models.Video.exists({ _id: f.videos[98]._id }));
    }
    const template = f.videos[98].toObject(); delete template._id;
    const external = await models.Video.create({ ...template, filepath: path.join(qa.runtime, 'package.json'), compressedPath: null, thumbnailPath: null });
    ok(await api('Admin', '/api/admin/videos/' + id(external), 'DELETE'));
    assert.ok(fs.existsSync(path.join(qa.runtime, 'package.json')), 'External application file deleted');
  });
  await test('F18-video-updates', 'Admin changes owner/category and retries failed processing without bypassing ownership', async () => {
    const video = await models.Video.findById(f.videos[90]._id);
    ok(await api('Admin', `/api/admin/videos/${id(video)}/owner`, 'PATCH', { uploaderId: id(f.users.Reporter2) }));
    assert.equal(String((await models.Video.findById(video._id)).uploader), id(f.users.Reporter2));
    ok(await api('Admin', `/api/admin/videos/${id(video)}/content-type`, 'PATCH', { contentTypeId: id(f.categories.insert) }));
    assert.equal((await models.Video.findById(video._id)).finalCategory, 'insert');
    const { paths } = qa.load('utils/storagePaths');
    const retrySource = path.join(paths.raw, 'qa-retry-source.mp4'); fs.copyFileSync(f.source, retrySource);
    await models.Video.updateOne({ _id: video._id }, { $set: { processingStatus: 'failed', processingError: 'QA retry', rawPath: retrySource } });
    ok(await api('Reporter', `/api/videos/${id(video)}/requeue-processing`, 'POST'), 403);
    ok(await api('Admin', `/api/videos/${id(video)}/requeue-processing`, 'POST'), 202);
    const processed = await completed(video._id); assert.ok(fs.existsSync(processed.thumbnailPath));
    const missing = await models.Video.create({ filename: 'qa-missing.mp4', filepath: path.join(qa.runtime, 'absent.mp4'), uploader: f.users.Admin._id, processingStatus: 'failed' });
    ok(await api('Admin', `/api/videos/${id(missing)}/requeue-processing`, 'POST'), 400);
  });
  await test('F19-programs', 'Admin creates/disables programs and edits category SLA; non-admin mutations denied', async () => {
    const response = await api('Admin', '/api/admin/broadcast-programs', 'POST', { name: 'QA specijal', defaultTime: '18:00', daysOfWeek: [1, 3] }); ok(response, 201);
    ok(await api('Reporter', '/api/admin/broadcast-programs', 'POST', { name: 'Neovlašteno' }), 403);
    ok(await api('Admin', `/api/admin/broadcast-programs/${id(response.data.program)}`, 'PUT', { name: 'QA specijal', active: false }));
    assert.equal((await models.BroadcastProgram.findById(response.data.program._id)).active, false);
    const category = await api('Admin', '/api/admin/broadcast-content-types', 'POST', { name: 'QA test kategorija', slug: 'qa-test-kategorija', jobSlaHours: 6, jobGraceHours: 2 }); ok(category, 201);
    ok(await api('Admin', `/api/admin/broadcast-content-types/${id(category.data.type)}`, 'PUT', { name: 'QA test kategorija', slug: 'qa-test-kategorija', jobSlaHours: 12, jobGraceHours: 3 }));
    const type = await models.BroadcastContentType.findById(category.data.type._id); assert.equal(type.jobSlaHours, 12); assert.equal(type.jobGraceHours, 3);
  });
  await test('F22-junction-safety', 'Video deletion and retention refuse junction paths outside allowed media folders', async () => {
    if (process.platform !== 'win32') return { status: 'blocked', reason: 'Windows junction scenario' };
    const { paths } = qa.load('utils/storagePaths');
    const outside = path.join(qa.runtime, 'outside-media'); fs.mkdirSync(outside);
    const sentinel = path.join(outside, 'sentinel.mp4'); fs.copyFileSync(f.source, sentinel);
    const link = path.join(paths.raw, 'qa-junction');
    fs.symlinkSync(outside, link, 'junction');
    const linked = path.join(link, 'sentinel.mp4');
    const video = await models.Video.create({ filename: 'qa-junction.mp4', filepath: linked, uploader: f.users.Admin._id, status: 'edited', processingStatus: 'completed' });
    ok(await api('Archivist', `/api/archive/videos/${id(video)}/duplicate`, 'DELETE', { duplicateOf: id(f.videos[98]), reason: 'QA junction safety' }));
    assert.ok(fs.existsSync(sentinel));
  });
};
