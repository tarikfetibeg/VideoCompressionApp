// axiosConfig.js

import axios from 'axios';

// Use environment variable or default to 'http://localhost:5000/api'
const baseURL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';
console.log('Axios baseURL:', baseURL);

const axiosInstance = axios.create({
  baseURL, // Set the base URL for API calls
});

// Request interceptor: attach JWT token if available and add a custom origin header
axiosInstance.interceptors.request.use(
  (config) => {
    const userData = localStorage.getItem('user');
    const user = userData ? JSON.parse(userData) : null;
    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    // Add a custom header with the origin value (or fallback if window is undefined)
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      config.headers['X-My-Origin'] = window.location.origin;
    } else {
      config.headers['X-My-Origin'] = 'unknown';
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: optionally handle responses/errors globally
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    // You can add global error handling here (e.g., logging out on 401 errors)
    return Promise.reject(error);
  }
);

console.log('Axios configured with baseURL:', baseURL);

export default axiosInstance;
