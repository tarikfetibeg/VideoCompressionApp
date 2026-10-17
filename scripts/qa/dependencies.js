const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'analysis/qa/dependencies');
fs.mkdirSync(output, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm || !fs.existsSync(npm)) throw new Error('Run through npm run qa:dependencies.');
const summaries = [];
for (const [name, cwd] of [['backend-root', root], ['frontend', path.join(root, 'frontend')]]) {
  const result = spawnSync(process.execPath, [npm, 'audit', '--json'], { cwd, windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) throw result.error;
  const report = JSON.parse(result.stdout);
  if (report.error) throw new Error(JSON.stringify(report.error));
  fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(report, null, 2));
  summaries.push({ scope: name, counts: report.metadata.vulnerabilities, packages: Object.values(report.vulnerabilities).map((item) => ({ name: item.name, severity: item.severity, direct: item.isDirect, fixAvailable: item.fixAvailable, advisories: item.via.filter((via) => typeof via === 'object').map(({ title, url, range }) => ({ title, url, range })) })) });
}
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ createdAt: new Date().toISOString(), node: process.version, automaticChanges: false, summaries }, null, 2));
console.log(JSON.stringify(summaries.map(({ scope, counts }) => ({ scope, counts })), null, 2));
