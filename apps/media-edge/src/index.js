const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const dotenvFlow = require('dotenv-flow');
const { Server: TusServer, EVENTS } = require('@tus/server');
const { FileStore } = require('@tus/file-store');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
dotenvFlow.config({ cwd: projectRoot });

const MediaAsset = require(path.join(projectRoot, 'backend', 'models', 'MediaAsset'));
const MediaNode = require(path.join(projectRoot, 'backend', 'models', 'MediaNode'));
const { paths, STORAGE_ROOT, ensureStorageFolders } = require(path.join(projectRoot, 'backend', 'utils', 'storagePaths'));
const { sendFileWithRange } = require(path.join(projectRoot, 'backend', 'utils', 'mediaStreaming'));

const NODE_ID = process.env.EDGE_NODE_ID || 'primary-edge';
const NODE_NAME = process.env.EDGE_NODE_NAME || 'Primarni Media Edge';
const SITE_ID = process.env.EDGE_SITE_ID || 'primary';
const EDGE_PORT = Math.max(Number(process.env.EDGE_PORT || 5100), 1);
const EDGE_BASE_URL = process.env.EDGE_BASE_URL || `http://127.0.0.1:${EDGE_PORT}`;
const CONTROL_API_URL = String(process.env.CONTROL_API_URL || 'http://127.0.0.1:5000/api').replace(/\/$/, '');
const EDGE_SECRET = process.env.EDGE_REGISTRATION_SECRET || '';
const TRANSFER_SECRET = process.env.EDGE_TRANSFER_SECRET || process.env.JWT_SECRET || '';
const uploadDirectory = path.join(paths.temp, 'edge-uploads');

let stopping = false;
const childWorkers = [];

function authPayload(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !TRANSFER_SECRET) throw new Error('Transfer token nedostaje.');
  const payload = jwt.verify(token, TRANSFER_SECRET);
  if (payload.tokenType !== 'edge-transfer' || payload.nodeId !== NODE_ID) {
    throw new Error('Transfer token ne pripada ovom Media Edge čvoru.');
  }
  return payload;
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

async function postControl(pathname, body, method = 'POST') {
  const response = await fetch(`${CONTROL_API_URL}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-edge-secret': EDGE_SECRET,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Control API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function storageStats() {
  const stats = await fs.promises.statfs(STORAGE_ROOT);
  return {
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
  };
}

function capabilities() {
  return {
    nvenc: process.env.HLS_ENCODER === 'h264_nvenc' || process.env.EDGE_NVENC === 'true',
    hls: true,
    resumableUploads: true,
    codecs: ['h264', 'aac', 'mp3'],
  };
}

async function register() {
  return postControl('/v2/media-nodes/register', {
    nodeId: NODE_ID,
    name: NODE_NAME,
    site: SITE_ID,
    baseUrl: EDGE_BASE_URL,
    capabilities: capabilities(),
    storage: await storageStats(),
  });
}

async function heartbeat() {
  return postControl(`/v2/media-nodes/${NODE_ID}/heartbeat`, {
    status: 'online',
    capabilities: capabilities(),
    storage: await storageStats(),
  }, 'PATCH');
}

async function processClaimedTask(task) {
  if (!task) return;
  await postControl(`/v2/media-nodes/${NODE_ID}/tasks/${task.taskId}`, { status: 'processing' }, 'PATCH');
  try {
    if (task.kind === 'video_processing') {
      const { enqueueVideoProcessing } = require(path.join(projectRoot, 'backend', 'queues', 'videoQueue'));
      await enqueueVideoProcessing(task.video, task.payload || {});
    } else if (task.kind === 'hls_build') {
      const { enqueueHlsPreview } = require(path.join(projectRoot, 'backend', 'queues', 'hlsQueue'));
      await enqueueHlsPreview(task.video, task.payload || {});
    } else if (task.kind === 'preview_rebuild') {
      const { enqueuePreviewMaintenance } = require(path.join(projectRoot, 'backend', 'queues', 'previewMaintenanceQueue'));
      await enqueuePreviewMaintenance(task.video, task.payload?.assetTypes || []);
    } else {
      throw new Error(`Nepodržan Media Edge task: ${task.kind}`);
    }
    await postControl(`/v2/media-nodes/${NODE_ID}/tasks/${task.taskId}`, {
      status: 'completed',
      result: { queuedAt: new Date().toISOString() },
    }, 'PATCH');
  } catch (error) {
    await postControl(`/v2/media-nodes/${NODE_ID}/tasks/${task.taskId}`, {
      status: 'failed',
      error: error.message,
    }, 'PATCH').catch(() => {});
  }
}

async function pollTasks() {
  if (stopping) return;
  try {
    const response = await postControl(`/v2/media-nodes/${NODE_ID}/tasks/claim`, {});
    await processClaimedTask(response.task);
  } catch (error) {
    console.error('Media Edge task poll failed:', error.message);
  }
}

function startWorker(script) {
  const child = fork(path.join(projectRoot, 'backend', 'workers', script), [], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PROCESSING_QUEUE: 'redis',
      REDIS_URL: process.env.EDGE_REDIS_URL || process.env.REDIS_URL,
      MEDIA_STORAGE_ROOT: STORAGE_ROOT,
    },
    windowsHide: true,
  });
  childWorkers.push(child);
  child.on('exit', (code) => {
    if (!stopping) console.error(`${script} exited unexpectedly with code ${code}.`);
  });
}

async function start() {
  if (!EDGE_SECRET) throw new Error('EDGE_REGISTRATION_SECRET is required.');
  if (!TRANSFER_SECRET) throw new Error('EDGE_TRANSFER_SECRET or JWT_SECRET is required.');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required.');

  ensureStorageFolders();
  fs.mkdirSync(uploadDirectory, { recursive: true });
  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });
  await register();

  const tusServer = new TusServer({
    path: '/files',
    datastore: new FileStore({ directory: uploadDirectory }),
    maxSize: Math.max(Number(process.env.MAX_UPLOAD_SIZE_GB || 25), 1) * 1024 ** 3,
    async onIncomingRequest(req) {
      try {
        req.edgeTransfer = authPayload(req);
      } catch (error) {
        throw { status_code: 401, body: error.message };
      }
    },
    async onUploadCreate(req, res, upload) {
      const transferId = upload.metadata?.transferId;
      if (!transferId || transferId !== req.edgeTransfer?.transferId) {
        throw { status_code: 403, body: 'Upload metadata ne odgovara transfer tokenu.' };
      }
      return { res };
    },
  });

  tusServer.on(EVENTS.POST_FINISH, async (req, _res, upload) => {
    try {
      const transfer = authPayload(req);
      const filePath = path.join(uploadDirectory, upload.id);
      const stat = await fs.promises.stat(filePath);
      const sha256 = await sha256File(filePath);
      const relativePath = path.relative(STORAGE_ROOT, filePath).replace(/\\/g, '/');
      await postControl(`/v2/media-nodes/${NODE_ID}/transfers/${transfer.transferId}/complete`, {
        relativePath,
        size: stat.size,
        sha256,
      });
    } catch (error) {
      console.error('Upload completion callback failed:', error);
    }
  });

  const app = express();
  app.get('/health', async (_req, res) => {
    res.json({ nodeId: NODE_ID, status: 'online', storage: await storageStats() });
  });
  app.all('/files', (req, res) => tusServer.handle(req, res));
  app.all('/files/*', (req, res) => tusServer.handle(req, res));
  app.get('/api/edge/assets/:assetId', async (req, res) => {
    try {
      const transfer = authPayload(req);
      if (transfer.direction !== 'download' || transfer.mediaAssetId !== req.params.assetId) {
        return res.status(403).json({ message: 'Download token nije ispravan.' });
      }
      const node = await MediaNode.findOne({ nodeId: NODE_ID });
      const asset = await MediaAsset.findOne({ _id: req.params.assetId, node: node?._id, status: 'available' });
      if (!asset) return res.status(404).json({ message: 'Media asset nije pronađen.' });
      const filePath = path.resolve(STORAGE_ROOT, asset.relativePath);
      const relative = path.relative(STORAGE_ROOT, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return res.status(400).json({ message: 'Media putanja nije sigurna.' });
      }
      return sendFileWithRange(req, res, filePath, 'application/octet-stream');
    } catch (error) {
      return res.status(401).json({ message: error.message });
    }
  });

  app.listen(EDGE_PORT, '0.0.0.0', () => {
    console.log(`Media Edge ${NODE_ID} sluša na portu ${EDGE_PORT}.`);
  });

  if (process.env.EDGE_RUN_LOCAL_WORKERS === 'true') {
    startWorker('videoWorker.js');
    startWorker('hlsWorker.js');
    startWorker('previewMaintenanceWorker.js');
  }

  setInterval(() => heartbeat().catch((error) => console.error('Media Edge heartbeat failed:', error.message)), 30_000);
  setInterval(pollTasks, 2_000);
}

async function shutdown() {
  stopping = true;
  childWorkers.forEach((child) => child.kill());
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
  console.error('Media Edge startup failed:', error);
  process.exitCode = 1;
});
