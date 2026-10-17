import axios from 'axios';
import { ensureSessionIdentity, isSessionPaused, pauseSession, readStoredUser, sessionError, waitForSession } from './utils/sessionRecovery';

const baseURL = process.env.REACT_APP_API_BASE_URL || '/api';

const axiosInstance = axios.create({
  baseURL,
});

axiosInstance.interceptors.request.use(
  async (config) => {
    const publicRequest = config.skipSessionRecovery || /^\/?auth\/(login|register)(\?|$)/.test(config.url || '');
    const readRequest = ['get', 'head', 'options'].includes((config.method || 'get').toLowerCase());
    if (!publicRequest) ensureSessionIdentity();
    if (!publicRequest && isSessionPaused()) {
      if (!readRequest) throw sessionError();
      await waitForSession(config.signal);
    }
    const user = readStoredUser();

    if (!publicRequest && user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    } else {
      delete config.headers.Authorization;
    }

    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      config.headers['X-My-Origin'] = window.location.origin;
    } else {
      config.headers['X-My-Origin'] = 'unknown';
    }

    return config;
  },
  (error) => Promise.reject(error)
);

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const code = error.response?.data?.code;
    if (config && !config.skipSessionRecovery && ['AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_INVALID', 'AUTH_TOKEN_MISSING'].includes(code) && readStoredUser()) {
      const currentToken = readStoredUser()?.token;
      const sentToken = String(config.headers?.Authorization || '').replace(/^Bearer /, '');
      const staleResponse = currentToken && sentToken && currentToken !== sentToken;
      if (!staleResponse) pauseSession();
      if (['get', 'head', 'options'].includes((config.method || 'get').toLowerCase()) && !config._sessionRetried) {
        await waitForSession(config.signal);
        return axiosInstance({ ...config, _sessionRetried: true });
      }
      error.message = sessionError().message;
    }
    if (error.response && error.response.status === 401) {
      console.warn('Unauthorized request. Token may be missing or expired.');
    }

    if (error.response && error.response.status === 403) {
      console.warn('Forbidden request. User may not have permission.');
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
