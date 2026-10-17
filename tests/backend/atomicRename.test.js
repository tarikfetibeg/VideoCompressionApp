const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renameWithRetry } = require('../../backend/utils/atomicRename');

test('retries temporary handle errors without changing destination', async () => {
  let calls = 0;
  await renameWithRetry('building', 'active', {
    rename: async (source, destination) => {
      assert.equal(source, 'building'); assert.equal(destination, 'active');
      if (++calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    }, wait: async () => {},
  });
  assert.equal(calls, 3);
});

test('never hides persistent or non-transient errors', async () => {
  for (const code of ['EPERM', 'ENOENT']) {
    let calls = 0;
    await assert.rejects(renameWithRetry('building', 'active', {
      attempts: 2, rename: async () => { calls += 1; throw Object.assign(new Error(code), { code }); }, wait: async () => {},
    }), { code });
    assert.equal(calls, code === 'EPERM' ? 2 : 1);
  }
});
