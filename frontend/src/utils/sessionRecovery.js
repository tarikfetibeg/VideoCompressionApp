const listeners = new Set();
const waiters = new Set();
let paused = false;
let pauseReason = null;
let identity = null;
const roles = new Set(['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']);

export const readStoredUser = () => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user && !Array.isArray(user) && user.id && typeof user.username === 'string'
      && roles.has(user.role) && typeof user.token === 'string' && user.token ? user : null;
  } catch (_) { return null; }
};

export const isSessionPaused = () => paused;
export const canPollSession = () => !paused && !document.hidden;
export const bindSessionIdentity = (user) => { identity = user ? { id: String(user.id), role: user.role } : null; };
export const ensureSessionIdentity = () => {
  const current = readStoredUser();
  if (identity && (!current || String(current.id) !== identity.id || current.role !== identity.role)) pauseSession('identity_changed');
};

export const subscribeSession = (listener) => {
  listeners.add(listener);
  listener(paused, pauseReason);
  return () => listeners.delete(listener);
};

export const pauseSession = (reason = 'expired') => {
  if (paused && (pauseReason === 'identity_changed' || pauseReason === reason)) return;
  paused = true;
  pauseReason = reason;
  listeners.forEach((listener) => listener(true, reason));
};

export const sessionError = (code = 'SESSION_REAUTH_REQUIRED') => {
  const error = new Error(code === 'SESSION_CANCELLED'
    ? 'Prijava je prekinuta.'
    : 'Sesija je istekla. Nakon ponovne prijave ponovi ovu akciju.');
  error.code = code;
  return error;
};

export const waitForSession = (signal) => {
  if (!paused) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(sessionError('ERR_CANCELED'));
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      waiters.delete(finish);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(sessionError('ERR_CANCELED'));
    waiters.add(finish);
    signal?.addEventListener('abort', abort, { once: true });
  });
};

export const resumeSession = () => {
  paused = false;
  pauseReason = null;
  listeners.forEach((listener) => listener(false));
  [...waiters].forEach((finish) => finish());
};

export const cancelSession = () => {
  paused = false;
  pauseReason = null;
  identity = null;
  listeners.forEach((listener) => listener(false));
  [...waiters].forEach((finish) => finish(sessionError('SESSION_CANCELLED')));
};
