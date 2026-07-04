const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const dotenvFlow = require('dotenv-flow');

dotenvFlow.config({
  cwd: path.resolve(__dirname, '..'),
});

const { getProcessingQueueMode, isLocalProcessingQueue } = require('../backend/config/processingQueue');

const webPort = Number(process.env.PORT) || 5000;
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const queueMode = getProcessingQueueMode();
const useLocalQueue = isLocalProcessingQueue();

const processes = [
  {
    name: 'web',
    command: process.execPath,
    args: ['backend/app.js'],
  },
];

if (!useLocalQueue) {
  processes.push({
    name: 'worker',
    command: process.execPath,
    args: ['backend/workers/videoWorker.js'],
  });
  processes.push({
    name: 'hls-worker',
    command: process.execPath,
    args: ['backend/workers/hlsWorker.js'],
  });
  processes.push({
    name: 'preview-worker',
    command: process.execPath,
    args: ['backend/workers/previewMaintenanceWorker.js'],
  });
}

const children = [];
let shuttingDown = false;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }

      console.error(`[system] Could not check port ${port}: ${error.message}`);
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '0.0.0.0');
  });
}

function getRedisEndpoint(urlValue) {
  try {
    const parsedUrl = new URL(urlValue);

    return {
      host: parsedUrl.hostname || '127.0.0.1',
      port: Number(parsedUrl.port) || 6379,
    };
  } catch (error) {
    return {
      host: '127.0.0.1',
      port: 6379,
    };
  }
}

function canConnect(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;

    function finish(result) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function prefixOutput(name, stream, data) {
  const lines = data.toString().split(/\r?\n/).filter(Boolean);
  lines.forEach((line) => {
    stream.write(`[${name}] ${line}\n`);
  });
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  children.forEach((child) => {
    if (!child.killed) {
      child.kill();
    }
  });

  setTimeout(() => {
    process.exit(exitCode);
  }, 500);
}

async function startAll() {
  const webPortAvailable = await isPortAvailable(webPort);
  const redisEndpoint = getRedisEndpoint(redisUrl);
  const redisAvailable = useLocalQueue
    ? true
    : await canConnect(redisEndpoint.host, redisEndpoint.port);

  if (!webPortAvailable) {
    console.error(`[system] Port ${webPort} is already in use.`);
    console.error('[system] Another API/web process is already running, or a previous dev session did not close cleanly.');
    console.error(`[system] On Windows, find it with: netstat -ano | findstr :${webPort}`);
    console.error('[system] Then stop that PID with: Stop-Process -Id <PID> -Force');
    process.exit(1);
  }

  if (!redisAvailable) {
    console.error(`[system] Redis is not reachable at ${redisEndpoint.host}:${redisEndpoint.port}.`);
    console.error('[system] Video processing queue requires Redis before uploads can be processed.');
    console.error('[system] Start Redis, update REDIS_URL, or set PROCESSING_QUEUE=local in .env for QA.');
    process.exit(1);
  }

  if (useLocalQueue) {
    console.warn('[system] PROCESSING_QUEUE=local: Redis and separate worker are bypassed.');
    console.warn('[system] Video jobs run inside the web process and queued jobs do not survive app restarts.');
  }

  processes.forEach(({ name, command, args }) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    children.push(child);

    child.stdout.on('data', (data) => prefixOutput(name, process.stdout, data));
    child.stderr.on('data', (data) => prefixOutput(name, process.stderr, data));

    child.on('error', (error) => {
      if (shuttingDown) return;

      console.error(`[system] Could not start ${name}: ${error.message}`);
      stopAll(1);
    });

    child.on('exit', (code, signal) => {
      if (shuttingDown) return;

      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[system] ${name} exited with ${reason}. Stopping all processes.`);
      stopAll(code || 1);
    });
  });

  console.log(
    useLocalQueue
      ? `[system] Web app started on port ${webPort}; isolated local video/HLS queues enabled.`
      : `[system] Web app started on port ${webPort}; video, HLS and preview workers started.`
  );
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

startAll();
