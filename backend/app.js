// Load environment variables as early as possible
const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..'),
});

const express = require('express');
const app = express();
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const Video = require('./models/Video');
const { ensureStorageFolders } = require('./utils/storagePaths');
const { cleanupExpiredRawFiles } = require('./services/rawRetentionService');
const { expireEditJobs } = require('./services/editJobLifecycleService');
const { syncTaggedCorrectionRequests } = require('./services/correctionWorkflowService');
const {
  enqueueVideoProcessing,
  isLocalVideoQueue,
  queueMode,
  videoQueue,
} = require('./queues/videoQueue');
const { processQueuedVideoTask } = require('./services/videoQueueProcessor');
const {
  enqueueHlsPreview,
  hlsQueue,
  hlsQueueConcurrency,
  isLocalHlsQueue,
} = require('./queues/hlsQueue');
const { processHlsQueueTask } = require('./services/hlsQueueProcessor');
const { refreshStorageOverview } = require('./services/storageOverviewService');
const {
  enqueuePreviewMaintenance,
  isLocalPreviewMaintenanceQueue,
  previewMaintenanceConcurrency,
  previewMaintenanceQueue,
} = require('./queues/previewMaintenanceQueue');
const { processPreviewMaintenanceTask } = require('./services/previewMaintenanceService');
const { processOutboxBatch } = require('./services/domainEventService');
const { escalateUnacknowledgedNotifications } = require('./services/notificationEscalationService');
const { initializeRealtime } = require('./realtime/realtimeGateway');

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
    .map((origin) => origin.trim())
    .filter(Boolean)
  : [];

console.log('Allowed Origins:', allowedOrigins);

function isSameHostOrigin(origin, host) {
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch (error) {
    return false;
  }
}

function isDesktopDevOrigin(origin) {
  if (process.env.DESKTOP_DEV_MODE !== 'true' || !origin) return false;

  try {
    const parsed = new URL(origin);
    const loopbackHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    return parsed.protocol === 'http:' && parsed.port === '5173' && loopbackHost;
  } catch (error) {
    return false;
  }
}

async function requeueLocalPendingHls() {
  const pendingVideos = await Video.find({
    $or: [
      { 'hlsPreview.status': { $in: ['queued', 'processing'] } },
      { 'hlsPreview.buildStatus': { $in: ['queued', 'processing'] } },
    ],
  }).select('_id');

  for (const video of pendingVideos) {
    await enqueueHlsPreview(video._id, { force: true });
  }

  if (pendingVideos.length > 0) {
    console.log(`Local HLS queue recovered ${pendingVideos.length} interrupted job(s).`);
  }
}

async function requeueLocalPendingPreviewMaintenance() {
  const pendingVideos = await Video.find({
    'previewMaintenance.status': { $in: ['queued', 'processing'] },
  }).select('_id previewMaintenance.assetTypes');
  for (const video of pendingVideos) {
    const assetTypes = video.previewMaintenance?.assetTypes || [];
    if (assetTypes.length > 0) await enqueuePreviewMaintenance(video._id, assetTypes);
  }
  if (pendingVideos.length > 0) {
    console.log(`Local preview queue recovered ${pendingVideos.length} interrupted job(s).`);
  }
}

// CORS middleware keeps explicit dev origins, and also allows backend-served
// same-host access such as http://station-host:5000 from another workstation.
app.use(
  cors((req, callback) => {
    const origin = req.get('Origin');
    const host = req.get('Host');
    const originAllowed = !origin
      || allowedOrigins.includes(origin)
      || isSameHostOrigin(origin, host)
      || isDesktopDevOrigin(origin);

    if (!originAllowed) {
      return callback(new Error('Not allowed by CORS'));
    }

    return callback(null, {
      origin: origin || true,
      credentials: true,
      exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Disposition'],
    });
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
  .connect(mongoURI, {
    autoIndex: process.env.MONGOOSE_AUTO_INDEX === 'true',
  })
  .then(async () => {
    console.log('MongoDB connected successfully');
    console.log(`Video queue mode: ${queueMode}`);
    refreshStorageOverview().promise.catch((error) => {
      console.error('Initial storage overview scan failed:', error);
    });

    if (isLocalVideoQueue) {
      videoQueue.process(1, async (job) => processQueuedVideoTask(job.data, job));
      videoQueue.on('completed', (job) => {
        console.log(`Local video job completed: ${job.id}`);
      });
      videoQueue.on('failed', (job, error) => {
        console.error(`Local video job failed: ${job.id}`, error);
      });
      console.warn('Local video processing is running inside the web process. Use Redis for production.');
      await requeueLocalPendingVideos();
    }
    if (isLocalHlsQueue) {
      hlsQueue.process(hlsQueueConcurrency, async (job) => processHlsQueueTask(job.data, job));
      hlsQueue.on('completed', (job) => {
        console.log(`Local HLS job completed: ${job.id}`);
      });
      hlsQueue.on('failed', (job, error) => {
        console.error(`Local HLS job failed: ${job.id}`, error);
      });
      console.warn(`Local HLS processing is isolated from ingest; concurrency=${hlsQueueConcurrency}.`);
      await requeueLocalPendingHls();
    }
    if (isLocalPreviewMaintenanceQueue) {
      previewMaintenanceQueue.process(
        previewMaintenanceConcurrency,
        async (job) => processPreviewMaintenanceTask(job.data, job)
      );
      previewMaintenanceQueue.on('completed', (job) => {
        console.log(`Local preview maintenance completed: ${job.id}`);
      });
      previewMaintenanceQueue.on('failed', (job, error) => {
        console.error(`Local preview maintenance failed: ${job.id}`, error);
      });
      console.warn('Local preview maintenance is isolated from ingest; concurrency=1.');
      await requeueLocalPendingPreviewMaintenance();
    }

    try {
      const cleanupResult = await cleanupExpiredRawFiles();
      console.log('Raw retention cleanup result:', cleanupResult);
    } catch (cleanupError) {
      console.error('Raw retention cleanup error:', cleanupError);
    }

    try {
      const expiryResult = await expireEditJobs();
      console.log('Edit job expiry result:', expiryResult);
    } catch (expiryError) {
      console.error('Edit job expiry error:', expiryError);
    }

    try {
      const correctionResult = await syncTaggedCorrectionRequests({ limit: 100 });
      console.log('Correction request sync result:', correctionResult);
    } catch (correctionError) {
      console.error('Correction request sync error:', correctionError);
    }

    setInterval(async () => {
      try {
        const expiryResult = await expireEditJobs();
        if (expiryResult.expired > 0) {
          console.log('Scheduled edit job expiry result:', expiryResult);
        }
      } catch (expiryError) {
        console.error('Scheduled edit job expiry error:', expiryError);
      }
    }, 5 * 60 * 1000);

    setInterval(async () => {
      try {
        const correctionResult = await syncTaggedCorrectionRequests({ limit: 100 });
        if (correctionResult.createdOrLinked > 0 || correctionResult.skipped > 0) {
          console.log('Scheduled correction request sync result:', correctionResult);
        }
      } catch (correctionError) {
        console.error('Scheduled correction request sync error:', correctionError);
      }
    }, 5 * 60 * 1000);

    setInterval(async () => {
      try {
        const cleanupResult = await cleanupExpiredRawFiles();
        console.log('Scheduled raw retention cleanup result:', cleanupResult);
      } catch (cleanupError) {
        console.error('Scheduled raw retention cleanup error:', cleanupError);
      }
    }, 6 * 60 * 60 * 1000); // every 6 hours

    if (process.env.EVENT_OUTBOX_MODE !== 'worker') {
      setInterval(async () => {
        try {
          await processOutboxBatch(50);
          await escalateUnacknowledgedNotifications(25);
        } catch (eventError) {
          console.error('Scheduled event outbox error:', eventError);
        }
      }, 1000);
      console.log('Event outbox is running inside the API process.');
    }
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Register API routes
const adminRoutes = require('./routes/admin');
const archiveRoutes = require('./routes/archive');
const authRoutes = require('./routes/auth');
const broadcastRoutes = require('./routes/broadcast');
const correctionRoutes = require('./routes/corrections');
const downloadRoutes = require('./routes/downloads');
const mediaRoutes = require('./routes/media');
const notificationRoutes = require('./routes/notifications');
const editJobRoutes = require('./routes/editJobs');
const feedbackRoutes = require('./routes/feedback');
const uploadRoutes = require('./routes/upload');
const videoRoutes = require('./routes/videos');
const v2AuthRoutes = require('./routes/v2/auth');
const v2DeviceRoutes = require('./routes/v2/devices');
const v2NotificationRoutes = require('./routes/v2/notifications');
const v2MediaNodeRoutes = require('./routes/v2/mediaNodes');
const v2TransferRoutes = require('./routes/v2/transfers');
const v2MediaRoutes = require('./routes/v2/media');
const v2RoughCutRoutes = require('./routes/v2/roughCuts');
const v2MyWorkRoutes = require('./routes/v2/myWork');
const v2AdminPlatformRoutes = require('./routes/v2/adminPlatform');

app.use('/api/v2/auth', v2AuthRoutes);
app.use('/api/v2/devices', v2DeviceRoutes);
app.use('/api/v2/notifications', v2NotificationRoutes);
app.use('/api/v2/media-nodes', v2MediaNodeRoutes);
app.use('/api/v2/transfers', v2TransferRoutes);
app.use('/api/v2/media', v2MediaRoutes);
app.use('/api/v2/edit-jobs', v2RoughCutRoutes);
app.use('/api/v2/my-work', v2MyWorkRoutes);
app.use('/api/v2/admin/platform', v2AdminPlatformRoutes);

app.use('/api/admin', adminRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/broadcast', broadcastRoutes);
app.use('/api/corrections', correctionRoutes);
app.use('/api/downloads', downloadRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/edit-jobs', editJobRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/videos', videoRoutes);

// Legacy static route. Existing old files may still be under uploads.
app.use('/uploads', express.static('uploads'));

if (process.env.DESKTOP_ONLY_MODE === 'true') {
  app.get('*', (req, res) => {
    res.status(410).json({
      message: 'Browser klijent je ugašen. Pokreni instaliranu Aplikaciju v2.',
      desktopOnly: true,
    });
  });
} else {
  const frontendBuild = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendBuild));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuild, 'index.html'));
  });
}

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(500).send('Something broke!');
});

// Start the Server
const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);
initializeRealtime(httpServer);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
