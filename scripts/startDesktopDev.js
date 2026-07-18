const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const dotenvFlow = require('dotenv-flow');

const workspace = path.resolve(__dirname, '..');

dotenvFlow.config({ cwd: workspace });

// This flag only affects the backend process owned by the local desktop dev command.
process.env.DESKTOP_DEV_MODE = 'true';

const apiPort = Number(process.env.PORT) || 5000;
const queueMode = String(process.env.PROCESSING_QUEUE || 'redis').trim().toLowerCase();
const localQueueModes = new Set(['local', 'memory', 'in-memory', 'inline']);

const ownedServices = [];
let desktopProcess = null;
let shuttingDown = false;

function canConnect(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function startNodeService(name, relativeEntry) {
  const child = spawn(process.execPath, [path.join(workspace, relativeEntry)], {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  child.serviceName = name;
  ownedServices.push(child);
  child.once('error', (error) => {
    if (shuttingDown) return;
    console.error(`[desktop-dev] ${name} se ne može pokrenuti: ${error.message}`);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `kod ${code}`;
    console.error(`[desktop-dev] ${name} je zaustavljen (${reason}).`);
    shutdown(code || 1);
  });
  return child;
}

async function waitForApi(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(apiPort)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function stopChild(child) {
  if (child && child.exitCode === null && !child.killed) {
    child.kill();
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  stopChild(desktopProcess);
  for (const child of ownedServices) stopChild(child);

  setTimeout(() => process.exit(exitCode), 750).unref();
}

async function main() {
  const apiAlreadyRunning = await canConnect(apiPort);

  if (apiAlreadyRunning) {
    console.log(`[desktop-dev] Backend je već dostupan na portu ${apiPort}; neće biti ponovo pokrenut.`);
  } else {
    console.log(`[desktop-dev] Pokrećem lokalni backend na portu ${apiPort}...`);
    startNodeService('Backend', 'backend/app.js');

    if (!localQueueModes.has(queueMode)) {
      startNodeService('Video worker', 'backend/workers/videoWorker.js');
      startNodeService('HLS worker', 'backend/workers/hlsWorker.js');
      startNodeService('Preview worker', 'backend/workers/previewMaintenanceWorker.js');
    }

    if (process.env.EVENT_OUTBOX_MODE === 'worker') {
      startNodeService('Event worker', 'backend/workers/eventOutboxWorker.js');
    }

    if (!await waitForApi()) {
      console.error(`[desktop-dev] Backend nije postao dostupan na portu ${apiPort} u roku od 30 sekundi.`);
      shutdown(1);
      return;
    }
    console.log('[desktop-dev] Backend je spreman. Pokrećem Tauri klijent...');
  }

  const desktopCommand = process.platform === 'win32'
    ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
    : 'npm';
  const desktopArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run tauri:dev --workspace @vca/desktop']
    : ['run', 'tauri:dev', '--workspace', '@vca/desktop'];

  desktopProcess = spawn(desktopCommand, desktopArgs, {
    cwd: workspace,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  });

  desktopProcess.once('error', (error) => {
    console.error(`[desktop-dev] Tauri klijent se ne može pokrenuti: ${error.message}`);
    shutdown(1);
  });
  desktopProcess.once('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `kod ${code}`;
    console.log(`[desktop-dev] Tauri klijent je zatvoren (${reason}).`);
    shutdown(code || 0);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

main().catch((error) => {
  console.error(`[desktop-dev] Pokretanje nije uspjelo: ${error.message}`);
  shutdown(1);
});
