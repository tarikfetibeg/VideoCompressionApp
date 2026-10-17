const fs = require('node:fs');
const path = require('node:path');
const { createEnvironment } = require('./environment');
const { seed } = require('../../qa/fixtures/seed');

const mode = process.argv[2] || 'api';
if (mode === 'session' && !process.env.QA_PORT) {
  process.env.QA_PORT = '5112';
  process.env.QA_MONGO_PORT = process.env.QA_MONGO_PORT || '27112';
}
if (mode === 'ui' && !process.env.QA_PORT) {
  process.env.QA_PORT = '5113';
  process.env.QA_MONGO_PORT = process.env.QA_MONGO_PORT || '27113';
}
if (mode === 'tickets' && !process.env.QA_PORT) {
  process.env.QA_PORT = '5115'; process.env.QA_MONGO_PORT = process.env.QA_MONGO_PORT || '27115';
}
if (!['api', 'edges', 'policy', 'maintenance', 'browser', 'ui', 'session', 'network', 'tickets', 'performance', 'media', 'benchmark', 'lighthouse', 'soak', 'all'].includes(mode)) throw new Error('Unknown QA mode.');
const results = [];
async function main() {
  const qa = await createEnvironment();
  console.log(`QA run ${qa.runId}; isolated application on ${qa.port}`);
  const test = async (id, name, work) => {
    const started = Date.now();
    try {
      const detail = await work();
      const status = detail?.status === 'blocked' ? 'blocked' : 'passed';
      results.push({ id, name, status, ms: Date.now() - started, detail });
      console.log(`${status.toUpperCase()} ${id} ${name}`);
    } catch (error) {
      results.push({ id, name, status: 'failed', ms: Date.now() - started, error: error.message });
      console.log(`FAIL ${id} ${name}: ${error.message}`);
    }
    fs.writeFileSync(path.join(qa.output, 'results.json'), JSON.stringify(results, null, 2));
  };
  let closing = false;
  async function cleanup() { if (!closing) { closing = true; await qa.cleanup(); } }
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, async () => { await cleanup(); process.exit(130); });
  try {
    console.log('Generating isolated fixtures and controlled indexes...');
    const fixture = await seed(qa);
    await qa.startServer();
    if (mode === 'api' || mode === 'all') {
      await require('../../qa/specs/api')(qa, fixture, test);
      await require('../../qa/specs/workflows')(qa, fixture, test);
    }
    if (mode === 'browser' || mode === 'all') await require('../../qa/specs/browser')(qa, fixture, test);
    if (mode === 'session') await require('../../qa/specs/session')(qa, fixture, test);
    if (mode === 'edges') await require('../../qa/specs/edgeCases')(qa, fixture, test);
    if (mode === 'ui') await require('../../qa/specs/uiAcceptance')(qa, fixture, test);
    if (mode === 'maintenance') await require('../../qa/specs/maintenance')(qa, fixture, test);
    if (mode === 'policy') await require('../../qa/specs/policyChecks')(qa, fixture, test);
    if (mode === 'network') await require('../../qa/specs/network')(qa, fixture, test);
    if (mode === 'tickets') await require('../../qa/specs/ticketLifecycle')(qa, fixture, test);
    if (mode === 'performance' || mode === 'all') await require('../../qa/performance/workspace')(qa, fixture, test);
    if (mode === 'soak') await require('../../qa/performance/soak')(qa, fixture, test);
    if (mode === 'media') await require('../../qa/specs/media')(qa, fixture, test);
    if (mode === 'benchmark') await require('../../qa/performance/mediaBenchmark')(qa, fixture, test);
    if (mode === 'lighthouse') await require('../../qa/performance/lighthouse')(qa, fixture, test);
  } finally {
    await cleanup();
    fs.writeFileSync(path.join(qa.output, 'results.json'), JSON.stringify(results, null, 2));
    const rows = results.map((r) => `| ${r.id} | ${r.name.replace(/\|/g, '/')} | ${r.status} | ${r.ms} |`);
    fs.writeFileSync(path.join(qa.output, 'IZVJESTAJ.md'), `# QA ${qa.runId}\n\nMode: ${mode}. Node: ${process.version}. Queue: local.\n\n| ID | Scenario | Status | ms |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\nRezultati ne obuhvataju nedostupne fizicke mobilne uredjaje, remote mrezu ili Redis ako nije posebno naveden. Privatni runtime logovi/credentials nisu u ovom izvjestaju.\n`);
    console.log(`Results: ${qa.output}`);
  }
  if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
}

main().catch((error) => { console.error('QA aborted:', error.message); process.exitCode = 1; });
