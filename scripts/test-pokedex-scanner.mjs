// LOCAL ONLY: real OCR worker + deterministic canvas video, no photo uploads or cloud service.
import { chromium, expect } from '@playwright/test';
import { binderAction, newSetBinder } from './test-pokedex-helpers.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.POKEDEX_SCANNER_ORIGIN || 'http://127.0.0.1:4331';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Scanner tests must stay local.');
const output = 'output/pokedex-scanner'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
const completed = [], allErrors = [];
async function context(width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await ctx.addInitScript(() => {
    window.__cameraCount = 0; window.__cameraCalls = []; window.__denyCamera = false; window.__cameraHeld = false; window.__cameraPending = [];
    let card = null, guideBox = null, cameraCanvas = null;
    const draw = () => {
      if (!cameraCanvas) return;
      const c = cameraCanvas.getContext('2d'); c.fillStyle = '#888'; c.fillRect(0, 0, cameraCanvas.width, cameraCanvas.height);
      if (card && guideBox) c.drawImage(card, guideBox.x, guideBox.y, guideBox.width, guideBox.height);
    };
    window.__setGuide = box => { guideBox = box; draw(); };
    window.__setCard = (name, subtitle = '') => {
      card = document.createElement('canvas'); card.width = 600; card.height = 840;
      const c = card.getContext('2d'); c.fillStyle = '#ecce65'; c.fillRect(0, 0, 600, 840);
      c.fillStyle = 'white'; c.fillRect(10, 10, 580, 100);
      c.strokeStyle = '#222'; c.lineWidth = 6; c.strokeRect(3, 3, 594, 834);
      c.fillStyle = '#111'; c.font = `bold ${name.length > 18 ? 25 : 36}px Arial`; c.fillText(name, 110, 70);
      c.font = '12px Arial'; c.fillText('BASIC', 20, 35);
      c.fillStyle = '#186880'; c.fillRect(40, 140, 520, 410); c.fillStyle = '#fcb244'; c.beginPath(); c.arc(300, 330, 100, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#111'; c.font = '26px Arial'; c.fillText('Thunder Shock', 70, 640); c.font = '18px Arial'; c.fillText('Synthetic local camera fixture', 70, 735);
      if (subtitle) { c.font = 'bold 25px Arial'; c.fillText(subtitle, 35, 805); }
      draw();
      window.__cardPhoto = () => card.toDataURL('image/png').split(',')[1];
    };
    window.__setBlank = () => { card = null; draw(); };
    window.__setArt = async url => { const image = new Image(); image.src = url; await image.decode(); card = image; draw(); };
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__cameraCalls.push(constraints);
      if (window.__denyCamera) throw new DOMException('Test camera denied', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720; cameraCanvas = canvas;
      draw(); const stream = canvas.captureStream(15), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.getCapabilities = () => ({ torch: window.__torchCapability });
      track.getSettings = () => ({ torch: !!window.__torchOn });
      track.applyConstraints = async constraints => {
        if (window.__rejectTorch) throw new DOMException('Test flash failure', 'OverconstrainedError');
        window.__torchOn = constraints.advanced[0].torch;
      };
      window.__cameraCount++; const interval = setInterval(draw, 60); let stopped = false;
      track.stop = () => { if (!stopped) { stopped = true; window.__torchOn = false; window.__cameraCount--; clearInterval(interval); stop(); } };
      window.__endCamera = () => { track.stop(); track.dispatchEvent(new Event('ended')); };
      if (window.__cameraHeld) await new Promise(resolve => window.__cameraPending.push(resolve));
      return stream;
    };
  });
  return ctx;
}
async function open(ctx, addDex = true) {
  const page = await ctx.newPage(); page.on('pageerror', error => allErrors.push(error.message.slice(0, 300)));
  await page.goto(origin + '/utilities/pokemon-binder/');
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
  if (addDex) await page.locator('#first-dex').click();
  return page;
}
async function scanner(page) {
  await page.locator('#scan-open').click();
  await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning', { timeout: 45000 });
  await guide(page);
}
async function guide(page) {
  await page.evaluate(() => {
    const video = document.querySelector('#scan-video'), guide = document.querySelector('#scan-guide');
    const v = video.getBoundingClientRect(), g = guide.getBoundingClientRect();
    const scale = Math.max(v.width / video.videoWidth, v.height / video.videoHeight);
    window.__setGuide({ x: (g.x - v.x + (video.videoWidth * scale - v.width) / 2) / scale,
      y: (g.y - v.y + (video.videoHeight * scale - v.height) / 2) / scale, width: g.width / scale, height: g.height / scale });
  });
}
async function card(page, name) {
  await page.evaluate(() => window.__setBlank()); await page.waitForTimeout(600);
  await page.evaluate(name => window.__setCard(name), name);
  await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result', { timeout: 15000 });
}
async function scenario(name, run) { await run(); completed.push(name); console.log(`Passed: ${name}`); }
try {
  await scenario('retired scanner module offers reload and preserves the open binder on cancel', async () => {
    const ctx = await context(), page = await open(ctx);
    await page.evaluate(async () => {
      const { createCardScanner } = await import('/utilities/pokedex-binder/scanner-update.js');
      const oldScanner = createCardScanner();
      oldScanner.refresh(); oldScanner.open(); oldScanner.close(); oldScanner.open();
    });
    const recovery = page.getByRole('dialog', { name: 'Scanner updated' });
    await expect(recovery.getByRole('button', { name: 'Reload binder' })).toBeVisible();
    await recovery.getByRole('button', { name: 'Close' }).click();
    await expect(recovery).toBeHidden(); await expect(page.locator('#scan-open')).toBeVisible();
    assert.equal(await page.evaluate(() => window.__cameraCalls.length), 0); await ctx.close();
  });
  for (const cancel of [false, true]) await scenario(cancel ? 'closing an early scan cancels the camera request' : 'first tap opens before the catalog is ready and starts once', async () => {
    const ctx = await context(), seeded = await open(ctx);
    await expect(seeded.locator('#national-workspace')).toBeVisible();
    await seeded.close();
    const page = await ctx.newPage();
    let releaseCatalog;
    const pending = new Promise(resolve => { releaseCatalog = resolve; });
    await ctx.route('**/catalog/index.json', async route => { await pending; await route.continue(); });
    try {
      await page.goto(origin + '/utilities/pokemon-binder/', { waitUntil: 'domcontentloaded' });
      await page.locator('#scan-open').click();
      await expect(page.locator('#scan-dialog')).toBeVisible();
      await expect(page.locator('#scan-status')).toHaveText('Loading your binder…');
      await expect(page.locator('#scan-capture')).toBeHidden();
      assert.equal(await page.evaluate(() => window.__cameraCalls.length), 0);
      if (cancel) await page.locator('#scan-close').click();
      releaseCatalog();
      await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
      if (cancel) {
        await expect(page.locator('#scan-dialog')).toBeHidden();
        assert.equal(await page.evaluate(() => window.__cameraCalls.length), 0);
      } else {
        await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning', { timeout: 30000 });
        assert.equal(await page.evaluate(() => window.__cameraCalls.length), 1);
      }
    } finally { releaseCatalog(); await ctx.close(); }
  });
  await scenario('failed catalog initialization still opens a recoverable dialog', async () => {
    const ctx = await context();
    await ctx.route('**/catalog/index.json', route => route.abort());
    const page = await open(ctx, false);
    await page.locator('#scan-open').click();
    await expect(page.locator('#scan-status')).toContainText('binder could not load');
    await expect(page.locator('#scan-reload')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#scan-dialog')).toBeHidden(); await ctx.close();
  });
  const ctx = await context(), page = await open(ctx), requests = [];
  page.on('request', request => requests.push(request.url()));
  // Reproduce a release deleting lazy scanner chunks after the page was loaded.
  await ctx.route('**/_astro/scanner.*.js', route => route.abort());
  await scenario('lazy start, same-origin OCR worker and production CSP', async () => {
    assert.equal(requests.some(url => url.includes('scanner-assets')), false);
    const headers = await (await page.request.get(origin + '/utilities/pokemon-binder/')).headers();
    assert.match(headers['permissions-policy'], /camera=\(self\)/); assert.match(headers['content-security-policy'], /wasm-unsafe-eval/);
    const rootHeaders = await (await page.request.get(origin + '/')).headers(); assert.match(rootHeaders['permissions-policy'], /camera=\(\)/);
    await scanner(page);
    assert.equal(requests.some(url => /\/_astro\/scanner\.[^/]+\.js$/.test(url)), false);
    await expect(page.locator('#scan-flash')).toBeHidden();
    assert.ok(requests.some(url => url.includes('/scanner-assets/v1/worker.min.js')));
    const constraints = await page.evaluate(() => window.__cameraCalls[0]); assert.equal(constraints.audio, false); assert.equal(constraints.video.facingMode.ideal, 'environment');
  });
  await scenario('auto capture, explicit mark, local persistence and duplicate suppression', async () => {
    await card(page, 'Pikachu'); await expect(page.locator('#scan-result-details')).toBeVisible();
    await expect(page.locator('#scan-pokemon-name')).toHaveText('Pikachu'); await expect(page.locator('#owned-count')).toHaveText('0');
    await expect(page.locator('#scan-location')).toHaveAttribute('aria-label', /Page 2/);
    await page.locator('#scan-mark').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning');
    await expect(page.locator('#owned-count')).toHaveText('1'); await page.waitForTimeout(2200);
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning'); await expect(page.locator('#scan-status')).toContainText('last card');
    await page.locator('#scan-rescan').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result', { timeout: 15000 });
    await expect(page.locator('#scan-owned-status')).toHaveText('Already collected'); await expect(page.locator('#scan-mark')).toBeHidden();
    await page.locator('#scan-next').click();
  });
  await scenario('skip without marking, correct species and multi-Pokémon choice', async () => {
    await card(page, 'Bulbasavr'); await expect(page.locator('#scan-pokemon-name')).toHaveText('Bulbasaur');
    await expect(page.locator('#scan-likely')).toBeVisible(); await expect(page.locator('#scan-placement')).toBeVisible();
    await page.locator('#scan-next').click(); await expect(page.locator('#owned-count')).toHaveText('1');
    await card(page, 'Mewtwo'); await expect(page.locator('#scan-pokemon-name')).toHaveText('Mewtwo');
    await page.locator('#scan-correct').click(); await page.locator('#scan-search').fill('mr mime');
    await page.locator('#scan-search-results [data-scan-species="122"]').click(); await expect(page.locator('#scan-pokemon-name')).toHaveText('Mr. Mime');
    await page.locator('#scan-mark').click(); await expect(page.locator('#owned-count')).toHaveText('2');
    await card(page, 'Pikachu & Zekrom GX');
    await expect(page.locator('#scan-mark')).toBeHidden();
    await expect(page.locator('#scan-candidates [data-scan-species="25"]')).toContainText('Already collected');
    await expect(page.locator('#scan-candidates [data-scan-species="644"]')).toContainText('Missing');
    await page.locator('#scan-candidates [data-scan-species="644"]').click(); await page.locator('#scan-mark').click(); await expect(page.locator('#owned-count')).toHaveText('3');
  });
  await scenario('pause, resume, track cleanup and unchanged binder view', async () => {
    await page.evaluate(() => window.__endCamera()); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'paused');
    assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await page.locator('#scan-resume').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning', { timeout: 30000 }); await guide(page);
    await page.keyboard.press('Escape'); await expect(page.locator('#scan-dialog')).not.toBeVisible(); assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await page.reload(); await expect(page.locator('#owned-count')).toHaveText('3'); await expect(page.locator('#page-heading')).toHaveText('Page 1');
  });
  await ctx.close();
  for (const width of [1440, 320]) await scenario(`${width}px camera/result layouts and manual capture`, async () => {
    const ctx = await context(width), page = await open(ctx); await scanner(page);
    await page.screenshot({ path: `${output}/camera-${width}.png` });
    await page.evaluate(async () => {
      window.__setCard('Mr. Mime');
      const video = document.querySelector('#scan-video');
      await new Promise(resolve => video.requestVideoFrameCallback(() => video.requestVideoFrameCallback(resolve)));
    });
    await page.locator('#scan-capture').click();
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result', { timeout: 15000 });
    await expect(page.locator('#scan-result-details')).toBeVisible();
    await expect(page.locator('#scan-pokemon-name')).toHaveText('Mr. Mime');
    assert.equal(await page.locator('#scan-dialog').evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: `${output}/result-${width}.png` }); await ctx.close();
  });
  await scenario('denied camera and manual search do not claim an unsaved collection', async () => {
    const ctx = await context(), page = await open(ctx); await page.evaluate(() => { window.__denyCamera = true; });
    await page.locator('#scan-open').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'error');
    await expect(page.getByText('Camera permission was denied.', { exact: false })).toHaveCount(1);
    await expect(page.locator('#scan-reload')).toBeHidden();
    await page.locator('#scan-recovery-search').click(); await page.locator('#scan-search').fill('25'); await page.locator('#scan-search-results [data-scan-species="25"]').click();
    await page.locator('#scan-mark').click(); await expect(page.locator('#owned-count')).toHaveText('1'); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'paused');
    await ctx.close();
  });
  await scenario('closing during camera initialization stops a late stream', async () => {
    const ctx = await context(), page = await open(ctx); await page.evaluate(() => { window.__cameraHeld = true; });
    await page.locator('#scan-open').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'starting');
    await page.waitForFunction(() => window.__cameraPending.length > 0); await page.locator('#scan-close').click();
    await page.evaluate(() => window.__cameraPending.splice(0).forEach(resolve => resolve()));
    await expect.poll(() => page.evaluate(() => window.__cameraCount)).toBe(0); await expect(page.locator('#scan-dialog')).not.toBeVisible(); await ctx.close();
  });
  await scenario('manual lookup takes over during startup and in-flight OCR', async () => {
    const ctx = await context(), page = await open(ctx);
    await page.evaluate(() => { window.__cameraHeld = true; });
    await page.locator('#scan-open').click(); await page.waitForFunction(() => window.__cameraPending.length);
    await page.locator('#scan-manual').click(); await expect(page.locator('#scan-search')).toBeFocused();
    await page.evaluate(() => { window.__cameraHeld = false; window.__cameraPending.splice(0).forEach(resolve => resolve()); });
    await expect.poll(() => page.evaluate(() => window.__cameraCount)).toBe(0);
    await page.locator('#scan-next').click();
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning'); await guide(page);
    await page.evaluate(() => {
      window.__setCard('Pikachu'); document.querySelector('#scan-capture').click();
      if (document.querySelector('#scan-dialog').dataset.phase !== 'recognizing') throw Error('Expected OCR in flight');
      document.querySelector('#scan-manual').click();
    });
    await page.locator('#scan-search').fill('mewtwo'); await page.locator('#scan-search-results button').click();
    await expect(page.locator('#scan-pokemon-name')).toHaveText('Mewtwo');
    await page.locator('#scan-mark').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning');
    await expect(page.locator('#owned-count')).toHaveText('1'); await ctx.close();
  });
  await scenario('flash toggles, survives scan next and recovers from a rejected constraint', async () => {
    const ctx = await context(), page = await open(ctx);
    await page.evaluate(() => { window.__torchCapability = [false, true]; });
    await scanner(page); const flash = page.locator('#scan-flash');
    await flash.click(); await expect(flash).toHaveAttribute('aria-pressed', 'true');
    await card(page, 'Pikachu'); await page.locator('#scan-next').click(); await expect(flash).toHaveText('Flash on');
    await page.evaluate(() => { window.__rejectTorch = true; }); await flash.click();
    await expect(page.locator('#scan-flash-notice')).toBeVisible(); await expect(flash).toHaveText('Flash on');
    await page.evaluate(() => { window.__rejectTorch = false; }); await flash.click(); await expect(flash).toHaveText('Flash off');
    await flash.click(); await page.locator('#scan-close').click(); assert.equal(await page.evaluate(() => window.__torchOn), false);
    await ctx.close();
  });
  await scenario('orientation changes keep the guide inside the camera, and backgrounding releases it', async () => {
    const ctx = await context(), page = await open(ctx); await scanner(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => {
      const v = document.querySelector('#scan-video').getBoundingClientRect(), g = document.querySelector('#scan-guide').getBoundingClientRect();
      return g.left >= v.left && g.right <= v.right && g.top >= v.top && g.bottom <= v.bottom;
    })).toBe(true); await guide(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'paused'); assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await page.locator('#scan-close').click(); await ctx.close();
  });
  await scenario('failed worker download is recoverable and releases the camera', async () => {
    const ctx = await context(); await ctx.route('**/scanner-assets/v1/worker.min.js', route => route.abort());
    const page = await open(ctx); await page.locator('#scan-open').click();
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'error', { timeout: 15000 });
    await expect(page.locator('#scan-reload')).toBeVisible();
    assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await expect(page.locator('#scan-recovery-search')).toBeVisible(); await ctx.close();
  });
  await scenario('unavailable binder storage retains the result and shows backup guidance', async () => {
    const ctx = await context(); await ctx.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, ...args) => { if (name === 'austingarrod.utilities.pokedex-binder.v1') throw new DOMException('Synthetic storage failure', 'SecurityError'); return open(name, ...args); };
    });
    const page = await open(ctx); await scanner(page); await card(page, 'Pikachu');
    await page.locator('#scan-mark').click(); await expect(page.locator('#owned-count')).toHaveText('1');
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result');
    await expect(page.locator('#scan-notice')).toBeVisible(); await expect(page.locator('#scan-notice')).toContainText('Download a backup');
    await page.locator('#scan-next').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning');
    await page.locator('#scan-close').click(); await ctx.close();
  });
  await scenario('set cards open directly and mark exactly one finish, including after a failed save', async () => {
    const ctx = await context(), page = await open(ctx);
    const dialog = page.locator('#scan-dialog');
    await newSetBinder(page);
    await page.locator('#master-set').fill('sv03.5'); await page.locator('#master-name').fill('151 Camera');
    await page.locator('#master-form button.dex-primary').click(); await binderAction(page, '#master-scan');
    await expect(dialog).toHaveAttribute('data-phase', 'scanning');
    await guide(page);
    await page.evaluate(() => window.__setCard('Bulbasaur', '001/165'));
    await expect(page.locator('#set-scan-result')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#set-scan-name')).toHaveText('#001 · Bulbasaur');
    const reverse = page.locator('[data-finish="001:reverse"]');
    await expect(reverse).toContainText(/Page \d+ · Row \d+ · Column \d+/);
    await page.screenshot({ path: `${output}/set-finishes-mobile.png` });
    await page.evaluate(() => {
      const transact = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
        if (mode === 'readwrite') { IDBDatabase.prototype.transaction = transact; throw new DOMException('Test save failed', 'QuotaExceededError'); }
        return transact.call(this, stores, mode, ...rest);
      };
    });
    await reverse.click(); await expect(page.locator('#scan-notice')).toContainText('Could not save');
    await expect(reverse).toBeEnabled(); await reverse.click();
    await expect(dialog).toHaveAttribute('data-phase', 'scanning');
    await expect(page.locator('[data-key="001:reverse"]')).toBeChecked();
    await expect(page.locator('[data-key="001:normal"]')).not.toBeChecked();
    assert.equal(await page.evaluate(() => window.__cameraCount), 1);
    await page.locator('#scan-rescan').click(); await expect(reverse).toBeVisible({ timeout: 15000 }); await expect(reverse).toBeDisabled();
    await expect(reverse).toContainText('Already collected');
    await page.locator('#set-scan-next').click();
    const photo = await page.evaluate(() => {
      window.__setCard('Switch', '206/165');
      return window.__cardPhoto();
    });
    await page.locator('#master-photo').setInputFiles({name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')});
    await expect(page.locator('#set-scan-result')).toBeVisible({ timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await expect(page.locator('#set-scan-name')).toHaveText('#206 · Switch');
    const single = page.locator('#set-scan-finishes button');
    await expect(single).toHaveCount(1); await expect(single).toContainText('Mark collected');
    const key = await single.getAttribute('data-finish'); await single.click();
    await expect(dialog).toHaveAttribute('data-phase', 'paused');
    await page.locator('#master-photo').setInputFiles({name: 'card.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64')});
    await expect(single).toBeVisible({ timeout: 15000 }); await expect(single).toHaveAttribute('data-finish', key);
    await expect(single).toBeDisabled(); await expect(single).toContainText('Already collected');
    await page.locator('#scan-close').click();
    await ctx.close();
  });
  assert.deepEqual(allErrors, []);
} catch (error) { console.error(error.message); throw error; }
finally { await writeFile(`${output}/browser-results.json`, JSON.stringify({ completed, errors: allErrors }, null, 2)); await browser.close(); }
