const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { createEnvironment } = require('./environment');
const { seed } = require('../../qa/fixtures/seed');

async function main() {
  process.env.QA_PORT = '5114'; process.env.QA_MONGO_PORT = '27114';
  const qa = await createEnvironment();
  let close;
  const stop = new Promise((resolve) => { close = resolve; });
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const stopFile = path.join(qa.runtime, 'assist-stop.json');
  const controlTimer = setInterval(() => { if (fs.existsSync(stopFile)) close(); }, 1000);
  rl.on('line', (line) => { if (line.trim().toLowerCase() === 'stop') close(); });
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, close);
  try {
    await seed(qa); await qa.startServer();
    const folder = path.join(qa.root, '.qa-private', qa.runId); fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'DEVICE_QA_ACCOUNTS.md');
    fs.writeFileSync(file, '# Disposable QA accounts\n\nOnly this isolated run; never production credentials.\n\nPassword: ' + qa.password + '\n\n' + Object.entries(qa.models.qaUsers).map(([role, user]) => '- ' + role + ': ' + user.username).join('\n'));
    const addresses = Object.values(os.networkInterfaces()).flat().filter((item) => item.family === 'IPv4' && !item.internal).map((item) => `http://${item.address}:${qa.port}`);
    fs.writeFileSync(path.join(qa.output, 'device-qa.json'), JSON.stringify({ status: 'awaiting-human-test', addresses, runId: qa.runId, remote: 'blocked: only production port5000 is exposed; do not redirect it', accountsFile: path.relative(qa.root, file).replace(/\\/g, '/') }, null, 2));
    console.log('QA_ASSIST ' + JSON.stringify({ runId: qa.runId, addresses, accountsFile: file }));
    console.log('Send stop on stdin or run npm run qa:assist:stop -- --run=' + qa.runId);
    await stop;
  } finally { clearInterval(controlTimer); rl.close(); await qa.cleanup(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
