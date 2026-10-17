const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

(async () => {
  const profile = path.resolve(__dirname, '../../.qa-private/zoom-probe-' + Date.now()); fs.mkdirSync(profile, { recursive: true });
  const context = await pw.chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: null, args: ['--window-size=1366,900'] });
  try {
    const page = await context.newPage();
    await page.goto('chrome://settings/appearance');
    await page.getByText('Page zoom', { exact: true }).waitFor();
    console.log(JSON.stringify(await page.locator('select').evaluateAll((elements) => elements.map((element) => ({ id: element.id, label: element.getAttribute('aria-label'), options: [...element.options].map((option) => ({ value: option.value, label: option.textContent })) }))), null, 2));
    const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Isolated QA zoom probe</h1>'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const app = await context.newPage(); await app.goto(`http://127.0.0.1:${server.address().port}`);
      const initial = await app.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio }));
      const values = [];
      for (const factor of [1.25, 1.5, 2, 4]) {
        await page.locator('select#zoomLevel').selectOption(String(factor));
        await app.waitForFunction(({ dpr, factor }) => Math.abs(devicePixelRatio / dpr - factor) < 0.01, { dpr: initial.dpr, factor });
        values.push({ factor, ...await app.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio })) });
      }
      console.log(JSON.stringify({ initial, nativeZoom: values }));
    } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  } finally { await context.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
