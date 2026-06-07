const { spawn } = require('child_process');

const processes = [
  {
    name: 'web',
    command: process.execPath,
    args: ['backend/app.js'],
  },
  {
    name: 'worker',
    command: process.execPath,
    args: ['backend/workers/videoWorker.js'],
  },
];

const children = [];
let shuttingDown = false;

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

processes.forEach(({ name, command, args }) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.push(child);

  child.stdout.on('data', (data) => prefixOutput(name, process.stdout, data));
  child.stderr.on('data', (data) => prefixOutput(name, process.stderr, data));

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[system] ${name} exited with ${reason}. Stopping all processes.`);
    stopAll(code || 1);
  });
});

console.log('[system] Web app and video worker started.');

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
