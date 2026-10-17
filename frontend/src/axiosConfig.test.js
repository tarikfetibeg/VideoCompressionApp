import client from './axiosConfig';
import { cancelSession, isSessionPaused, pauseSession, resumeSession } from './utils/sessionRecovery';

// CRA/Jest does not transform the installed Axios ESM entrypoint.
jest.mock('axios', () => require(require.resolve('axios/package.json').replace(/package\.json$/, 'dist/browser/axios.cjs')));

const account = { id: 'reporter-1', username: 'reporter', role: 'Reporter', token: 'old-token' };
const success = async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: { ok: true } });
const denied = (config, code) => Promise.reject({ config, response: { status: 403, data: { code } } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { cancelSession(); localStorage.setItem('user', JSON.stringify(account)); });
afterEach(() => { cancelSession(); localStorage.clear(); });

test('expired GET waits for login and retries once with renewed token', async () => {
  client.defaults.adapter = jest.fn().mockImplementationOnce((config) => denied(config, 'AUTH_TOKEN_EXPIRED')).mockImplementation(success);
  const response = client.get('/videos/workspace');
  await tick();
  expect(isSessionPaused()).toBe(true);
  expect(client.defaults.adapter).toHaveBeenCalledTimes(1);
  localStorage.setItem('user', JSON.stringify({ ...account, token: 'new-token' }));
  resumeSession();
  await expect(response).resolves.toMatchObject({ data: { ok: true } });
  expect(client.defaults.adapter.mock.calls[1][0].headers.Authorization).toBe('Bearer new-token');
});

test('permission 403 does not pause the session', async () => {
  client.defaults.adapter = jest.fn((config) => denied(config, 'FORBIDDEN'));
  await expect(client.get('/admin/users')).rejects.toBeDefined();
  expect(isSessionPaused()).toBe(false);
});

test('expired write is never replayed', async () => {
  client.defaults.adapter = jest.fn((config) => denied(config, 'AUTH_TOKEN_EXPIRED'));
  await expect(client.post('/edit-jobs', { title: 'Nacrt' })).rejects.toBeDefined();
  expect(isSessionPaused()).toBe(true);
  resumeSession();
  expect(client.defaults.adapter).toHaveBeenCalledTimes(1);
});

test('paused writes are rejected before network; login remains available', async () => {
  client.defaults.adapter = jest.fn(success);
  pauseSession();
  await expect(client.delete('/videos/one')).rejects.toMatchObject({ code: 'SESSION_REAUTH_REQUIRED' });
  expect(client.defaults.adapter).not.toHaveBeenCalled();
  await client.post('/auth/login', { username: 'reporter', password: 'test' });
  expect(client.defaults.adapter.mock.calls[0][0].headers.Authorization).toBeUndefined();
});

test('queued GET cancellation releases its waiter without a network request', async () => {
  client.defaults.adapter = jest.fn(success);
  pauseSession();
  const abort = new AbortController();
  const request = client.get('/videos/workspace', { signal: abort.signal });
  const assertion = expect(request).rejects.toBeDefined();
  await tick();
  abort.abort();
  await assertion;
  resumeSession();
  expect(client.defaults.adapter).not.toHaveBeenCalled();
});

test('late expiry response from old token does not invalidate a renewed session', async () => {
  let finish;
  client.defaults.adapter = jest.fn().mockImplementationOnce((config) => new Promise((resolve, reject) => {
    finish = () => reject({ config, response: { status: 403, data: { code: 'AUTH_TOKEN_EXPIRED' } } });
  })).mockImplementation(success);
  const request = client.get('/videos/workspace');
  await tick();
  localStorage.setItem('user', JSON.stringify({ ...account, token: 'new-token' }));
  finish();
  await request;
  expect(isSessionPaused()).toBe(false);
  expect(client.defaults.adapter).toHaveBeenCalledTimes(2);
});
