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
const Video = require('./models/Video');
const { ensureStorageFolders } = require('./utils/storagePaths');
const { cleanupExpiredRawFiles } = require('./services/rawRetentionService');
const {
  enqueueVideoProcessing,
  isLocalVideoQueue,
  queueMode,
  videoQueue,
} = require('./queues/videoQueue');
const { processVideoJob } = require('./services/videoProcessingService');

async function requeueLocalPendingVideos() {
  const pendingVideos = await Video.find({
    processingStatus: { $in: ['queued', 'processing'] },
  }).select('_id rawPath filepath');

  let requeuedCount = 0;

  for (const video of pendingVideos) {
    if (!video.rawPath && !video.filepath) continue;

    await enqueueVideoProcessing(video._id);
    requeuedCount += 1;
  }

  if (requeuedCount > 0) {
    console.log(`Local queue recovered ${requeuedCount} pending video job(s).`);
  }
}

// Define allowedOrigins only once
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [];

console.log('Allowed Origins:', allowedOrigins);

// CORS middleware using the actual Origin header only
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Disposition'],
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
    console.log(`Video queue mode: ${queueMode}`);

    if (isLocalVideoQueue) {
      videoQueue.process(1, async (job) => processVideoJob(job.data, job));
      videoQueue.on('completed', (job) => {
        console.log(`Local video job completed: ${job.id}`);
      });
      videoQueue.on('failed', (job, error) => {
        console.error(`Local video job failed: ${job.id}`, error);
      });
      console.warn('Local video processing is running inside the web process. Use Redis for production.');
      await requeueLocalPendingVideos();
    }

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
const broadcastRoutes = require('./routes/broadcast');
const editJobRoutes = require('./routes/editJobs');
const uploadRoutes = require('./routes/upload');
const videoRoutes = require('./routes/videos');

app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/broadcast', broadcastRoutes);
app.use('/api/edit-jobs', editJobRoutes);
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
