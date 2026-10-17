const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  const { paths, createRawManifestPath } = qa.load('utils/storagePaths');
  const ok = (response, status = 200) => assert.equal(response.status, status, `HTTP ${response.status}: ${response.data?.message || 'unexpected response'}`);
  async function raw(file, extra = {}) {
    const data = f.videos[0].toObject(); delete data._id; delete data.__v;
    return qa.models.Video.create({ ...data, rawPath: file, rawDeleted: false, rawExpiresAt: new Date(Date.now() - 1000), ...extra });
  }
  const copy = (folder, name, source = f.source) => { fs.mkdirSync(folder, { recursive: true }); const file = path.join(folder, name); fs.copyFileSync(source, file); return file; };
  await test('MAINT-raw-outside', 'Raw cleanup never deletes outside-media paths or marks them deleted', async () => {
    const file = copy(path.join(qa.runtime, 'outside-media'), 'sentinel.mp4');
    const video = await raw(file);
    ok(await qa.api('Admin', '/api/admin/cleanup-raw', 'POST', {}));
    assert.ok(fs.existsSync(file), 'Outside storage sentinel must survive');
    assert.equal((await qa.models.Video.findById(video._id)).rawDeleted, false);
  });
  await test('MAINT-raw-active', 'Expired processing input remains available for completion/retry', async () => {
    const file = copy(paths.raw, 'qa-still-processing.mp4');
    const video = await raw(file, { processingStatus: 'processing' });
    ok(await qa.api('Admin', '/api/admin/cleanup-raw', 'POST', {}));
    assert.ok(fs.existsSync(file), 'Active processing source must survive');
    assert.equal((await qa.models.Video.findById(video._id)).rawDeleted, false);
  });
  await test('MAINT-raw-shared', 'Raw retention preserves another video reference while deleting an independent expired original', async () => {
    const shared = copy(paths.raw, 'qa-shared-original.mp4');
    const video = await raw(shared);
    const other = f.videos[0].toObject(); delete other._id; delete other.__v;
    await qa.models.Video.create({ ...other, filepath: shared, compressedPath: shared });
    const disposable = copy(paths.raw, 'qa-expired-independent.mp4');
    const removable = await raw(disposable);
    ok(await qa.api('Admin', '/api/admin/cleanup-raw', 'POST', {}));
    assert.ok(fs.existsSync(shared)); assert.equal((await qa.models.Video.findById(video._id)).rawDeleted, false);
    assert.equal(fs.existsSync(disposable), false); assert.equal((await qa.models.Video.findById(removable._id)).rawDeleted, true);
  });
  await test('MAINT-raw-master', 'An expired rawPath that is also the active master is always preserved', async () => {
    const file = copy(paths.compressed, 'qa-active-master.mp4');
    const video = await raw(file, { filepath: file, compressedPath: file, processingMode: 'finalize', status: 'edited' });
    const response = await qa.api('Admin', '/api/admin/cleanup-raw', 'POST', {}); ok(response);
    assert.ok(fs.existsSync(file)); assert.equal((await qa.models.Video.findById(video._id)).rawDeleted, false);
    assert.ok(response.data.result.skippedDetails.some((item) => String(item.videoId) === String(video._id) && item.reason === 'active master or fallback'));
  });
  async function offJob(file, title) {
    return qa.models.EditJob.create({ title, reporter: f.users.Reporter._id, offFiles: [{ originalName: 'QA OFF.wav', filename: path.basename(file), storagePath: file, size: fs.statSync(file).size }] });
  }
  await test('MAINT-off-shared', 'Admin OFF removal and job deletion preserve other job references', async () => {
    const file = copy(paths.offAudio, 'qa-shared-off.wav', f.off);
    const first = await offJob(file, 'QA prvi OFF'); const second = await offJob(file, 'QA drugi OFF');
    ok(await qa.api('Admin', `/api/admin/off-files/${first._id}/${first.offFiles[0]._id}`, 'DELETE'));
    assert.ok(fs.existsSync(file)); assert.equal((await qa.models.EditJob.findById(second._id)).offFiles.length, 1);
    const third = await offJob(file, 'QA treći OFF');
    ok(await qa.api('Admin', `/api/edit-jobs/${third._id}`, 'DELETE'));
    assert.ok(fs.existsSync(file));
    ok(await qa.api('Admin', `/api/edit-jobs/${second._id}`, 'DELETE'));
    assert.equal(fs.existsSync(file), false);
  });
  await test('MAINT-off-junction', 'OFF maintenance rejects a junction to a file outside OFF storage', async () => {
    if (process.platform !== 'win32') return { status: 'blocked', reason: 'Windows junction scenario' };
    const folder = path.join(qa.runtime, 'outside-off'); const file = copy(folder, 'sentinel.wav', f.off);
    const link = path.join(paths.offAudio, 'qa-off-junction'); fs.symlinkSync(folder, link, 'junction');
    const job = await offJob(path.join(link, 'sentinel.wav'), 'QA OFF junction');
    ok(await qa.api('Admin', `/api/admin/off-files/${job._id}/${job.offFiles[0]._id}`, 'DELETE'), 400);
    assert.ok(fs.existsSync(file));
  });
  await test('MAINT-manifest-traversal', 'Encoded manifest traversal is rejected without deleting an unrelated valid file', async () => {
    const file = path.join(paths.rawManifests, 'qa-safe-manifest.json'); fs.writeFileSync(file, '{}');
    ok(await qa.api('Admin', '/api/admin/raw-manifests/' + encodeURIComponent('../qa-safe-manifest.json'), 'DELETE'), 400);
    assert.ok(fs.existsSync(file));
  });
  await test('MAINT-orphan-recovery', 'Raw orphan import recovers metadata/ownership and produces a usable master', async () => {
    const source = f.videos[0].toObject(); delete source._id; delete source.__v;
    await qa.models.Video.create({ ...source, filepath: f.source, compressedPath: f.source });
    const file = copy(paths.raw, 'raw_123_456_qa-recovered.mp4');
    fs.writeFileSync(createRawManifestPath(file), JSON.stringify({ originalFilename: 'Špica recovery.mp4', uploaderId: String(f.users.Reporter._id), event: 'QA recovered event', location: 'QA lokacija', tagDate: new Date().toISOString() }));
    const found = await qa.api('Admin', '/api/admin/raw-orphans'); ok(found);
    assert.ok(found.data.files.some((item) => item.filename === path.basename(file)));
    const response = await qa.api('Admin', '/api/admin/raw-orphans/import', 'POST', {}); ok(response, 201);
    const imported = response.data.result.imported.find((item) => item.filename === path.basename(file)); assert.ok(imported);
    const until = Date.now() + 120000; let video;
    while (Date.now() < until) {
      video = await qa.models.Video.findById(imported.videoId);
      if (video.processingStatus === 'completed') break;
      if (video.processingStatus === 'failed') throw new Error('Recovery processing: ' + video.processingError);
      await delay(300);
    }
    assert.equal(video.processingStatus, 'completed'); assert.equal(video.event, 'QA recovered event');
    assert.equal(String(video.uploader), String(f.users.Reporter._id)); assert.ok(fs.existsSync(video.compressedPath));
  });
};
