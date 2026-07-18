import axios from 'axios';
import { getAccessToken, setAccessToken } from './auth/tokenStore';
import { refreshCurrentSession } from './auth/sessionApi';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

const axiosInstance = axios.create({
  baseURL,
});

axiosInstance.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
    const config = error.config || {};
    const isAuthRequest = String(config.url || '').includes('/v2/auth/');
    if (error.response?.status === 401 && !config.__v2Retry && !isAuthRequest) {
      config.__v2Retry = true;
      try {
        const session = await refreshCurrentSession();
        if (session?.accessToken) {
          setAccessToken(session.accessToken);
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${session.accessToken}`;
          return axiosInstance(config);
        }
      } catch (refreshError) {
        window.dispatchEvent(new Event('vca:session-expired'));
      }
    }

    if (error.response && error.response.status === 403) {
      console.warn('Forbidden request. User may not have permission.');
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
