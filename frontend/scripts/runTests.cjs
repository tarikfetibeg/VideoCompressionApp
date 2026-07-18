const { spawnSync } = require('child_process');
const path = require('path');

const forwardedArgs = process.argv
  .slice(2)
  .filter((arg) => arg !== '--watchAll=false' && arg !== '--watchAll');

const vitestCli = require.resolve('vitest/vitest.mjs', {
  paths: [path.resolve(__dirname, '..')],
});
const result = spawnSync(process.execPath, [vitestCli, 'run', ...forwardedArgs], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
