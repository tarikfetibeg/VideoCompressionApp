const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-auth-unit-test-only';
const authenticate = require('../../backend/middleware/authenticateToken');

function call(token) {
  const state = {};
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = { status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; } };
  authenticate(req, res, () => { state.next = true; });
  return { ...state, user: req.user };
}

test('missing/invalid/expired tokens keep HTTP statuses and expose distinct codes', () => {
  assert.deepEqual(call().body, { code: 'AUTH_TOKEN_MISSING', message: 'Prijava je potrebna.' });
  assert.equal(call().status, 401);
  assert.equal(call('invalid').body.code, 'AUTH_TOKEN_INVALID');
  assert.equal(call('invalid').status, 403);
  const expired = jwt.sign({ id: 'one', role: 'Reporter' }, process.env.JWT_SECRET, { expiresIn: -1 });
  assert.equal(call(expired).body.code, 'AUTH_TOKEN_EXPIRED');
  assert.equal(call(expired).status, 403);
});

test('valid token still reaches the original permission checks', () => {
  const valid = jwt.sign({ id: 'one', role: 'Reporter' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal(call(valid).next, true);
  assert.equal(call(valid).user.id, 'one');
});
