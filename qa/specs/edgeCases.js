const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const archiver = require('archiver');
const parser = require('../../frontend/node_modules/@babel/parser');

function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => walk(item, visitor));
    else if (value && typeof value === 'object') walk(value, visitor);
  }
}

module.exports = async (qa, f, test) => {
  const id = (value) => String(value._id || value);
  const ok = (response, status = 200) => assert.equal(response.status, status, `HTTP ${response.status}: ${response.data?.message || 'unexpected response'}`);
  await test('EDGE-all-guest-routes', 'Every declared protected API rejects an unauthenticated request before mutation', async () => {
    const modules = new Map(); const mounts = new Map(); const matrix = [];
    const app = parser.parse(fs.readFileSync(path.join(qa.runtime, 'backend/app.js'), 'utf8'));
    walk(app, (node) => {
      if (node.type === 'VariableDeclarator' && node.init?.callee?.name === 'require' && node.init.arguments[0]?.value?.startsWith('./routes/')) modules.set(node.id.name, path.basename(node.init.arguments[0].value));
      if (node.type === 'CallExpression' && node.callee?.object?.name === 'app' && node.callee?.property?.name === 'use' && node.arguments[0]?.type === 'StringLiteral' && node.arguments[1]?.type === 'Identifier') mounts.set(node.arguments[1].name, node.arguments[0].value);
    });
    for (const [variable, module] of modules) {
      const prefix = mounts.get(variable); if (!prefix) continue;
      const routes = [];
      walk(parser.parse(fs.readFileSync(path.join(qa.runtime, 'backend/routes', module + '.js'), 'utf8')), (node) => {
        if (node.type === 'CallExpression' && node.callee?.object?.name === 'router' && ['get', 'post', 'put', 'patch', 'delete', 'head'].includes(node.callee?.property?.name) && node.arguments[0]?.type === 'StringLiteral') routes.push({ method: node.callee.property.name.toUpperCase(), route: node.arguments[0].value });
      });
      for (const item of routes) {
        if (module === 'auth' || (module === 'media' && ['GET', 'HEAD'].includes(item.method)) || (module === 'downloads' && item.route === '/tickets/:token')) continue;
        const route = prefix + item.route.replace(/:[A-Za-z]+/g, '000000000000000000000000').replace('*', 'master.m3u8');
        const response = await qa.api(null, route, item.method, ['GET', 'HEAD'].includes(item.method) ? undefined : {});
        matrix.push({ module, method: item.method, route: item.route, status: response.status });
        assert.equal(response.status, 401, `${item.method} ${prefix}${item.route} must require login, got ${response.status}`);
      }
    }
    fs.writeFileSync(path.join(qa.output, 'guest-route-matrix.json'), JSON.stringify(matrix, null, 2));
    assert.ok(matrix.length > 100); return { protectedRoutes: matrix.length };
  });
  await test('EDGE-private-legacy-file', 'A private legacy upload cannot bypass authentication through a static URL', async () => {
    const folder = path.join(qa.runtime, 'uploads'); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'qa-private-legacy.mp4'); fs.copyFileSync(f.source, file);
    const raw = f.videos[0].toObject(); delete raw._id; delete raw.__v;
    const video = await qa.models.Video.create({ ...raw, uploader: f.users.Reporter2._id, filepath: file, compressedPath: file, filename: 'qa-private-legacy.mp4' });
    ok(await qa.api(null, `/api/videos/download/${video._id}`), 401);
    const response = await qa.api(null, '/uploads/qa-private-legacy.mp4');
    assert.ok([401, 403, 404].includes(response.status), `Unauthenticated /uploads exposed ${response.bytes.length} bytes with HTTP ${response.status}`);
  });
  await test('EDGE-audit-inputs', 'Invalid audit actor/date filters are validation errors, never internal errors', async () => {
    for (const query of ['userId=not-an-id', 'dateFrom=not-a-date', 'dateTo=not-a-date', 'dateFrom=2030-01-01&dateTo=2020-01-01']) ok(await qa.api('Admin', '/api/admin/audit-logs/workspace?' + query), 400);
  });
  await test('EDGE-sla-selection', 'Invalid explicit SLA selection cannot silently update unrelated jobs', async () => {
    const job = await qa.models.EditJob.create({ title: 'QA legacy SLA sentinel', reporter: f.users.Reporter._id, contentType: f.categories.insert._id, status: 'submitted' });
    for (const jobIds of [[], ['bad-id'], [id(job), 'bad-id']]) {
      ok(await qa.api('Admin', '/api/edit-jobs/admin/apply-sla', 'POST', { jobIds }), 400);
      assert.equal((await qa.models.EditJob.findById(job._id)).expiresAt, undefined);
    }
    ok(await qa.api('Admin', '/api/edit-jobs/admin/apply-sla', 'POST', { jobIds: [id(job)] }));
    assert.ok((await qa.models.EditJob.findById(job._id)).expiresAt);
  });
  await test('EDGE-brief-formats', 'Actual DOCX/MD/RTF import, unsupported PDF and corrupt DOCX fail safely', async () => {
    const archive = archiver('zip'); const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => { archive.on('end', resolve); archive.on('error', reject); });
    archive.append('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>', { name: '[Content_Types].xml' });
    archive.append('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>', { name: '_rels/.rels' });
    archive.append('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Špica čćžšđ i brief</w:t></w:r></w:p></w:body></w:document>', { name: 'word/document.xml' });
    await archive.finalize(); await finished;
    for (const [filename, buffer, expected, text] of [
      ['brief.docx', Buffer.concat(chunks), 200, 'Špica čćžšđ'], ['brief.md', Buffer.from('# Špica\nBrief'), 200, 'Špica'],
      ['brief.rtf', Buffer.from('{\\rtf1\\ansi Kratki brief\\par Novi red}'), 200, 'Kratki brief'],
      ['brief.pdf', Buffer.from('%PDF-1.4 unsupported'), 400], ['broken.docx', Buffer.from('not a ZIP'), 400],
    ]) {
      const form = new FormData(); form.append('briefDocument', new Blob([buffer]), filename);
      const response = await qa.api('Reporter', '/api/edit-jobs/import-brief', 'POST', form); ok(response, expected);
      if (text) assert.ok(response.data.text.includes(text));
    }
  });
  await test('EDGE-job-lifecycle', 'Admin category/editor/deadline/priority transitions and safe deletion preserve unselected jobs', async () => {
    const job = await qa.models.EditJob.create({ title: 'QA lifecycle', reporter: f.users.Reporter._id, contentType: f.categories.insert._id });
    const route = `/api/edit-jobs/${job._id}/admin`;
    const deadline = new Date(Date.now() + 86400000).toISOString();
    ok(await qa.api('Admin', route, 'PATCH', { assignedEditorId: id(f.users.VideoEditor), deadline, contentTypeId: id(f.categories.promo), priority: 'urgent' }));
    const updated = await qa.models.EditJob.findById(job._id);
    assert.equal(id(updated.assignedEditor), id(f.users.VideoEditor)); assert.equal(updated.deadline.toISOString(), deadline); assert.equal(updated.priority, 'urgent');
    for (const fields of [{ status: 'invalid' }, { workspaceState: 'invalid' }, { priority: 'invalid' }, { deadline: 'bad-date' }, {}]) ok(await qa.api('Admin', route, 'PATCH', fields), 400);
    for (const workspaceState of ['closed', 'cancelled', 'active']) {
      ok(await qa.api('Admin', route, 'PATCH', { workspaceState, workspaceStateReason: 'QA audit' }));
      assert.equal((await qa.models.EditJob.findById(job._id)).workspaceState, workspaceState);
    }
    ok(await qa.api('Admin', `/api/edit-jobs/${job._id}`, 'DELETE'));
    assert.equal(await qa.models.EditJob.findById(job._id), null);
  });
  await test('EDGE-notification-pagination', 'Unread notifications page beyond first 20 and ownership/read-all remain correct', async () => {
    await qa.models.Notification.insertMany(Array.from({ length: 35 }, (_, index) => ({ recipient: f.users.Reporter._id, actor: f.users.Editor._id, job: f.jobs[0]._id, kind: 'edit_job_comment', title: 'QA komentar ' + index, commentId: new (require('mongoose').Types.ObjectId)(), expiresAt: new Date(Date.now() + 86400000) })));
    const first = await qa.api('Reporter', '/api/notifications/workspace?unreadOnly=true&page=1&limit=20'); ok(first);
    const second = await qa.api('Reporter', '/api/notifications/workspace?unreadOnly=true&page=2&limit=20'); ok(second);
    assert.equal(first.data.items.length, 20); assert.ok(second.data.items.length > 0);
    const seen = new Set(first.data.items.map(id)); assert.ok(second.data.items.every((item) => !seen.has(id(item))));
    ok(await qa.api('Reporter2', `/api/notifications/${first.data.items[0]._id}/read`, 'PATCH'), 404);
    ok(await qa.api('Reporter', '/api/notifications/read-all', 'PATCH'));
    assert.equal((await qa.api('Reporter', '/api/notifications/workspace')).data.unreadCount, 0);
  });
  await test('EDGE-storage-errors', 'Storage thresholds and rebuild input validation reject invalid/destructive requests', async () => {
    for (const body of [{ warningFreePercent: 5, criticalFreePercent: 10 }, { warningFreePercent: 101, criticalFreePercent: 10 }, { warningFreePercent: -1, criticalFreePercent: 0 }]) ok(await qa.api('Admin', '/api/admin/storage/settings', 'PUT', body), 400);
    for (const body of [{ assetTypes: ['unknown'], scope: 'missing', limit: 1 }, { assetTypes: ['hls'], scope: 'unknown', limit: 1 }]) ok(await qa.api('Admin', '/api/admin/media-previews/rebuild', 'POST', body), 400);
    ok(await qa.api('Reporter', '/api/admin/preview-retention/cleanup', 'POST', { limit: 1 }), 403);
  });
};
