// axiosConfig.js

import axios from 'axios';

// Use environment variable or default to 'http://localhost:5000/api'
const baseURL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000/api';

// For debugging purposes, you can log the baseURL
console.log('Axios baseURL:', baseURL);

const axiosInstance = axios.create({
  baseURL, // Use the baseURL variable here
});

axiosInstance.interceptors.request.use(
  (config) => {
    const userData = localStorage.getItem('user');
    const user = userData ? JSON.parse(userData) : null;

    if (user && user.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

console.log('Axios baseURL:', baseURL);

export default axiosInstance;