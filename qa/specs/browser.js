const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { delay } = require('../../scripts/qa/environment');

function loadPlaywright() {
  try { return require('playwright'); } catch (_) {
    return require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  }
}

const viewports = [
  [320, 568], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932],
  [844, 390], [915, 412], [768, 1024], [820, 1180], [1024, 1366], [960, 700],
  [1024, 768], [1280, 720], [1280, 800], [1366, 768], [1440, 900], [1536, 864],
  [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160],
  [599, 800], [600, 800], [601, 800], [899, 800], [900, 800], [901, 800],
];

async function geometry(page) {
  return page.evaluate(() => {
    const width = innerWidth;
    const hiddenOrLocallyScrolled = (el) => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.visibility === 'hidden' || style.display === 'none') return true;
        if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) return true;
      }
      return false;
    };
    return {
      width, documentWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('main button,main input,main h1,main h2,main h4,main h5,main .MuiPaper-root')]
        .filter((el) => el.getClientRects().length && !hiddenOrLocallyScrolled(el))
        .filter((el) => { const rect = el.getBoundingClientRect(); return rect.left < -2 || rect.right > width + 2; })
        .slice(0, 8).map((el) => ({ tag: el.tagName, text: el.textContent.slice(0, 90), right: Math.round(el.getBoundingClientRect().right), left: Math.round(el.getBoundingClientRect().left) })),
    };
  });
}

module.exports = async (qa, f, test) => {
  const extraJobs = Array.from({ length: 110 }, (_, index) => ({
    title: `QA paginacija job ${index}`, reporter: f.users.Reporter._id, contentType: f.categories.prilog._id,
    workspaceState: 'active', status: 'submitted', jobKind: 'standard', priority: 'normal',
    segments: [], comments: [], changeLog: [], viewerStates: [], downloadStates: [], createdAt: new Date(), updatedAt: new Date(Date.now() - index * 1000),
  }));
  await qa.models.EditJob.collection.insertMany(extraJobs);
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || 'chrome', headless: true });
  qa.setBrowser(browser);
  const screenshotRoot = path.join(qa.output, 'screenshots');
  fs.mkdirSync(screenshotRoot, { recursive: true });
  const responsive = [];
  const network = [];
  const contexts = {};
  async function pageFor(role) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'bs-BA', timezoneId: 'Europe/Sarajevo', acceptDownloads: true });
    await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
    const page = await context.newPage();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) network.push({ role, path: url.pathname.replace(/(\/media\/|\/downloads\/tickets\/)[a-f0-9]{64}/g, '$1[TOKEN]'), method: request.method() });
    });
    contexts[role] = { context, page, errors: [] };
    page.on('pageerror', (error) => contexts[role].errors.push(error.message));
    return page;
  }
  const screens = [
    ['Reporter', 'reporter-dashboard'], ['Editor', 'editor-dashboard'], ['VideoEditor', 'editor-dashboard'],
    ['Producer', 'producer-dashboard'], ['Realizator', 'realizator-dashboard'], ['Archivist', 'archivist-dashboard'], ['Admin', 'admin-dashboard'],
  ];
  for (const [role, route] of screens) {
    const page = await pageFor(role);
    await test(`UI-${role}-route`, `${role} real dashboard loads without runtime exception`, async () => {
      await page.goto(`${qa.base}/${route}`);
      await page.locator('main h1, main h4').first().waitFor({ timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      assert.equal(new URL(page.url()).pathname, '/' + route);
      assert.deepEqual(contexts[role].errors, []);
    });
    await test(`UI-${role}-matrix`, `${role} desktop/mobile/breakpoint matrix has no page overflow`, async () => {
      const failures = [];
      for (const [width, height] of viewports) {
        await page.setViewportSize({ width, height });
        await delay(80);
        const check = await geometry(page);
        const pass = check.documentWidth <= width + 2 && check.offenders.length === 0;
        const filename = `${role}-${width}x${height}.png`;
        await page.screenshot({ path: path.join(screenshotRoot, filename), animations: 'disabled' });
        responsive.push({ role, route, width, height, ...check, status: pass ? 'passed' : 'failed', screenshot: filename });
        if (!pass) failures.push(`${width}x${height} body=${check.documentWidth} ${check.offenders[0]?.text || ''}`);
      }
      assert.equal(failures.length, 0, failures.join('; '));
    });
  }
  const reporter = contexts.Reporter.page;
  await test('UI-reporter-lazy-preparation', 'New-story workspace loads on demand and keeps the upload draft across collapse', async () => {
    await reporter.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await reporter.getByLabel('Pretraga klipova', { exact: true }).count(), 0);
    const toggle = reporter.getByRole('button', { name: /Novi prilog/ });
    await toggle.click();
    await reporter.getByLabel('Pretraga klipova', { exact: true }).waitFor();
    const event = reporter.getByRole('textbox', { name: /^Event/ }).first();
    await event.fill('QA nacrt eventa');
    await toggle.click();
    await toggle.click();
    assert.equal(await event.inputValue(), 'QA nacrt eventa');
    await toggle.click();
  });
  await test('UI-reporter-pagination', 'Reporter can reach more than 100 active jobs', async () => {
    await reporter.setViewportSize({ width: 390, height: 844 });
    await reporter.getByRole('button', { name: /page 3/i }).click();
    await reporter.waitForResponse((response) => response.url().includes('/edit-jobs/workspace?') && response.url().includes('page=3'));
    await reporter.getByRole('button', { name: /page 1/i }).click();
    await reporter.getByRole('button', { name: 'Komentari', exact: true }).first().waitFor();
  });
  await test('UI-mobile-navigation', 'Temporary navigation is above sticky header and keyboard dismissible', async () => {
    await reporter.setViewportSize({ width: 390, height: 844 });
    await reporter.getByRole('button', { name: 'Otvori navigaciju', exact: true }).click();
    const paper = reporter.locator('.MuiDrawer-modal .MuiDrawer-paper').last();
    await paper.waitFor();
    try {
      assert.ok(await paper.evaluate((el) => el.contains(document.elementFromPoint(30, 30))), 'Sticky header overlaps mobile navigation');
    } finally { await reporter.keyboard.press('Escape'); }
    await paper.waitFor({ state: 'hidden' });
  });
  await test('UI-reporter-drawer', 'Reporter quick panel overlays header; Escape closes', async () => {
    await reporter.setViewportSize({ width: 390, height: 844 });
    await reporter.getByRole('button', { name: 'Komentari', exact: true }).first().click();
    const drawer = reporter.locator('.MuiDrawer-modal .MuiDrawer-paper').last();
    await drawer.waitFor();
    const rect = await drawer.boundingBox();
    assert.equal(Math.round(rect.y), 0);
    const onTop = await drawer.evaluate((el) => el.contains(document.elementFromPoint(innerWidth - 30, 30)));
    assert.ok(onTop, 'Header is above quick drawer');
    await reporter.screenshot({ path: path.join(screenshotRoot, 'Reporter-quick-drawer.png') });
    await reporter.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
  });
  await test('UI-reporter-panel-append', 'Add material from quick panel opens a visible dialog above all layers', async () => {
    await reporter.getByRole('button', { name: 'Komentari', exact: true }).first().click();
    const panel = reporter.locator('.MuiDrawer-modal .MuiDrawer-paper').last();
    await panel.getByRole('button', { name: 'Dodaj klipove', exact: true }).click();
    const dialog = reporter.getByRole('dialog'); await dialog.waitFor();
    const button = dialog.getByRole('button', { name: 'Zatvori', exact: true });
    await button.click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await reporter.locator('.MuiDrawer-modal .MuiDrawer-paper:visible').count(), 0);
  });
  await test('UI-reporter-archive', 'Reporter TV archive searchable; add-clips dialog has server preview', async () => {
    await reporter.setViewportSize({ width: 1366, height: 768 });
    await reporter.getByRole('button', { name: 'Dodaj klipove', exact: true }).first().click();
    const dialog = reporter.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('tab', { name: 'Sa servera', exact: true }).click();
    await dialog.getByTestId('video-thumbnail-preview').first().waitFor();
    assert.ok(await dialog.getByRole('link').count() > 0, 'No Video Details link');
    await reporter.waitForFunction(() => {
      const paper = document.querySelector('[role="dialog"]');
      return paper && getComputedStyle(paper.parentElement).opacity === '1';
    });
    await reporter.screenshot({ path: path.join(screenshotRoot, 'Reporter-add-material.png') });
    await dialog.getByRole('button', { name: 'Zatvori', exact: true }).click();
    await reporter.getByRole('tab', { name: 'Arhiva', exact: true }).click();
    await reporter.getByRole('tab', { name: 'TV arhiva', exact: true }).click();
    await reporter.getByTestId('video-thumbnail-preview').first().waitFor();
  });
  const editor = contexts.Editor.page;
  await test('UI-editor-material', 'Production material layout and bounded lazy previews', async () => {
    await editor.setViewportSize({ width: 1366, height: 768 });
    await editor.getByRole('tab', { name: 'Materijal', exact: true }).click();
    await editor.locator('tbody tr').first().waitFor();
    await delay(500);
    const thumbnails = network.filter((r) => r.role === 'Editor' && r.path.startsWith('/api/videos/thumbnail/')).length;
    assert.ok(thumbnails < 100, `Loaded ${thumbnails} thumbnails eagerly`);
    await editor.screenshot({ path: path.join(screenshotRoot, 'Editor-material.png') });
    const next = editor.getByRole('button', { name: /page 2/i });
    await next.click();
    await editor.waitForResponse((response) => response.url().includes('/videos/workspace?') && response.url().includes('page=2'));
    return { thumbnailRequests: thumbnails };
  });
  const admin = contexts.Admin.page;
  await test('UI-correction-live-mobile', 'An archive report appears in the open editor queue within one polling interval; mobile row actions remain visible', async () => {
    await editor.bringToFront();
    await editor.setViewportSize({ width: 390, height: 844 });
    await Promise.all([
      editor.waitForResponse((response) => response.url().includes('/api/corrections/workspace') && response.status() === 200),
      editor.getByRole('tab', { name: 'Ispravke', exact: true }).click(),
    ]);
    await editor.getByText('Nema otvorenih ispravki', { exact: true }).waitFor();
    const note = 'QA nova arhivska prijava na otvorenom tabu';
    const response = await qa.api('Archivist', `/api/corrections/video/${f.videos[1]._id}/ensure`, 'POST', { note, timestamp: 2 });
    assert.equal(response.status, 201);
    const row = editor.locator('tbody tr').filter({ hasText: note });
    await row.waitFor({ timeout: 40000 });
    await row.scrollIntoViewIfNeeded();
    assert.equal(await row.getByRole('button', { name: 'Započni', exact: true }).count(), 1);
    await editor.screenshot({ path: path.join(screenshotRoot, 'Editor-correction-mobile-row.png') });
    const check = await geometry(editor);
    const headerBounds = await editor.locator('thead').evaluateAll((headers) => headers.map((header) => ({ display: getComputedStyle(header).display, position: getComputedStyle(header).position, right: header.getBoundingClientRect().right, scrollWidth: header.scrollWidth })));
    assert.ok(check.documentWidth <= 392, JSON.stringify({ ...check, headerBounds }));
    const archive = contexts.Archivist.page;
    await archive.bringToFront();
    await archive.setViewportSize({ width: 390, height: 844 });
    await archive.locator('tbody tr').first().scrollIntoViewIfNeeded();
    await archive.screenshot({ path: path.join(screenshotRoot, 'Archivist-mobile-row.png') });
    const archiveCheck = await geometry(archive); assert.ok(archiveCheck.documentWidth <= 392);
  });
  for (const module of ['Korisnici', 'Video', 'Jobs', 'FFmpeg', 'Maintenance', 'Programi', 'Feedback', 'Audit']) {
    await test(`UI-admin-${module}`, `Admin ${module} at mobile and desktop sizes`, async () => {
      await admin.getByRole('tab', { name: module, exact: true }).click();
      await admin.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      const errors = [];
      for (const [width, height] of [[390, 844], [1366, 768], [1920, 1080]]) {
        await admin.setViewportSize({ width, height });
        await delay(100);
        const check = await geometry(admin);
        const pass = check.documentWidth <= width + 2 && check.offenders.length === 0;
        responsive.push({ role: 'Admin', route: module, width, height, ...check, status: pass ? 'passed' : 'failed' });
        await admin.screenshot({ path: path.join(screenshotRoot, `Admin-${module}-${width}.png`), animations: 'disabled' });
        if (!pass) errors.push(`${width}: ${check.documentWidth} ${check.offenders[0]?.text || ''}`);
      }
      assert.equal(errors.length, 0, errors.join('; '));
    });
  }
  await test('UI-HLS', 'Video Details plays HLS, seeks and displays real nonblank frames', async () => {
    const page = contexts.Realizator.page;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${qa.base}/video-details/${f.videos[1]._id}`);
    await page.locator('video').waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, { timeout: 30000 });
    const media = await page.locator('video').evaluate(async (video) => {
      await video.play();
      return { width: video.videoWidth, height: video.videoHeight, src: video.currentSrc };
    });
    assert.ok(media.width > 0);
    await page.waitForFunction(() => document.querySelector('video').currentTime > 0.2);
    await page.locator('video').evaluate((video) => { video.currentTime = 6; });
    await page.waitForFunction(() => document.querySelector('video').currentTime >= 6 && document.querySelector('video').readyState >= 2);
    const variation = await page.locator('video').evaluate((video) => {
      const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 9;
      const context = canvas.getContext('2d'); context.drawImage(video, 0, 0, 16, 9);
      return new Set(context.getImageData(0, 0, 16, 9).data).size;
    });
    assert.ok(variation > 10, 'Blank video canvas');
    assert.ok(network.some((r) => r.role === 'Realizator' && r.path.endsWith('.m3u8')));
    assert.ok(network.some((r) => r.role === 'Realizator' && r.path.endsWith('.ts')));
    for (const quality of ['480p', '720p', 'Auto']) {
      await page.locator('video').evaluate((video) => { video.currentTime = 1; return video.play(); });
      await page.getByRole('combobox', { name: 'Kvalitet', exact: true }).click();
      await page.getByRole('option', { name: quality, exact: true }).click();
      if (quality !== 'Auto') await page.waitForFunction((height) => document.querySelector('video').videoHeight === height, Number.parseInt(quality), { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
    }
    await page.screenshot({ path: path.join(screenshotRoot, 'VideoDetails-HLS.png') });
    return { decodedWidth: media.width, decodedHeight: media.height, pixelValues: variation };
  });
  await test('UI-mobile-rundown', 'Producer and Realizator reorder rundown using touch and keyboard without drag', async () => {
    for (const [role, route] of [['Producer', 'producer-dashboard'], ['Realizator', 'realizator-dashboard']]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      try {
        await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
        const page = await context.newPage(); await page.goto(`${qa.base}/${route}`);
        const up = page.getByRole('button', { name: 'Pomjeri gore', exact: true });
        const down = page.getByRole('button', { name: 'Pomjeri dolje', exact: true });
        await up.first().waitFor();
        assert.equal(await up.first().isDisabled(), true);
        const before = (await qa.models.ShowDay.findById(f.show._id)).items.filter((item) => item.status !== 'removed').sort((a, b) => a.order - b.order).map((item) => String(item.video));
        const response = page.waitForResponse((r) => r.url().includes('/reorder') && r.request().method() === 'PATCH');
        await down.first().tap(); assert.equal((await response).status(), 200);
        await delay(300);
        const after = (await qa.models.ShowDay.findById(f.show._id)).items.filter((item) => item.status !== 'removed').sort((a, b) => a.order - b.order).map((item) => String(item.video));
        assert.deepEqual(after, [...before].reverse());
        await up.nth(1).focus();
        const keyboardResponse = page.waitForResponse((r) => r.url().includes('/reorder') && r.request().method() === 'PATCH');
        await page.keyboard.press('Enter'); assert.equal((await keyboardResponse).status(), 200);
        await page.screenshot({ path: path.join(screenshotRoot, `${role}-touch-rundown.png`) });
      } finally { await context.close(); }
    }
  });
  await test('UI-download-background', 'Download preparation guard and browser handoff survive SPA navigation', async () => {
    const page = contexts.Editor.page;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(`${qa.base}/video-details/${f.videos[1]._id}`);
    await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
    await page.route('**/api/downloads/tickets', async (route) => { await delay(1500); await route.continue(); });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.getByRole('button', { name: 'Download', exact: true }).click();
    await page.getByText('Download manager', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), 'No preparation beforeunload guard');
    const feedbackLink = page.locator('a[href="/feedback"]').first();
    await feedbackLink.click();
    await page.waitForURL('**/feedback');
    await page.getByText('Download manager', { exact: true }).waitFor();
    const download = await downloadPromise;
    const output = path.join(qa.runtime, 'browser-download.mp4'); await download.saveAs(output);
    assert.equal(await download.failure(), null);
    assert.equal(fs.statSync(output).size, fs.statSync(f.videos[1].compressedPath).size);
    await page.unroute('**/api/downloads/tickets');
  });
  await test('UI-producer-permission', 'Producer direct navigation to production is denied', async () => {
    const page = contexts.Producer.page;
    await page.goto(qa.base + '/editor-dashboard');
    await page.waitForURL((url) => url.pathname !== '/editor-dashboard');
    assert.notEqual(new URL(page.url()).pathname, '/editor-dashboard');
  });
  await test('UI-engine-smoke', 'Alternate browser engines render all seven role dashboards at mobile/desktop sizes', async () => {
    const engines = [];
    for (const name of ['firefox', 'webkit']) {
      let other;
      try { other = await pw[name].launch({ headless: true }); }
      catch (error) {
        if (!/executable|browser.*install|spawn UNKNOWN/i.test(error.message)) throw error;
        engines.push({ engine: name, status: 'blocked', reason: error.message.split('\n')[0] });
        continue;
      }
        try {
          for (const [role, route] of screens) {
            for (const [width, height] of [[390, 844], [1366, 768]]) {
              const context = await other.newContext({ viewport: { width, height } });
              try {
                await context.addInitScript((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
                const page = await context.newPage(); const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                await page.goto(`${qa.base}/${route}`); await page.locator('main h1, main h4').first().waitFor();
                await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                const check = await geometry(page); assert.ok(check.documentWidth <= width + 2, JSON.stringify({ engine: name, role, ...check }));
                assert.deepEqual(errors, []);
                engines.push({ engine: name, version: other.version(), role, width, height, status: 'passed' });
                await page.screenshot({ path: path.join(screenshotRoot, `${name}-${role}-${width}.png`) });
              } finally { await context.close(); }
            }
          }
        } finally { await other.close(); }
    }
    fs.writeFileSync(path.join(qa.output, 'browser-engines.json'), JSON.stringify({ primary: await browser.version(), engines }, null, 2));
    return { status: engines.every((engine) => engine.status === 'blocked') ? 'blocked' : 'passed', engines };
  });
  fs.writeFileSync(path.join(qa.output, 'responsive.json'), JSON.stringify(responsive, null, 2));
  fs.writeFileSync(path.join(qa.output, 'RESPONSIVE_MATRICA.csv'), 'role,screen,width,height,status,documentWidth\n' + responsive.map((r) => `${r.role},${r.route},${r.width},${r.height},${r.status},${r.documentWidth}`).join('\n'));
  fs.writeFileSync(path.join(qa.output, 'network-sanitized.json'), JSON.stringify(network, null, 2));
  for (const { context } of Object.values(contexts)) await context.close();
  await require('../performance/browserLab')(qa, pw, browser, f, test);
};
