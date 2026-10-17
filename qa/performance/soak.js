const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  const minutes = Number(process.env.QA_SOAK_MINUTES || 30);
  assert.ok(Number.isFinite(minutes) && minutes >= 1 && minutes <= 120, 'QA_SOAK_MINUTES must be 1..120');
  const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true }); qa.setBrowser(browser);
  const players = [];
  const browserErrors = [];
  for (let i = 0; i < 5; i += 1) {
    const context = await browser.newContext();
    await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Realizator);
    const page = await context.newPage(); page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(`${qa.base}/video-details/${f.videos[1]._id}`);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate((video) => { video.loop = true; return video.play(); });
    players.push({ page, context });
  }
  const rows = [];
  const memory = [];
  const reauthentication = [];
  const reporterContext = await browser.newContext();
  await reporterContext.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Reporter);
  const reporter = await reporterContext.newPage();
  reporter.on('pageerror', (error) => browserErrors.push(error.message));
  await reporter.goto(`${qa.base}/reporter-dashboard`);
  await reporter.getByRole('button', { name: /Novi prilog/ }).click();
  await reporter.getByRole('textbox', { name: /^Event/ }).first().fill('QA nacrt tokom smjene');
  let uploads = 0; let downloads = 0;
  await test('SOAK-combined', `${minutes}-minute mixed API, five players, downloads and background processing`, async () => {
    const backlog = await qa.api('Admin', '/api/admin/hls-previews/build-missing', 'POST', { limit: 20 });
    assert.equal(backlog.status, 202);
    const start = performance.now(); let cycle = 0;
    const routes = [
      ['Reporter', '/api/edit-jobs/workspace?limit=20'], ['Editor', '/api/videos/workspace?limit=30&q=inse'],
      ['Producer', '/api/broadcast/library-search?limit=30'], ['Realizator', `/api/videos/details/${f.videos[1]._id}`],
      ['Archivist', '/api/archive/videos/workspace?limit=30'], ['Admin', '/api/admin/storage/overview'],
      ['Reporter2', '/api/notifications/workspace'], ['Editor2', '/api/corrections/workspace?limit=20'],
      ['VideoEditor', '/api/edit-jobs/workspace?limit=20'], ['Admin2', '/api/feedback/workspace?limit=20'],
    ];
    while (performance.now() - start < minutes * 60000) {
      await Promise.all(routes.map(async ([role, route]) => {
        const started = performance.now();
        try {
          let response = await qa.api(role, route);
          if (response.status === 403 && response.data?.code === 'AUTH_TOKEN_EXPIRED') {
            // Explicit test-user login, not a production refresh-token mechanism.
            const login = await qa.api(null, '/api/auth/login', 'POST', { username: f.users[role].username, password: qa.password });
            assert.equal(login.status, 200);
            qa.sessions[role] = { ...login.data.user, token: login.data.token };
            reauthentication.push({ role, channel: 'simulated-user-login', elapsedSeconds: (performance.now() - start) / 1000, expectedStatus: 403 });
            response = await qa.api(role, route);
          }
          rows.push({ role, path: route.split('?')[0], ms: performance.now() - started, status: response.status });
        } catch (error) { rows.push({ role, path: route.split('?')[0], ms: performance.now() - started, status: 0, error: error.message }); }
      }));
      const currentPage = cycle % 6 === 5 ? reporter : players[cycle % 6]?.page;
      if (currentPage) {
        await currentPage.bringToFront();
        const dialog = currentPage.getByRole('dialog', { name: 'Sesija je istekla' });
        if (await dialog.isVisible()) {
          await dialog.getByLabel(/^Lozinka/).fill(qa.password);
          await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).click();
          await dialog.waitFor({ state: 'hidden' });
          reauthentication.push({ role: currentPage === reporter ? 'Reporter' : 'Realizator', channel: 'browser-dialog', elapsedSeconds: (performance.now() - start) / 1000 });
          if (currentPage === reporter) assert.equal(await reporter.getByRole('textbox', { name: /^Event/ }).first().inputValue(), 'QA nacrt tokom smjene');
        }
      }
      if (cycle % 12 === 0) {
        await Promise.all([0, 1].map(async (index) => {
          const ticket = await qa.api('Editor', '/api/downloads/tickets', 'POST', { kind: 'video-bulk', payload: { videoIds: [String(f.videos[index]._id)] } });
          assert.equal(ticket.status, 201); assert.equal((await qa.api(null, ticket.data.downloadUrl)).status, 200); downloads += 1;
        }));
        if (process.platform === 'win32') {
          const pid = qa.getServerPid(); assert.ok(Number.isInteger(pid));
          const resource = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${pid} | Select-Object WorkingSet64,PrivateMemorySize64,CPU,Handles | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }));
          memory.push({ seconds: (performance.now() - start) / 1000, ...resource });
        }
      }
      if (cycle % 60 === 0) {
        const form = new FormData(); form.append('videos', new Blob([fs.readFileSync(f.source)]), `soak-${cycle}.mp4`);
        form.append('event', 'QA soak'); form.append('date', new Date().toISOString().slice(0, 10));
        form.append('codec', 'h264'); form.append('resolution', '1280x720'); form.append('bitrate', '1500'); form.append('framerate', '25');
        const response = await qa.api('Reporter', '/api/upload', 'POST', form);
        assert.ok([200, 202].includes(response.status), `Ingest during HLS backlog: ${response.status}`); uploads += 1;
      }
      if (cycle % 12 === 0) {
        fs.writeFileSync(path.join(qa.output, 'soak-progress.json'), JSON.stringify({ minutes, elapsedSeconds: (performance.now() - start) / 1000, apiSamples: rows.length, failedApiSamples: rows.filter((row) => row.status !== 200).length, uploads, downloads, browserErrors, memory, reauthentication }, null, 2));
        console.log(`Soak ${Math.round((performance.now() - start) / 60000)}/${minutes} min; API ${rows.length}; uploads ${uploads}; downloads ${downloads}`);
      }
      cycle += 1; await delay(5000);
    }
    const videoStates = [];
    for (const { page } of players) videoStates.push(await page.locator('video').evaluate((video) => ({ readyState: video.readyState, paused: video.paused, error: video.error?.code || null })));
    const sorted = rows.map((row) => row.ms).sort((a, b) => a - b);
    const result = { durationSeconds: (performance.now() - start) / 1000, apiSamples: rows.length, failures: rows.filter((row) => row.status !== 200), p95: sorted[Math.ceil(sorted.length * 0.95) - 1], uploads, downloads, hlsBacklogRequested: 20, memory, browserErrors, videoStates, reauthentication };
    fs.writeFileSync(path.join(qa.output, 'soak.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(qa.output, 'soak-api.json'), JSON.stringify(rows, null, 2));
    assert.deepEqual(browserErrors, []); assert.equal(result.failures.length, 0);
    assert.ok(videoStates.every((video) => video.readyState >= 2 && !video.error && !video.paused));
    if (minutes >= 75) {
      assert.ok(reauthentication.filter((row) => row.channel === 'simulated-user-login').length >= 10, 'All ten sessions must cross real JWT expiry');
      assert.ok(reauthentication.filter((row) => row.channel === 'browser-dialog').length >= 6, 'Five player tabs and the Reporter draft must reauthenticate explicitly');
    }
    return { durationSeconds: result.durationSeconds, apiSamples: rows.length, p95: result.p95, uploads, downloads };
  });
  for (const { context } of players) await context.close();
  await reporterContext.close();
};
