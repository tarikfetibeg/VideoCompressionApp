const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../..');
const windows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');

function run(script, args, options = {}) {
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30000, ...options,
  });
  assert.ifError(result.error);
  return result;
}

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'AVC launcher \u010d test '));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  for (const relative of ['scripts', 'test-bin', 'tests/backend', 'node_modules/dotenv-flow', 'node_modules/express', 'frontend/build', 'frontend/node_modules/react-scripts']) {
    fs.mkdirSync(path.join(folder, relative), { recursive: true });
  }
  for (const relative of ['node_modules/dotenv-flow/package.json', 'node_modules/express/package.json', 'frontend/node_modules/react-scripts/package.json', 'package-lock.json', 'frontend/package-lock.json']) {
    fs.writeFileSync(path.join(folder, relative), '{}');
  }
  fs.writeFileSync(path.join(folder, 'frontend/build/index.html'), '<title>fixture</title>');
  fs.writeFileSync(path.join(folder, 'tests/backend/example.test.js'), '');
  fs.copyFileSync(path.join(root, 'scripts/windowsLauncher.ps1'), path.join(folder, 'scripts/windowsLauncher.ps1'));
  fs.writeFileSync(path.join(folder, 'scripts/startAll.js'), `
    require('node:fs').appendFileSync(process.env.AVC_LAUNCHER_TEST_LOG, JSON.stringify({ start: true, cwd: process.cwd() }) + '\\n');
  `);
  fs.writeFileSync(path.join(folder, 'test-bin/npm.cmd'), '@echo off\r\nnode "%~dp0stub-npm.js" %*\r\n');
  fs.writeFileSync(path.join(folder, 'test-bin/stub-npm.js'), `
    require('node:fs').appendFileSync(process.env.AVC_LAUNCHER_TEST_LOG, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
    process.exit(Number(process.env.AVC_LAUNCHER_TEST_EXIT || 0));
  `);
  const env = { ...process.env, AVC_LAUNCHER_TEST_LOG: path.join(folder, 'calls.jsonl') };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
  env[pathKey] = `${path.join(folder, 'test-bin')};${env[pathKey] || ''}`;
  return {
    folder, env,
    execute: (action, options = {}) => run(path.join(folder, 'scripts/windowsLauncher.ps1'), ['-Action', action], { cwd: os.tmpdir(), env, ...options }),
    calls: () => fs.existsSync(env.AVC_LAUNCHER_TEST_LOG)
      ? fs.readFileSync(env.AVC_LAUNCHER_TEST_LOG, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [],
  };
}

test('all menu commands can be inspected without execution', { skip: !windows }, () => {
  const expected = {
    start: ['node scripts/startAll.js'],
    build: ['npm.cmd run build --prefix frontend'],
    'build-start': ['npm.cmd run build --prefix frontend', 'node scripts/startAll.js'],
    install: ['npm.cmd ci', 'npm.cmd ci --prefix frontend'],
    'frontend-test': ['--watchAll=false --runInBand'],
    'backend-test': ['node --test', 'authenticateToken.test.js'],
    check: ['dry-run'],
  };
  for (const [action, snippets] of Object.entries(expected)) {
    const result = run(path.join(root, 'scripts/windowsLauncher.ps1'), ['-Action', action, '-DryRun'], { cwd: os.tmpdir() });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const snippet of snippets) assert.ok(result.stdout.includes(snippet), `${action}: ${result.stdout}`);
  }
});

test('build then start uses the project directory including spaces and diacritics', { skip: !windows }, (t) => {
  const app = fixture(t);
  const result = app.execute('build-start');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = app.calls();
  assert.deepEqual(calls.map((call) => call.args || call.start), [['run', 'build', '--prefix', 'frontend'], true]);
  assert.ok(calls.every((call) => call.cwd === app.folder));
});

test('failed build preserves its exit code and never starts the server', { skip: !windows }, (t) => {
  const app = fixture(t);
  app.env.AVC_LAUNCHER_TEST_EXIT = '7';
  const result = app.execute('build-start');
  assert.equal(result.status, 7, result.stdout + result.stderr);
  assert.equal(app.calls().length, 1);
  assert.equal(app.calls()[0].start, undefined);
});

test('missing build prevents server startup', { skip: !windows }, (t) => {
  const app = fixture(t);
  fs.unlinkSync(path.join(app.folder, 'frontend/build/index.html'));
  const result = app.execute('start');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Frontend build ne postoji/);
  assert.deepEqual(app.calls(), []);
});

test('installation requires explicit confirmation and uses only lockfile installs', { skip: !windows }, (t) => {
  const app = fixture(t);
  const cancelled = app.execute('install', { input: 'NE\n' });
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);
  assert.deepEqual(app.calls(), []);
  const confirmed = app.execute('install', { input: 'INSTALIRAJ\n' });
  assert.equal(confirmed.status, 0, confirmed.stdout + confirmed.stderr);
  assert.deepEqual(app.calls().map((call) => call.args), [['ci'], ['ci', '--prefix', 'frontend']]);
});

test('missing lockfile stops installation before npm is called', { skip: !windows }, (t) => {
  const app = fixture(t);
  fs.unlinkSync(path.join(app.folder, 'frontend/package-lock.json'));
  const result = app.execute('install', { input: 'INSTALIRAJ\n' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /npm ci nije pokrenut/);
  assert.deepEqual(app.calls(), []);
});

test('frontend tests disable watch mode', { skip: !windows }, (t) => {
  const app = fixture(t);
  const result = app.execute('frontend-test');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(app.calls()[0].args, ['test', '--prefix', 'frontend', '--', '--watchAll=false', '--runInBand']);
});

test('root cmd shim forwards actions when launched outside the project', { skip: !windows }, () => {
  const launcher = path.join(root, 'Pokreni aplikaciju.cmd');
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${launcher}" -Action build -DryRun"`], {
    cwd: os.tmpdir(), encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /npm.cmd run build --prefix frontend/);
});
