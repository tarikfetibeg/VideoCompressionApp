const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
function files(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink() || entry.name === 'node_modules') return [];
    return entry.isDirectory() ? files(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}
const results = ['backend', 'qa', 'scripts', 'tests/backend'].flatMap((folder) => files(path.join(root, folder))).map((file) => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  return { file: path.relative(root, file).replace(/\\/g, '/'), passed: result.status === 0, error: result.status === 0 ? undefined : result.stderr };
});
const output = path.join(root, 'analysis/qa/checks'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'syntax.json'), JSON.stringify({ createdAt: new Date().toISOString(), node: process.version, results }, null, 2));
console.log(`${results.length} syntax checks; ${results.filter((result) => !result.passed).length} failures.`);
if (results.some((result) => !result.passed)) process.exitCode = 1;
