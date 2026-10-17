const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { inspectStorageFile, unlinkStorageFile } = require('../../backend/utils/storageFileSafety');

test('regular-file deletion requires a valid root and never follows outside junctions', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'avc-qa-safety-'));
  const root = path.join(folder, 'media'); const outside = path.join(folder, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside);
  const file = path.join(root, 'safe.txt'); const sentinel = path.join(outside, 'sentinel.txt');
  fs.writeFileSync(file, 'safe'); fs.writeFileSync(sentinel, 'preserve');
  const link = path.join(root, 'link');
  try {
    assert.equal((await unlinkStorageFile(sentinel, [root])).safe, false);
    assert.ok(fs.existsSync(sentinel));
    assert.equal((await inspectStorageFile(path.join(folder, 'absent', 'missing.txt'), [path.join(folder, 'absent')])).safe, false);
    if (process.platform === 'win32') {
      fs.symlinkSync(outside, link, 'junction');
      assert.equal((await inspectStorageFile(path.join(link, 'sentinel.txt'), [root])).safe, false);
      assert.equal((await inspectStorageFile(path.join(link, 'missing.txt'), [root])).safe, false);
      assert.ok(fs.existsSync(sentinel));
    }
    assert.equal((await unlinkStorageFile(file, [root])).deleted, true);
    assert.equal((await inspectStorageFile(file, [root])).exists, false);
  } finally {
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) fs.rmdirSync(link);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.unlinkSync(sentinel); fs.rmdirSync(root); fs.rmdirSync(outside); fs.rmdirSync(folder);
  }
});
