const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const mongoose = require('mongoose');

const root = path.resolve(__dirname, '../..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function createEnvironment() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const runtime = path.join(root, '.qa-runtime', runId);
  const output = path.join(root, 'analysis', 'qa', runId);
  const port = Number(process.env.QA_PORT || 5110);
  const mongoPort = Number(process.env.QA_MONGO_PORT || 27110);
  if (!Number.isInteger(port) || !Number.isInteger(mongoPort) || port === mongoPort || [5000, 5051, 27017].includes(port) || mongoPort === 27017) {
    throw new Error('QA ports must not reuse normal application/database ports.');
  }
  await assertFreePort(port);
  await assertFreePort(mongoPort);
  if (!inside(path.join(root, '.qa-runtime'), runtime)) throw new Error('Unsafe QA root.');
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'qa-marker.json'), JSON.stringify({ runId, root: runtime }));
  // Copy source only: no .env, dependencies, junctions or production storage.
  fs.cpSync(path.join(root, 'backend'), path.join(runtime, 'backend'), {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(path.join(root, 'backend'), source);
      if (!relative) return true;
      if (fs.lstatSync(source).isSymbolicLink()) return false;
      return !relative.split(path.sep).some((part) => ['node_modules', 'uploads', 'storage', 'frontend'].includes(part) || part.startsWith('.env'));
    },
  });
  fs.cpSync(path.join(root, 'frontend/build'), path.join(runtime, 'frontend/build'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(runtime, 'package.json'));
  const hashTree = (folder) => {
    const hash = crypto.createHash('sha256');
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else hash.update(path.relative(folder, file)).update(fs.readFileSync(file));
      }
    };
    visit(folder); return hash.digest('hex');
  };
  fs.writeFileSync(path.join(output, 'run-identity.json'), JSON.stringify({
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
    node: process.version, platform: process.platform, arch: process.arch,
    cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalRamBytes: os.totalmem(),
    sourceHash: hashTree(path.join(runtime, 'backend')), frontendSourceHash: hashTree(path.join(root, 'frontend/src')), buildHash: hashTree(path.join(runtime, 'frontend/build')),
    queue: 'local', dataset: 'disposable local MongoDB', mediaRoot: 'isolated .qa-runtime storage',
  }, null, 2));
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    MONGODB_URI: `mongodb://127.0.0.1:${mongoPort}/qa_${runId.replace(/-/g, '_')}`,
    MONGOOSE_AUTO_INDEX: 'false',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    PROCESSING_QUEUE: 'local',
    PORT: String(port),
    ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    ALLOW_PUBLIC_REGISTRATION: 'false',
    FFMPEG_PATH: process.env.QA_FFMPEG || 'ffmpeg',
    FFPROBE_PATH: process.env.QA_FFPROBE || 'ffprobe',
  };
  delete env.REDIS_URL;
  const children = new Set();
  let browser;
  let serverPid;
  function child(command, args, logName) {
    const processChild = spawn(command, args, { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(processChild);
    const log = fs.createWriteStream(path.join(runtime, logName));
    processChild.stdout?.pipe(log);
    processChild.stderr?.pipe(log);
    processChild.on('exit', () => { children.delete(processChild); log.end(); });
    processChild.on('error', () => log.end());
    return processChild;
  }
  async function cleanup() {
    if (browser) await browser.close().catch(() => {});
    await mongoose.disconnect().catch(() => {});
    for (const processChild of [...children].reverse()) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(processChild.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch (_) { /* Already exited. */ }
      } else processChild.kill('SIGTERM');
    }
    await delay(400);
    const ports = {};
    for (const target of [port, mongoPort]) {
      try { await assertFreePort(target); ports[target] = 'free'; } catch (_) { ports[target] = 'still-listening'; }
    }
    fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ ownProcessesOnly: true, ports }, null, 2));
  }
  const mongoBinary = process.env.QA_MONGOD || (process.platform === 'win32'
    ? 'C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe' : 'mongod');
  fs.mkdirSync(path.join(runtime, 'mongo'), { recursive: true });
  child(mongoBinary, ['--dbpath', path.join(runtime, 'mongo'), '--port', String(mongoPort), '--bind_ip', '127.0.0.1', '--quiet'], 'mongo.log');
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await mongoose.connect(env.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 500 }); break; } catch (error) {
      if (attempt === 39) { await cleanup(); throw error; }
      await delay(200);
    }
  }
  const load = (name) => require(path.join(runtime, 'backend', name));
  const models = {};
  try {
    for (const model of ['User', 'Video', 'EditJob', 'BroadcastContentType', 'BroadcastProgram', 'ShowDay', 'Feedback', 'AuditLog', 'Notification', 'CorrectionRequest', 'FfmpegSettings', 'StorageSettings', 'DownloadTicket', 'MediaTicket']) models[model] = load(`models/${model}`);
  } catch (error) { await cleanup(); throw error; }
  async function command(executable, args, timeout = 180000) {
    const processChild = child(executable, args, 'command-' + crypto.randomBytes(3).toString('hex') + '.log');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { processChild.kill(); reject(new Error('QA command timed out')); }, timeout);
      processChild.once('error', (error) => { clearTimeout(timer); reject(error); });
      processChild.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`QA command exited ${code}`)); });
    });
  }
  const base = `http://127.0.0.1:${port}`;
  const sessions = {};
  const password = crypto.randomBytes(18).toString('hex');
  async function api(role, route, method = 'GET', body, options = {}) {
    const headers = { ...(sessions[role] ? { Authorization: `Bearer ${sessions[role].token}` } : {}), ...options.headers };
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + route, {
      method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeout || 60000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const json = bytes.length && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : null;
    return { status: response.status, headers: response.headers, data: json, bytes };
  }
  async function startServer() {
    serverPid = child(process.execPath, [path.join(runtime, 'backend/app.js')], 'app.log').pid;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { const response = await fetch(base + '/login'); if (response.ok) break; } catch (_) { /* Not listening yet. */ }
      if (attempt === 59) throw new Error('QA server did not start; see isolated app.log.');
      await delay(250);
    }
    for (const role of Object.keys(models.qaUsers || {})) {
      let response;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        response = await api(null, '/api/auth/login', 'POST', { username: models.qaUsers[role].username, password });
        if (response.status !== 503 || response.data?.code !== 'DATABASE_UNAVAILABLE') break;
        await delay(250);
      }
      if (response.status !== 200) throw new Error(`QA login failed for ${role}: HTTP ${response.status}`);
      sessions[role] = { ...response.data.user, token: response.data.token };
    }
  }
  return { root, runtime, output, runId, port, base, env, models, load, api, sessions, password, command, cleanup, startServer, getServerPid: () => serverPid, setBrowser: (value) => { browser = value; } };
}

module.exports = { createEnvironment, delay, inside };
