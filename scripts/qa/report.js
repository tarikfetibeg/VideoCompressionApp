const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'analysis/qa');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const optional = (folder, name) => fs.existsSync(path.join(folder, name)) ? read(path.join(folder, name)) : null;
const runs = [];
for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
  const folder = path.join(output, entry.name);
  if (!fs.existsSync(path.join(folder, 'cleanup.json')) || !fs.existsSync(path.join(folder, 'results.json'))) continue;
  const results = read(path.join(folder, 'results.json'));
  if (!results.length) continue;
  const first = results[0];
  const mode = first.id.startsWith('SOAK-') ? 'soak-' + first.name.match(/^(\d+)-minute/)[1]
    : first.id.startsWith('SESSION-') ? 'session'
      : first.id.startsWith('NET-') ? 'network'
        : first.id.startsWith('TICKET-') ? 'tickets'
      : first.id.startsWith('EDGE-') ? 'edges'
        : first.id.startsWith('MAINT-') ? 'maintenance'
          : first.id.startsWith('POLICY-') ? 'policy-characterization'
        : first.id.startsWith('ACCEPT-') ? 'ui-acceptance'
    : first.id.startsWith('MEDIA-') ? 'media'
      : first.id.startsWith('BENCH-') ? 'benchmark'
        : first.id.startsWith('PERF-') ? 'performance'
          : first.id.startsWith('LH-') ? 'lighthouse'
            : first.id.startsWith('UI-') ? 'browser' : 'api';
  runs.push({ runId: entry.name, mode, folder, results });
}
const latest = new Map();
for (const run of runs.sort((a, b) => a.runId.localeCompare(b.runId))) latest.set(run.mode, run);
const summary = [];
for (const [mode, run] of latest) {
  const item = {
    mode, runId: run.runId,
    passed: run.results.filter((result) => result.status === 'passed').length,
    failed: run.results.filter((result) => result.status === 'failed').length,
    blocked: run.results.filter((result) => result.status === 'blocked').length,
    failures: run.results.filter((result) => result.status !== 'passed').map(({ id, name, status, error, detail }) => ({ id, name, status, error, reason: detail?.reason })),
    identity: optional(run.folder, 'run-identity.json'),
    cleanup: optional(run.folder, 'cleanup.json'),
  };
  if (mode === 'browser') {
    const responsive = optional(run.folder, 'responsive.json') || [];
    item.responsive = { checks: responsive.length, failures: responsive.filter((row) => row.status !== 'passed').length };
    item.widthDprChecks = optional(run.folder, 'width-sweep-dpr.json')?.checks?.length;
    item.engines = optional(run.folder, 'browser-engines.json');
    item.listLab = run.results.filter((result) => result.id.startsWith('LAB-')).map(({ id, detail }) => ({ id, ...detail }));
  }
  if (mode === 'lighthouse') {
    item.lighthouse = optional(run.folder, 'lighthouse-summary.json');
    item.lighthouseAcceptance = (item.lighthouse?.metrics || []).map((row) => ({ role: row.role, repeat: row.repeat,
      lcpPassed: row.metrics['largest-contentful-paint'] <= 2500, clsPassed: row.metrics['cumulative-layout-shift'] <= 0.1,
      tbtPassed: row.metrics['total-blocking-time'] <= (row.mobile ? 300 : 200), capturePassIsNotTargetPass: true }));
  }
  if (mode === 'performance') item.performance = optional(run.folder, 'performance.json');
  if (mode.startsWith('soak-')) {
    const soak = optional(run.folder, 'soak.json');
    if (soak) {
      item.soak = { durationSeconds: soak.durationSeconds, apiSamples: soak.apiSamples, failedApiSamples: soak.failures.length, p95: soak.p95, uploads: soak.uploads, downloads: soak.downloads, browserErrors: soak.browserErrors, videoStates: soak.videoStates, reauthentication: soak.reauthentication || [] };
    }
  }
  if (mode === 'benchmark') item.benchmark = optional(run.folder, 'media-benchmark.json');
  if (mode === 'ui-acceptance') item.nativeZoom = optional(run.folder, 'native-zoom.json');
  if (mode === 'edges') item.guestRouteMatrix = optional(run.folder, 'guest-route-matrix.json');
  summary.push(item);
}

function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) return [];
    return entry.isDirectory() ? files(file) : [file];
  });
}
const possibleSecretFiles = [];
for (const file of files(output).filter((file) => /\.(json|csv|md)$/.test(file))) {
  const content = fs.readFileSync(file, 'utf8');
  if (/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content)
    || /mongodb(?:\+srv)?:\/\/[^/\s]+:[^/@\s]+@/.test(content)
    || /\/(?:media|downloads\/tickets)\/[a-f0-9]{64}(?:\/|["\s])/.test(content)) {
    possibleSecretFiles.push(path.relative(root, file).replace(/\\/g, '/'));
  }
}
const jsFolder = path.join(root, 'frontend/build/static/js');
const main = fs.readdirSync(jsFolder).find((name) => /^main\..+\.js$/.test(name));
const mainBytes = main ? zlib.gzipSync(fs.readFileSync(path.join(jsFolder, main)), { level: 9 }).length : null;
const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifests = ['package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json'].filter((file) => fs.existsSync(path.join(root, file))).map((file) => ({ file, sha256: digest(path.join(root, file)) }));
const devices = fs.readdirSync(output, { withFileTypes: true }).filter((entry) => entry.isDirectory() && fs.existsSync(path.join(output, entry.name, 'device-qa.json'))).map((entry) => ({ ...optional(path.join(output, entry.name), 'device-qa.json'), identity: optional(path.join(output, entry.name), 'run-identity.json'), cleanup: optional(path.join(output, entry.name), 'cleanup.json') }));
const frontendRuns = fs.readdirSync(output).filter((name) => name.endsWith('-release') && fs.existsSync(path.join(output, name, 'frontend-tests.json'))).sort();
const frontendFile = frontendRuns.length ? path.join(output, frontendRuns.at(-1), 'frontend-tests.json') : null;
const frontend = frontendFile ? read(frontendFile) : null;
const record = {
  createdAt: new Date().toISOString(), branch: execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
  overallStatus: 'partial-coverage-with-open-risks', noClaimAllFeaturesPass: true,
  dependencyUpgradesDeferredByUser: true, mainGzipBytes: mainBytes, manifests,
  secretScan: { patternBasedNotSecurityCertification: true, possibleSecretFiles },
  inventory: optional(path.join(output, 'inventory'), 'inventory.json'),
  syntax: optional(path.join(output, 'checks'), 'syntax.json'),
  realDevices: devices,
  frontend: frontend ? { runId: frontendRuns.at(-1), passed: frontend.numPassedTests, failed: frontend.numFailedTests, suites: frontend.numTotalTestSuites } : null,
  runs: summary,
};
fs.writeFileSync(path.join(output, 'ZAVRSNI_REZULTATI.json'), JSON.stringify(record, null, 2));
const rows = summary.map((run) => `| ${run.mode} | ${run.runId} | ${run.passed} | ${run.failed} | ${run.blocked} |`);
fs.writeFileSync(path.join(output, 'ZAVRSNI_REZULTATI.md'), `# Zavrsni indeks lokalnog QA\n\nBranch: ${record.branch}. Status: **djelimicna pokrivenost sa otvorenim rizicima**.\n\n| Suite | Run ID | Pass | Fail | Blocked |\n| --- | --- | ---: | ---: | ---: |\n${rows.join('\n')}\n\nBrowser engine ogranicenja su u browser-engines.json; prolaz suitea ne pretvara Firefox u prolaz. Lighthouse capture prolaz nije prolaz svih performance pragova. Soak 60 i NVENC speed nalaz ostaju vidljivi.\n\nIndeks sadrzi razlicite aplikacijske snapshotove. Provjeriti source/build hash; stariji soak ili benchmark nije automatski retest posljednjeg builda. Aktuelne korisnicke odluke, preskakanja i granice: [QA predaja](PREDAJA_QA_2026_10.md).\n\nHistorijski detalji: docs/QA_IZVRSENJE_WEB_OPTIMIZACIJA.md, NALAZI_I_POPRAVKE.md i POKRIVENO_I_NEPOKRIVENO.md.\n\nPattern secret scan: ${possibleSecretFiles.length} kandidata, bez prikaza sadrzaja.\n`);
fs.writeFileSync(path.join(output, 'PERFORMANCE_PRIJE_POSLIJE.csv'), `metric,before,after,unit,scope,limitation\ninitial-main-gzip,442.18,${mainBytes ? (mainBytes / 1000).toFixed(2) : ''},kB-decimal,production main chunk only,total feature chunks are not removed; gzip level 9 matches CRA; baseline observed in initial build output\n`);
console.log(JSON.stringify({ branch: record.branch, mainGzipBytes: mainBytes, possibleSecretFiles, suites: summary.map(({ mode, runId, passed, failed, blocked }) => ({ mode, runId, passed, failed, blocked })) }, null, 2));
if (possibleSecretFiles.length) process.exitCode = 1;
