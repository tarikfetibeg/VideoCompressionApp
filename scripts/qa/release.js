const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-release';
const output = path.join(root, 'analysis/qa', runId);
fs.mkdirSync(output, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Start this runner with npm run qa:release.');
const unitFiles = fs.readdirSync(path.join(root, 'tests/backend')).filter((name) => name.endsWith('.test.js')).map((name) => 'tests/backend/' + name);
const definitions = {
  checks: ['scripts/qa/checks.js'], unit: ['--test', ...unitFiles],
  frontend: [npm, 'test', '--prefix', 'frontend', '--', '--watchAll=false', '--runInBand', '--json', `--outputFile=${path.join(output, 'frontend-tests.json')}`],
  build: [npm, 'run', 'build', '--prefix', 'frontend'], inventory: ['scripts/qa/inventory.js'],
  api: ['scripts/qa/run.js', 'api'], edges: ['scripts/qa/run.js', 'edges'], policy: ['scripts/qa/run.js', 'policy'], session: ['scripts/qa/run.js', 'session'],
  browser: ['scripts/qa/run.js', 'browser'], ui: ['scripts/qa/run.js', 'ui'], maintenance: ['scripts/qa/run.js', 'maintenance'], media: ['scripts/qa/run.js', 'media'], network: ['scripts/qa/run.js', 'network'], tickets: ['scripts/qa/run.js', 'tickets'],
  performance: ['scripts/qa/run.js', 'performance'], lighthouse: ['scripts/qa/run.js', 'lighthouse'],
  benchmark: ['scripts/qa/run.js', 'benchmark'], soak30: ['scripts/qa/run.js', 'soak'], soak75: ['scripts/qa/run.js', 'soak'],
  dependencies: ['scripts/qa/dependencies.js'], report: ['scripts/qa/report.js'],
};
const selected = process.argv.find((arg) => arg.startsWith('--phases='))?.slice(9).split(',') || Object.keys(definitions);
if (selected.some((name) => !definitions[name])) throw new Error('Unknown release phase.');
const hash = crypto.createHash('sha256');
function inventory(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(folder, entry.name);
    if (fs.lstatSync(file).isSymbolicLink() || ['node_modules', 'build', 'storage', 'uploads'].includes(entry.name) || entry.name.startsWith('.env')) continue;
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile()) { hash.update(path.relative(root, file)); hash.update(fs.readFileSync(file)); }
  }
}
for (const folder of ['backend', 'frontend/src', 'qa', 'scripts/qa', 'tests']) inventory(path.join(root, folder));
const sourceHash = hash.digest('hex');
const results = [];
const state = { runId, startedAt: new Date().toISOString(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(), sourceHash, node: process.version, selected, applicationDependencyUpgrades: false, results };
let child;
const save = () => fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(state, null, 2));
const sanitize = (text) => text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT]').replace(/(\/media\/|\/downloads\/tickets\/)[a-f0-9]{64}/g, '$1[TOKEN]').replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, '[MONGODB_URI]');

async function main() {
  save();
  for (const name of selected) {
    console.log(`RELEASE ${runId}: ${name}`);
    const before = new Set(fs.readdirSync(path.join(root, 'analysis/qa')));
    const startedAt = new Date().toISOString();
    let log = '';
    const env = { ...process.env, QA_RELEASE_ID: runId };
    if (name.startsWith('soak')) env.QA_SOAK_MINUTES = name === 'soak30' ? '30' : '75';
    const exitCode = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, definitions[name], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const collect = (data) => { const value = sanitize(String(data)); log += value; process.stdout.write(value); };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.once('error', reject); child.once('close', (code) => { child = null; resolve(code ?? 1); });
    });
    fs.writeFileSync(path.join(output, name + '.log'), log);
    const runFolders = fs.readdirSync(path.join(root, 'analysis/qa')).filter((folder) => !before.has(folder) && fs.existsSync(path.join(root, 'analysis/qa', folder, 'run-identity.json')));
    const evidence = runFolders.flatMap((folder) => {
      const file = path.join(root, 'analysis/qa', folder, 'results.json');
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
    });
    const blocked = evidence.filter((row) => row.status === 'blocked').length;
    results.push({ name, startedAt, finishedAt: new Date().toISOString(), status: exitCode !== 0 ? 'failed' : blocked ? 'partial' : 'passed', exitCode, blocked, runFolders });
    save();
    if (['checks', 'unit', 'frontend', 'build'].includes(name) && exitCode !== 0) break;
  }
  state.finishedAt = new Date().toISOString();
  state.localStatus = results.some((row) => row.exitCode !== 0) || results.length !== selected.length ? 'failed' : results.some((row) => row.status === 'partial') ? 'partial' : 'passed';
  state.releaseStatus = 'not-approved';
  state.externalChecks = ['Android', 'iPhone/Safari', 'second-computer-LAN', 'second-computer-remote', 'isolated-Redis-restart'].map((name) => ({ name, status: 'blocked', reason: 'Requires separate current-build evidence; local completion never implies approval.' }));
  save();
  console.log('Release evidence: ' + output + '; local: ' + state.localStatus + '; overall: not-approved until acceptance review.');
  if (state.localStatus === 'failed') process.exitCode = 1;
}

process.once('SIGINT', () => {
  state.interruptedAt = new Date().toISOString(); save();
  if (child && Number.isInteger(child.pid)) {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(130);
});
main().catch((error) => { state.error = sanitize(error.message); save(); console.error(state.error); process.exitCode = 1; });
