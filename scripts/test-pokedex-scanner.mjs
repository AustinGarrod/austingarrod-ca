// LOCAL ONLY: real OCR worker + deterministic canvas video, no photo uploads or cloud service.
import { chromium, expect } from '@playwright/test';
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
      c.font = '12px Arial'; c.fillText('BASIC', 20, 35); if (subtitle) c.fillText(subtitle, 100, 102);
      c.fillStyle = '#186880'; c.fillRect(40, 140, 520, 410); c.fillStyle = '#fcb244'; c.beginPath(); c.arc(300, 330, 100, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#111'; c.font = '26px Arial'; c.fillText('Thunder Shock', 70, 640); c.font = '18px Arial'; c.fillText('Synthetic local camera fixture', 70, 735); draw();
    };
    window.__setBlank = () => { card = null; draw(); };
    window.__setArt = async url => { const image = new Image(); image.src = url; await image.decode(); card = image; draw(); };
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__cameraCalls.push(constraints);
      if (window.__denyCamera) throw new DOMException('Test camera denied', 'NotAllowedError');
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720; cameraCanvas = canvas;
      draw(); const stream = canvas.captureStream(15), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      window.__cameraCount++; const interval = setInterval(draw, 60); let stopped = false;
      track.stop = () => { if (!stopped) { stopped = true; window.__cameraCount--; clearInterval(interval); stop(); } };
      window.__endCamera = () => { track.stop(); track.dispatchEvent(new Event('ended')); };
      if (window.__cameraHeld) await new Promise(resolve => window.__cameraPending.push(resolve));
      return stream;
    };
  });
  return ctx;
}
async function open(ctx) {
  const page = await ctx.newPage(); page.on('pageerror', error => allErrors.push(error.message.slice(0, 300)));
  await page.goto(origin + '/utilities/pokedex-binder/');
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false'); return page;
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
async function choose(page, id) {
  if (!await page.locator('#scan-result-details').isVisible()) await page.locator(`#scan-candidates [data-scan-species="${id}"]`).click();
}
async function scenario(name, run) { await run(); completed.push(name); console.log(`Passed: ${name}`); }
try {
  const ctx = await context(), page = await open(ctx), requests = [];
  page.on('request', request => requests.push(request.url()));
  await scenario('lazy start, same-origin OCR worker and production CSP', async () => {
    assert.equal(requests.some(url => url.includes('scanner-assets')), false);
    const headers = await (await page.request.get(origin + '/utilities/pokedex-binder/')).headers();
    assert.match(headers['permissions-policy'], /camera=\(self\)/); assert.match(headers['content-security-policy'], /wasm-unsafe-eval/);
    const rootHeaders = await (await page.request.get(origin + '/')).headers(); assert.match(rootHeaders['permissions-policy'], /camera=\(\)/);
    await scanner(page);
    assert.ok(requests.some(url => url.includes('/scanner-assets/v1/worker.min.js')));
    const constraints = await page.evaluate(() => window.__cameraCalls[0]); assert.equal(constraints.audio, false); assert.equal(constraints.video.facingMode.ideal, 'environment');
  });
  await scenario('auto capture, explicit mark, local persistence and duplicate suppression', async () => {
    await card(page, 'Pikachu'); await choose(page, 25);
    await expect(page.locator('#scan-pokemon-name')).toHaveText('Pikachu'); await expect(page.locator('#owned-count')).toHaveText('0');
    await expect(page.locator('#scan-location')).toHaveAttribute('aria-label', /Page 2/);
    await page.locator('#scan-mark').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning');
    await expect(page.locator('#owned-count')).toHaveText('1'); await page.waitForTimeout(2200);
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning'); await expect(page.locator('#scan-status')).toContainText('last card');
    await page.locator('#scan-rescan').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result', { timeout: 15000 }); await choose(page, 25);
    await expect(page.locator('#scan-owned-status')).toHaveText('Already collected'); await expect(page.locator('#scan-mark')).toBeHidden();
    await page.locator('#scan-next').click();
  });
  await scenario('skip without marking, correct species and multi-Pokémon choice', async () => {
    await card(page, 'Bulbasaur'); await choose(page, 1); await page.locator('#scan-next').click(); await expect(page.locator('#owned-count')).toHaveText('1');
    await card(page, 'Mewtwo'); await choose(page, 150); await expect(page.locator('#scan-pokemon-name')).toHaveText('Mewtwo');
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
    await page.evaluate(() => window.__setCard('Mr. Mime')); await page.locator('#scan-capture').click();
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result', { timeout: 15000 });
    if (!await page.locator('#scan-result-details').isVisible()) {
      if (await page.locator('#scan-candidates [data-scan-species="122"]').count()) await choose(page, 122);
      else { await page.locator('#scan-correct').click(); await page.locator('#scan-search').fill('122'); await page.locator('#scan-search-results [data-scan-species="122"]').click(); }
    }
    assert.equal(await page.locator('#scan-dialog').evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: `${output}/result-${width}.png` }); await ctx.close();
  });
  await scenario('denied camera and manual search do not claim an unsaved collection', async () => {
    const ctx = await context(), page = await open(ctx); await page.evaluate(() => { window.__denyCamera = true; });
    await page.locator('#scan-open').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'error');
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
    assert.equal(await page.evaluate(() => window.__cameraCount), 0);
    await expect(page.locator('#scan-recovery-search')).toBeVisible(); await ctx.close();
  });
  await scenario('unavailable binder storage retains the result and shows backup guidance', async () => {
    const ctx = await context(); await ctx.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (name, ...args) => { if (name === 'austingarrod.utilities.pokedex-binder.v1') throw new DOMException('Synthetic storage failure', 'SecurityError'); return open(name, ...args); };
    });
    const page = await open(ctx); await scanner(page); await card(page, 'Pikachu'); await choose(page, 25);
    await page.locator('#scan-mark').click(); await expect(page.locator('#owned-count')).toHaveText('1');
    await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'result');
    await expect(page.locator('#scan-notice')).toBeVisible(); await expect(page.locator('#scan-notice')).toContainText('Download a backup');
    await page.locator('#scan-next').click(); await expect(page.locator('#scan-dialog')).toHaveAttribute('data-phase', 'scanning');
    await page.locator('#scan-close').click(); await ctx.close();
  });
  assert.deepEqual(allErrors, []);
} catch (error) { console.error(error.message); throw error; }
finally { await writeFile(`${output}/browser-results.json`, JSON.stringify({ completed, errors: allErrors }, null, 2)); await browser.close(); }
