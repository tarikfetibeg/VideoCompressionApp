const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

module.exports = async (qa, f, test) => {
  const cache = path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx');
  const moduleFolder = process.env.QA_LIGHTHOUSE_MODULE || fs.readdirSync(cache).map((name) => path.join(cache, name, 'node_modules/lighthouse')).find((folder) => {
    try { return JSON.parse(fs.readFileSync(path.join(folder, 'package.json'))).version === '12.8.2'; } catch (_) { return false; }
  });
  if (!moduleFolder) {
    await test('LH-unavailable', 'Lighthouse lab runtime', async () => ({ status: 'blocked', reason: 'Install test-only Lighthouse 12.8.2 cache or set QA_LIGHTHOUSE_MODULE' }));
    return;
  }
  const { default: lighthouse } = await import(pathToFileURL(path.join(moduleFolder, 'core/index.js')).href);
  const { throttling } = await import(pathToFileURL(path.join(moduleFolder, 'core/config/constants.js')).href);
  const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const port = Number(process.env.QA_DEBUG_PORT || 9227);
  await new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
  const metrics = [];
  for (const [role, route, mobile] of [['Reporter', 'reporter-dashboard', true], ['Editor', 'editor-dashboard', false]]) {
    const context = await pw.chromium.launchPersistentContext(path.join(qa.runtime, 'lighthouse-' + role), { channel: 'chrome', headless: true, args: [`--remote-debugging-port=${port}`] });
    try {
      const page = await context.newPage();
      await page.goto(qa.base + '/login');
      await page.evaluate((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
      await page.goto(`${qa.base}/${route}`);
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await test(`LH-${role}-${repeat}`, 'Authenticated Lighthouse diagnostic capture: ' + role, async () => {
          const result = await lighthouse(`${qa.base}/${route}`, {
            port, logLevel: 'error', output: 'json', disableStorageReset: true,
            onlyCategories: ['performance', 'accessibility', 'best-practices'],
            formFactor: mobile ? 'mobile' : 'desktop', throttlingMethod: 'simulate',
            throttling: mobile ? throttling.mobileSlow4G : throttling.desktopDense4G,
            screenEmulation: { mobile, width: mobile ? 390 : 1366, height: mobile ? 844 : 768, deviceScaleFactor: 1, disabled: false },
          });
          assert.equal(new URL(result.lhr.finalDisplayedUrl).pathname, '/' + route, 'Audit reached login rather than authenticated application');
          assert.equal(result.lhr.runtimeError, undefined);
          const row = { role, repeat, mobile, lighthouseVersion: result.lhr.lighthouseVersion, scores: Object.fromEntries(Object.entries(result.lhr.categories).map(([key, value]) => [key, value.score])), metrics: Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index'].map((name) => [name, result.lhr.audits[name].numericValue])), failures: Object.values(result.lhr.audits).filter((audit) => audit.score !== null && audit.score < 1).map(({ id, title, score }) => ({ id, title, score })) };
          metrics.push(row);
          let sanitized = JSON.stringify(result.lhr, null, 2);
          for (const session of Object.values(qa.sessions)) sanitized = sanitized.replaceAll(session.token, '[REDACTED]');
          sanitized = sanitized.replace(/(\/media\/|\/downloads\/tickets\/)[a-f0-9]{64}/g, '$1[TOKEN]');
          fs.writeFileSync(path.join(qa.output, `lighthouse-${role}-${repeat}.json`), sanitized);
          fs.writeFileSync(path.join(qa.output, 'lighthouse-summary.json'), JSON.stringify({ diagnosticOnly: true, notFieldINP: true, simulatedMobile: true, applicationDependenciesUnchanged: true, metrics }, null, 2));
          return row;
        });
      }
    } finally { await context.close(); }
  }
};
