const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.JWT_SECRET = 'isolated-login-unit-test-only';
const User = require('../../backend/models/User');
const router = require('../../backend/routes/auth');

test('unavailable DB and malformed credentials have distinct errors without DB access', async () => {
  const app = express(); app.use(express.json()); app.use('/auth', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/auth/login`;
  const oldDb = User.db;
  try {
    User.db = { readyState: 0 };
    const missing = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(missing.status, 400); assert.equal((await missing.json()).code, 'AUTH_INVALID_INPUT');
    const outage = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-only', password: 'qa-only' }) });
    assert.equal(outage.status, 503); assert.equal((await outage.json()).code, 'DATABASE_UNAVAILABLE');
  } finally {
    User.db = oldDb;
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  }
});
