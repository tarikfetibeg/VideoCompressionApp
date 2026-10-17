import { bindSessionIdentity, cancelSession, canPollSession, ensureSessionIdentity, isSessionPaused, pauseSession, readStoredUser, resumeSession } from './sessionRecovery';

afterEach(() => { cancelSession(); localStorage.clear(); });

test.each(['broken-json', '"text"', '[]', '{}', '{"role":"Admin"}', '{"id":"one","username":"one","role":"unknown","token":"invalid"}'])('invalid stored user is never interpreted as a logged-in account: %s', (value) => {
  localStorage.setItem('user', value);
  expect(readStoredUser()).toBeNull();
});

test('pollers pause until explicit login resumes the session', () => {
  expect(canPollSession()).toBe(true);
  pauseSession(); expect(canPollSession()).toBe(false);
  resumeSession(); expect(canPollSession()).toBe(true);
});

test('changing stored account blocks requests under the old mounted identity', () => {
  bindSessionIdentity({ id: 'one', role: 'Reporter' });
  localStorage.setItem('user', JSON.stringify({ id: 'other', role: 'Editor', username: 'other', token: 'other-token' }));
  ensureSessionIdentity(); expect(isSessionPaused()).toBe(true);
});
