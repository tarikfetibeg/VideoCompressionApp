// Load environment variables as early as possible
const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..'),
});

const express = require('express');
const app = express();
const cors = require('cors');
const mongoose = require('mongoose');
const { ensureStorageFolders } = require('./utils/storagePaths');
const { cleanupExpiredRawFiles } = require('./services/rawRetentionService');

// Custom logging middleware for incoming request origin with fallback
app.use((req, res, next) => {
  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;
  const hostHeader = req.headers.host;
  const loggedOrigin = originHeader || refererHeader || hostHeader || 'undefined';
  console.log('Incoming request origin (with fallback):', loggedOrigin);
  next();
});

// Define allowedOrigins only once
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [];

console.log('Allowed Origins:', allowedOrigins);

app.use((req, res, next) => {
  const customOrigin = req.headers['x-my-origin'] || 'undefined';
  console.log('Custom X-My-Origin header:', customOrigin);
  next();
});

// CORS middleware using the actual Origin header only
app.use(
  cors({
    origin: function (origin, callback) {
      console.log('CORS check, incoming origin:', origin);

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    exposedHeaders: ['Content-Length', 'Content-Range'],
  })
);

// Middleware for parsing JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Create storage directories if they don't exist
ensureStorageFolders();

// Connect to MongoDB
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Error: MONGODB_URI is not defined');
} else {
  console.log('MONGODB_URI is defined');
}

mongoose
  .connect(mongoURI)
  .then(async () => {
    console.log('MongoDB connected successfully');

    try {
      const cleanupResult = await cleanupExpiredRawFiles();
      console.log('Raw retention cleanup result:', cleanupResult);
    } catch (cleanupError) {
      console.error('Raw retention cleanup error:', cleanupError);
    }

    setInterval(async () => {
      try {
        const cleanupResult = await cleanupExpiredRawFiles();
        console.log('Scheduled raw retention cleanup result:', cleanupResult);
      } catch (cleanupError) {
        console.error('Scheduled raw retention cleanup error:', cleanupError);
      }
    }, 6 * 60 * 60 * 1000); // every 6 hours
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Register API routes
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const videoRoutes = require('./routes/videos');

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/videos', videoRoutes);

// Legacy static route. Existing old files may still be under uploads.
app.use('/uploads', express.static('uploads'));

// Serve static files from the React app's build folder
app.use(express.static(path.join(__dirname, '..', 'frontend', 'build')));

// Catch-all route: for any request that doesn't match above, send back React's index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'build', 'index.html'));
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).send('Something broke!');
});

// Start the Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});