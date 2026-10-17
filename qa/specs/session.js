const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (qa, f, test) => {
  const jwt = require('jsonwebtoken');
  const expired = (role) => jwt.sign({ id: String(f.users[role]._id), role: f.users[role].role }, qa.env.JWT_SECRET, { expiresIn: -1 });
  await test('SESSION-codes', 'Real API distinguishes missing, invalid and expired JWT without changing permission statuses', async () => {
    const missing = await qa.api(null, '/api/videos/workspace');
    assert.equal(missing.status, 401); assert.equal(missing.data.code, 'AUTH_TOKEN_MISSING');
    const response = await fetch(qa.base + '/api/videos/workspace', { headers: { Authorization: 'Bearer ' + expired('Reporter') } });
    assert.equal(response.status, 403); assert.equal((await response.json()).code, 'AUTH_TOKEN_EXPIRED');
    assert.equal((await qa.api('Producer', '/api/admin/users')).status, 403);
  });
  const pw = require(process.env.QA_PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const browser = await pw.chromium.launch({ channel: 'chrome', headless: true }); qa.setBrowser(browser);
  async function pageFor(role, route) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(qa.base + '/login');
    await page.evaluate((session) => localStorage.setItem('user', JSON.stringify(session)), qa.sessions[role]);
    await page.goto(qa.base + route);
    return { page, context };
  }
  async function expire(page, role) {
    await page.evaluate((token) => {
      const account = JSON.parse(localStorage.getItem('user')); account.token = token;
      localStorage.setItem('user', JSON.stringify(account));
      document.dispatchEvent(new Event('visibilitychange'));
    }, expired(role));
    await page.getByRole('dialog', { name: 'Sesija je istekla' }).waitFor();
  }
  async function login(page) {
    const dialog = page.getByRole('dialog', { name: 'Sesija je istekla' });
    await dialog.getByLabel(/^Lozinka/).fill(qa.password);
    await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await test('SESSION-draft', 'Reporter reauth preserves mounted draft, handles wrong password and restores API reads', async () => {
    const { page, context } = await pageFor('Reporter', '/reporter-dashboard');
    try {
      await page.getByRole('button', { name: /Novi prilog/ }).click();
      const event = page.getByRole('textbox', { name: /^Event/ }).first();
      await event.fill('QA sačuvani nacrt');
      await event.evaluate((el) => { el.dataset.qaPreserved = 'true'; });
      await expire(page, 'Reporter');
      const dialog = page.getByRole('dialog', { name: 'Sesija je istekla' });
      await page.keyboard.press('Escape'); assert.ok(await dialog.isVisible());
      await dialog.getByLabel(/^Lozinka/).fill('wrong-qa-password');
      await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(qa.output, 'session-mobile.png') });
      await login(page);
      assert.equal(await event.inputValue(), 'QA sačuvani nacrt');
      assert.equal(await event.getAttribute('data-qa-preserved'), 'true');
      assert.notEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('user')).token), expired('Reporter'));
    } finally { await context.close(); }
  });
  await test('SESSION-player', 'Media ticket and existing player remain intact across explicit relogin', async () => {
    const { page, context } = await pageFor('Realizator', `/video-details/${f.videos[1]._id}`);
    try {
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
      await page.locator('video').evaluate((video) => { video.dataset.qaPreserved = 'true'; video.loop = true; return video.play(); });
      await expire(page, 'Realizator');
      await login(page);
      assert.equal(await page.locator('video').getAttribute('data-qa-preserved'), 'true');
      assert.ok(await page.locator('video').evaluate((video) => video.readyState >= 2 && !video.error && !video.paused));
    } finally { await context.close(); }
  });
  await test('SESSION-other-tab', 'Another tab cannot switch the owner of a mounted Reporter draft', async () => {
    const { page, context } = await pageFor('Reporter', '/reporter-dashboard');
    try {
      await page.getByRole('button', { name: /Novi prilog/ }).click();
      await page.getByRole('textbox', { name: /^Event/ }).first().fill('QA privatni nacrt');
      const other = await context.newPage(); await other.goto(qa.base + '/login');
      await other.getByRole('button', { name: 'Odjava', exact: true }).click();
      await other.waitForURL('**/login');
      await other.getByLabel(/^Korisničko ime/).fill(f.users.Editor.username);
      await other.getByLabel(/^Lozinka/).fill(qa.password);
      await other.getByRole('button', { name: 'Prijavi se', exact: true }).click();
      await other.waitForURL('**/editor-dashboard');
      const dialog = page.getByRole('dialog', { name: 'Prijava je promijenjena' }); await dialog.waitFor();
      assert.ok(await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).isDisabled());
      page.on('dialog', (prompt) => prompt.accept()); await dialog.getByRole('button', { name: 'Odjavi se' }).click();
      await page.waitForURL('**/editor-dashboard');
      assert.equal(await page.getByRole('textbox', { name: /^Event/ }).count(), 0);
      assert.equal(await other.evaluate(() => JSON.parse(localStorage.getItem('user')).id), qa.sessions.Editor.id);
    } finally { await context.close(); }
  });
  await test('SESSION-transfer-layer', 'Mobile relogin remains clickable above the global transfer-panel layer', async () => {
    const { page, context } = await pageFor('Editor', `/video-details/${f.videos[0]._id}`);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => {
        const panel = document.createElement('div');
        panel.textContent = 'QA transfer panel';
        Object.assign(panel.style, { position: 'fixed', zIndex: '1500', right: '12px', bottom: '12px', width: '366px', height: '420px', background: '#fff' });
        document.body.appendChild(panel);
      });
      await expire(page, 'Editor');
      const button = page.getByRole('dialog').getByRole('button', { name: 'Prijavi se', exact: true });
      assert.ok(await button.evaluate((el) => {
        const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), 'Transfer panel covers relogin action');
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        let element = dialog;
        while (element) {
          if (Number(getComputedStyle(element).opacity) < 0.999) return false;
          element = element.parentElement;
        }
        // The navigation drawer keeps a separate, hidden backdrop mounted.
        const backdrop = dialog.closest('.MuiModal-root')?.querySelector('.MuiBackdrop-root');
        return !backdrop || Number(getComputedStyle(backdrop).opacity) >= 0.999;
      });
      await page.screenshot({ path: path.join(qa.output, 'session-transfer-mobile.png') });
      await login(page);
      return { layoutFaultInjection: 'Fixed z1500 overlay matches global transfer-panel layer', mobile: true, captureAfterFade: true };
    } finally { await context.close(); }
  });
  await test('SESSION-identity', 'Changed account role is rejected without replacing the old draft/session', async () => {
    const { page, context } = await pageFor('Reporter2', '/reporter-dashboard');
    try {
      await expire(page, 'Reporter2');
      await qa.models.User.updateOne({ _id: f.users.Reporter2._id }, { $set: { role: 'Editor' } });
      const dialog = page.getByRole('dialog', { name: 'Sesija je istekla' });
      await dialog.getByLabel(/^Lozinka/).fill(qa.password);
      await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).click();
      await dialog.getByText(/Račun ili uloga su promijenjeni/).waitFor();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('user')).role), 'Reporter');
      assert.ok(await dialog.getByRole('button', { name: 'Prijavi se', exact: true }).isDisabled());
      page.on('dialog', (prompt) => prompt.accept());
      await dialog.getByRole('button', { name: 'Odjavi se' }).click();
      await page.waitForURL('**/login');
      assert.equal(await page.evaluate(() => localStorage.getItem('user')), null);
    } finally { await context.close(); }
  });
  await browser.close();
};
