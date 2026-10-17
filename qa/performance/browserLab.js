const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { delay } = require('../../scripts/qa/environment');
const p95 = (values) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];

module.exports = async (qa, pw, browser, f, test) => {
  const records = [];
  for (const [role, route, width, height] of [['Reporter', 'reporter-dashboard', 390, 844], ['Editor', 'editor-dashboard', 1366, 768]]) {
    await test(`LAB-${role}-cold-warm`, 'Ten cold and ten warm first-usable list samples: ' + role, async () => {
      for (let sample = 0; sample < 10; sample += 1) {
        const context = await browser.newContext({ viewport: { width, height } });
        try {
          await context.addInitScript((session) => {
            localStorage.setItem('user', JSON.stringify(session));
            window.qaLab = { longTasks: 0, longestTask: 0, lcp: null };
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) { window.qaLab.longTasks += 1; window.qaLab.longestTask = Math.max(window.qaLab.longestTask, entry.duration); }
            }).observe({ type: 'longtask', buffered: true });
            new PerformanceObserver((list) => { window.qaLab.lcp = list.getEntries().at(-1)?.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
          }, qa.sessions[role]);
          const page = await context.newPage();
          for (const cache of ['cold', 'warm']) {
            const started = performance.now();
            await page.goto(`${qa.base}/${route}`);
            if (role === 'Reporter') await page.getByRole('button', { name: 'Komentari', exact: true }).first().waitFor();
            else await page.locator('tbody tr').first().waitFor();
            const usableMs = performance.now() - started;
            await delay(200);
            const browserMetrics = await page.evaluate(() => ({ ...window.qaLab, jsTransferBytes: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/static/js/')).reduce((bytes, entry) => bytes + entry.transferSize, 0) }));
            records.push({ role, width, height, sample, cache, usableMs, ...browserMetrics, unthrottledLocal: true });
          }
        } finally { await context.close(); }
      }
      const samples = records.filter((record) => record.role === role);
      const coldP95 = p95(samples.filter((record) => record.cache === 'cold').map((record) => record.usableMs));
      const warmP95 = p95(samples.filter((record) => record.cache === 'warm').map((record) => record.usableMs));
      fs.writeFileSync(path.join(qa.output, 'browser-lab.json'), JSON.stringify(records, null, 2));
      assert.ok(coldP95 < 3000 && warmP95 < 3000, `First usable list p95 ${coldP95}/${warmP95} ms`);
      return { coldP95, warmP95, samples: 20, notFieldINP: true, notLighthouse: true };
    });
  }
  await test('UI-width-sweep-DPR', 'Reporter continuous-width sample and 1/1.25/1.5/2 DPR reflow', async () => {
    const checks = [];
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr });
      try {
        await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Reporter);
        const page = await context.newPage(); await page.goto(qa.base + '/reporter-dashboard');
        await page.getByRole('button', { name: 'Komentari', exact: true }).first().waitFor();
        const widths = dpr === 1 ? Array.from({ length: 41 }, (_, i) => 320 + i * 40) : [320, 390, 768, 1366];
        for (const width of widths) {
          await page.setViewportSize({ width, height: 844 }); await delay(30);
          const value = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, dpr: devicePixelRatio }));
          checks.push(value); assert.ok(value.scrollWidth <= width + 2, JSON.stringify(value));
        }
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(qa.output, 'width-sweep-dpr.json'), JSON.stringify({ checks, actualBrowserZoomTested: false }, null, 2));
  });
  await test('UI-Edge-media', 'Branded Edge renders, decodes HLS and seeks', async () => {
    let edge;
    try { edge = await pw.chromium.launch({ channel: 'msedge', headless: true }); }
    catch (error) { return { status: 'blocked', reason: error.message.split('\n')[0] }; }
    try {
      const context = await edge.newContext();
      await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Realizator);
      const page = await context.newPage(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${qa.base}/video-details/${f.videos[1]._id}`);
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      await page.locator('video').evaluate((video) => { video.currentTime = 5; return video.play(); });
      await page.waitForFunction(() => document.querySelector('video').currentTime > 5.2);
      assert.deepEqual(errors, []); return { version: edge.version() };
    } finally { await edge.close(); }
  });
};
