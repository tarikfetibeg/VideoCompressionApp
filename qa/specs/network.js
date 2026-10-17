const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { performance } = require('node:perf_hooks');
const { delay } = require('../../scripts/qa/environment');

module.exports = async (qa, f, test) => {
  const { paths } = qa.load('utils/storagePaths');
  const source = path.join(paths.final, 'network-120s.mp4');
  await qa.command(qa.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '9', '-i', f.source, '-t', '120', '-c', 'copy', '-movflags', '+faststart', source]);
  const video = await qa.models.Video.create({ filename: 'network-120s.mp4', originalFilename: 'QA mrežni pregled.mp4', filepath: source, compressedPath: source, uploader: f.users.Admin._id, status: 'edited', processingStatus: 'completed', duration: 120 });
  await qa.load('services/hlsPreviewService').buildHlsPreviewForVideo(video, { force: true });
  const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true }); qa.setBrowser(browser);
  const rows = [];
  for (const profile of [{ name: 'local', latency: 0, throughput: -1, maxMs: 3000 }, { name: '10Mbps-80ms', latency: 80, throughput: 1250000, maxMs: 6000 }]) {
    await test('NET-first-frame-' + profile.name, 'Real HLS first decoded frame, seek and quality: ' + profile.name, async () => {
      const context = await browser.newContext();
      await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Realizator);
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send('Network.enable');
      await client.send('Network.emulateNetworkConditions', { offline: false, latency: profile.latency, downloadThroughput: profile.throughput, uploadThroughput: profile.throughput });
      const resources = [];
      page.on('response', (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith('/api/media/')) resources.push({ path: url.pathname.replace(/[a-f0-9]{64}/g, '[TOKEN]'), status: response.status(), range: response.request().headers().range || null });
      });
      try {
        const started = performance.now();
        await page.goto(`${qa.base}/video-details/${video._id}`);
        await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, { timeout: 15000 });
        await page.locator('video').evaluate(async (el) => { await el.play(); await new Promise((resolve) => el.requestVideoFrameCallback(resolve)); });
        const firstFrameMs = performance.now() - started;
        const atFirstFrame = await page.locator('video').evaluate((el) => ({ duration: el.duration, bufferedEnd: el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0 }));
        assert.ok(atFirstFrame.duration > 100);
        assert.ok(atFirstFrame.bufferedEnd < atFirstFrame.duration, 'Playback must begin before the entire 120s asset is buffered');
        assert.ok(resources.some((row) => row.path.endsWith('.m3u8')));
        assert.ok(resources.some((row) => row.path.endsWith('.ts')));
        assert.ok(!resources.some((row) => row.path.endsWith('fallback.mp4')), 'HLS should not fetch a full MP4');
        await page.locator('video').evaluate((el) => { el.currentTime = 75; });
        await page.waitForFunction(() => document.querySelector('video')?.currentTime >= 75 && document.querySelector('video')?.readyState >= 2);
        for (const quality of ['480p', '720p', 'Auto']) {
          await page.getByRole('combobox', { name: 'Kvalitet' }).click();
          await page.getByRole('option', { name: quality, exact: true }).click();
        }
        const row = { profile: profile.name, firstFrameMs, includesColdPageLoad: true, ...atFirstFrame, resources };
        rows.push(row); fs.writeFileSync(path.join(qa.output, 'network-preview.json'), JSON.stringify(rows, null, 2));
        assert.ok(firstFrameMs <= profile.maxMs, `${firstFrameMs.toFixed(0)}ms exceeds ${profile.maxMs}ms`);
        return row;
      } finally { await context.close(); }
    });
  }
  await test('NET-range-fallback', 'Native MP4 fallback makes byte-range requests and starts before full download', async () => {
    const fallback = await qa.models.Video.create({ filename: 'fallback.mp4', filepath: source, compressedPath: source, uploader: f.users.Admin._id, status: 'edited', processingStatus: 'completed', duration: 120 });
    const context = await browser.newContext();
    await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions.Realizator);
    const page = await context.newPage(); const ranges = [];
    page.on('response', (response) => { if (response.url().endsWith('/fallback.mp4')) ranges.push({ status: response.status(), range: response.request().headers().range }); });
    try {
      await page.goto(`${qa.base}/video-details/${fallback._id}`);
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      await page.locator('video').evaluate((el) => el.play());
      assert.ok(ranges.some((row) => row.status === 206 && row.range));
      const state = await page.locator('video').evaluate((el) => ({ duration: el.duration, bufferedEnd: el.buffered.end(el.buffered.length - 1) }));
      assert.ok(state.bufferedEnd < state.duration);
      return { ranges, ...state };
    } finally { await context.close(); }
  });
  await test('NET-download-abort-retry', 'Client disconnect is reported and a deliberate retry can complete', async () => {
    const ticket = await qa.api('Editor', '/api/downloads/tickets', 'POST', { kind: 'video-single', payload: { videoId: String(video._id) } });
    assert.equal(ticket.status, 201);
    await new Promise((resolve, reject) => {
      const request = http.get(qa.base + ticket.data.downloadUrl, (response) => {
        assert.equal(response.statusCode, 200);
        response.once('data', () => { response.destroy(); request.destroy(); resolve(); });
        response.on('error', () => {});
      });
      request.once('error', reject);
      request.setTimeout(15000, () => { request.destroy(); reject(new Error('Download did not start')); });
    });
    let status;
    for (let i = 0; i < 40; i += 1) { status = await qa.api('Editor', `/api/downloads/tickets/${ticket.data.ticketId}/status`); if (status.data.status === 'aborted') break; await delay(100); }
    assert.equal(status.data.status, 'aborted');
    const retried = await qa.api(null, ticket.data.downloadUrl); assert.equal(retried.status, 200);
    assert.equal(retried.bytes.length, fs.statSync(source).size);
    return { aborted: true, retryBytes: retried.bytes.length, retryMeaning: 'full restart, not resumable ZIP/byte continuation' };
  });
  await browser.close();
};
