import axios from 'axios';

const baseURL = process.env.REACT_APP_API_BASE_URL || '/api';

const axiosInstance = axios.create({
  baseURL,
});

axiosInstance.interceptors.request.use(
  (config) => {
    const userData = localStorage.getItem('user');
    const user = userData ? JSON.parse(userData) : null;

    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
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
  (error) => {
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
