const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

test('device QA stop signal validates run id, root marker and device ownership', () => {
  const root = path.resolve(__dirname, '../..');
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const runtime = path.join(root, '.qa-runtime', runId);
  const evidence = path.join(root, 'analysis/qa', runId);
  assert.ok(!fs.existsSync(runtime) && !fs.existsSync(evidence));
  fs.mkdirSync(runtime, { recursive: true }); fs.mkdirSync(evidence, { recursive: true });
  const marker = path.join(runtime, 'qa-marker.json');
  const device = path.join(evidence, 'device-qa.json');
  const signal = path.join(runtime, 'assist-stop.json');
  const run = (id) => spawnSync(process.execPath, [path.join(root, 'scripts/qa/stopAssist.js'), '--run=' + id], { cwd: root, windowsHide: true, encoding: 'utf8' });
  try {
    fs.writeFileSync(marker, JSON.stringify({ runId, root: runtime }));
    fs.writeFileSync(device, JSON.stringify({ runId }));
    assert.notEqual(run('../outside').status, 0);
    assert.equal(run(runId).status, 0);
    assert.ok(fs.existsSync(signal)); fs.unlinkSync(signal);
    fs.writeFileSync(marker, JSON.stringify({ runId, root: root }));
    assert.notEqual(run(runId).status, 0); assert.equal(fs.existsSync(signal), false);
    fs.writeFileSync(marker, JSON.stringify({ runId, root: runtime }));
    fs.writeFileSync(device, JSON.stringify({ runId: 'different' }));
    assert.notEqual(run(runId).status, 0); assert.equal(fs.existsSync(signal), false);
  } finally {
    for (const file of [marker, signal, device]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(runtime); fs.rmdirSync(evidence);
  }
});
