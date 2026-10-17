const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { delay } = require('../../scripts/qa/environment');

async function captureViewport(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    const snapshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    return Buffer.from(snapshot.data, 'base64');
  } finally { await cdp.detach(); }
}

module.exports = async (qa, f, test) => {
  const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true }); qa.setBrowser(browser);
  const contexts = [];
  async function open(role, route) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } }); contexts.push(context);
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.goto(qa.base + '/login');
    await page.evaluate((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
    await page.goto(qa.base + route);
    return { page, context };
  }
  await test('ACCEPT-reporter-create', 'Reporter creates a new job through the actual UI and double-click cannot create duplicates', async () => {
    const { page } = await open('Reporter', '/reporter-dashboard');
    await page.getByRole('button', { name: /Novi prilog/ }).click();
    await page.getByRole('textbox', { name: /Naziv joba/ }).fill('QA UI Novi prilog');
    const category = page.locator('.MuiFormControl-root').filter({ has: page.locator('label').filter({ hasText: /^Kategorija/ }) }).last();
    await category.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Prilog', exact: true }).click();
    await page.locator('table').getByRole('checkbox').first().check();
    let posts = 0;
    await page.route('**/api/edit-jobs', async (route) => {
      if (route.request().method() === 'POST') { posts += 1; await delay(600); }
      await route.continue();
    });
    const result = page.waitForResponse((response) => response.url().endsWith('/api/edit-jobs') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Pošalji produkciji', exact: true }).evaluate((button) => { button.click(); button.click(); });
    assert.equal((await result).status(), 201);
    await page.getByText('Edit job je poslan produkciji.', { exact: true }).waitFor();
    await delay(800);
    assert.equal(posts, 1, 'One user double-click must result in one POST');
    assert.equal(await qa.models.EditJob.countDocuments({ title: 'QA UI Novi prilog' }), 1);
    await page.screenshot({ path: path.join(qa.output, 'reporter-created-job.png') });
  });
  await test('ACCEPT-comment-notification', 'Actual editor comment reaches reporter bell via polling, opens job and clears unread', async () => {
    const { page: reporter } = await open('Reporter', '/reporter-dashboard');
    const { page: editor } = await open('Editor', `/edit-jobs/${f.jobs[0]._id}`);
    await editor.getByLabel('Dodaj komentar', { exact: true }).fill('QA komentar iz stvarnog UI-a');
    await editor.getByRole('button', { name: 'Pošalji komentar', exact: true }).click();
    await editor.getByText('QA komentar iz stvarnog UI-a', { exact: true }).waitFor();
    await reporter.bringToFront();
    await reporter.getByRole('button', { name: '1 nepročitanih notifikacija', exact: true }).waitFor({ timeout: 40000 });
    await reporter.getByRole('button', { name: '1 nepročitanih notifikacija', exact: true }).click();
    await reporter.getByRole('menuitem').filter({ hasText: String(f.jobs[0].title) }).first().click();
    await reporter.waitForURL(`**/edit-jobs/${f.jobs[0]._id}#comments`);
    await reporter.getByText('QA komentar iz stvarnog UI-a', { exact: true }).waitFor();
    await reporter.getByRole('button', { name: '0 nepročitanih notifikacija', exact: true }).waitFor();
  });
  await test('ACCEPT-audit-export', 'Admin JSON and CSV exports contain the displayed Unicode audit entries', async () => {
    await qa.models.AuditLog.create({ action: 'QA Špica export', performedBy: f.users.Admin._id, details: { note: 'Čćžšđ, "navodnici"' } });
    const { page } = await open('Admin', '/admin-dashboard');
    await page.getByRole('tab', { name: 'Audit', exact: true }).click();
    await page.getByText('QA Špica export', { exact: true }).waitFor();
    for (const label of ['CSV', 'JSON']) {
      const waiting = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const download = await waiting;
      const content = fs.readFileSync(await download.path(), 'utf8');
      assert.ok(content.includes('QA Špica export'));
      if (label === 'JSON') assert.ok(JSON.parse(content).some((item) => item.action === 'QA Špica export'));
      else assert.ok(content.includes('"timestamp","severity"'));
    }
  });
  await test('ACCEPT-download-retry', 'Failed download and failed retry stay visible; deliberate next retry saves a file without page errors', async () => {
    const { page } = await open('Editor', `/video-details/${f.videos[0]._id}`);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    let attempts = 0;
    await page.route('**/api/downloads/tickets', async (route) => {
      attempts += 1;
      if (attempts <= 2) await route.fulfill({ status: 503, json: { message: 'QA mreza privremeno nedostupna' } });
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByRole('button', { name: 'Ponovi', exact: true }).waitFor();
    const secondFailure = page.waitForResponse((response) => response.url().endsWith('/api/downloads/tickets') && attempts === 2);
    await page.getByRole('button', { name: 'Ponovi', exact: true }).click();
    await secondFailure;
    await page.getByRole('button', { name: 'Ponovi', exact: true }).waitFor();
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Ponovi', exact: true }).click();
    const download = await waiting;
    assert.equal(await download.failure(), null);
    assert.ok(fs.statSync(await download.path()).size > 0);
    assert.equal(attempts, 3); assert.deepEqual(errors, []);
    return { injectedFailures: 2, actualSavedDownload: true, unhandledErrors: errors.length };
  });
  await test('ACCEPT-hls-renewal', 'Client ticket expiry scheduling renews HLS at the current playhead without replacing the video element', async () => {
    const { page } = await open('Realizator', '/feedback');
    let tickets = 0;
    await page.route('**/api/media/tickets', async (route) => {
      const response = await route.fetch(); const data = await response.json(); tickets += 1;
      if (tickets === 1) data.expiresAt = new Date(Date.now() + 65000).toISOString();
      await route.fulfill({ response, json: data });
    });
    await page.goto(`${qa.base}/video-details/${f.videos[1]._id}`);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate((video) => { video.dataset.qaIdentity = 'retained'; video.currentTime = 3; return video.play(); });
    await page.waitForResponse((response) => response.url().endsWith('/api/media/tickets') && tickets >= 2, { timeout: 15000 });
    await page.waitForFunction(() => { const video = document.querySelector('video'); return video?.readyState >= 2 && video.currentTime >= 3; });
    assert.equal(await page.locator('video').getAttribute('data-qa-identity'), 'retained');
    return { clientSchedulingOnly: true, ticketsCreated: tickets, backendExpiryCoveredSeparately: true };
  });
  for (const context of contexts) await context.close();
  await browser.close();

  await test('ACCEPT-native-zoom', 'Native browser zoom 125/150/200/400 percent renders all seven roles without page overflow', async () => {
    const context = await pw.chromium.launchPersistentContext(path.join(qa.runtime, 'zoom-profile'), { channel: 'chrome', headless: true, viewport: null, args: ['--window-size=1366,900'] });
    qa.setBrowser(context);
    try {
      const settings = await context.newPage();
      await settings.goto('chrome://settings/appearance');
      await settings.locator('select#zoomLevel').waitFor();
      const matrix = [];
      for (const role of ['Reporter', 'Editor', 'VideoEditor', 'Producer', 'Realizator', 'Archivist', 'Admin']) {
        const route = role === 'VideoEditor' ? 'editor-dashboard' : role.toLowerCase() + '-dashboard';
        const page = await context.newPage();
        await settings.locator('select#zoomLevel').selectOption('1');
        await page.goto(qa.base + '/login');
        await page.evaluate((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
        await page.goto(`${qa.base}/${route}`);
        await page.locator('h1').first().waitFor();
        const baseline = await page.evaluate(() => ({ viewport: innerWidth, dpr: devicePixelRatio }));
        for (const factor of [1.25, 1.5, 2, 4]) {
          await settings.locator('select#zoomLevel').selectOption(String(factor));
          const confirmed = Number(await settings.locator('select#zoomLevel').inputValue());
          assert.equal(confirmed, factor);
          await page.waitForFunction(({ dpr, factor }) => Math.abs(devicePixelRatio / dpr - factor) < 0.01, { dpr: baseline.dpr, factor });
          await page.waitForTimeout(150);
          const dimensions = await page.evaluate(() => ({ viewport: innerWidth, height: innerHeight, width: document.documentElement.scrollWidth, dpr: devicePixelRatio }));
          assert.ok(Math.abs(dimensions.viewport - baseline.viewport / factor) < 4, 'Native zoom must shrink the actual CSS viewport');
          const header = page.locator('header.MuiAppBar-root');
          const headerState = await header.evaluate((element) => ({ height: element.getBoundingClientRect().height, position: getComputedStyle(element).position }));
          if (dimensions.height <= 400) {
            assert.equal(headerState.position, 'static', 'Short viewport must not be permanently covered by a sticky header');
            assert.ok(headerState.height <= dimensions.height * 0.6, `Idle compact header must leave at least 40 percent of the initial viewport for content: ${JSON.stringify({ role, factor, headerState, dimensions })}`);
            for (const name of ['Otvori navigaciju', 'Odjava']) assert.ok(await page.getByRole('button', { name, exact: true }).isVisible());
            assert.ok(await page.getByRole('button', { name: /nepročitanih notifikacija/ }).isVisible());
            for (const text of ['Upload miruje', 'Download miruje']) assert.ok(await page.getByText(text, { exact: true }).isVisible());
          } else assert.equal(headerState.position, 'sticky');
          // Capture the physical viewport: a CSS-sized clip truncates native zoom screenshots.
          const png = await captureViewport(context, page);
          const captured = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
          assert.ok(Math.abs(captured.width - dimensions.viewport * dimensions.dpr) <= 8, 'Capture must include the complete native-width viewport');
          assert.ok(Math.abs(captured.height - dimensions.height * dimensions.dpr) <= 8, 'Capture must include the complete native-height viewport');
          matrix.push({ role, nativeZoom: factor, confirmed, baseline, ...dimensions, captured, header: headerState });
          fs.writeFileSync(path.join(qa.output, `zoom-${role}-${factor}.png`), png);
          assert.ok(dimensions.width <= dimensions.viewport + 2, `${role} ${factor}: ${JSON.stringify(dimensions)}`);
          if (dimensions.height <= 400) {
            await page.evaluate(() => window.scrollTo(0, 400));
            await page.waitForFunction(() => document.querySelector('header.MuiAppBar-root').getBoundingClientRect().bottom <= 0);
            const scrolled = await captureViewport(context, page);
            assert.equal(scrolled.readUInt32BE(16), captured.width);
            assert.equal(scrolled.readUInt32BE(20), captured.height);
            fs.writeFileSync(path.join(qa.output, `zoom-${role}-${factor}-scrolled.png`), scrolled);
          }
        }
        await page.close();
      }
      fs.writeFileSync(path.join(qa.output, 'native-zoom.json'), JSON.stringify(matrix, null, 2));
      return { states: matrix.length, method: 'Chrome Settings native page zoom; verified live CSS viewport and DPR, no emulated DPI or CSS zoom' };
    } finally { await context.close(); }
  });
};
