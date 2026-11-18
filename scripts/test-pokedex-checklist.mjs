// Run against npm run preview only. No production or third-party requests.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const origin = process.env.POKEDEX_CHECKLIST_ORIGIN || 'http://localhost:4321';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Checklist checks must stay local.');
await mkdir('output/pokedex-checklist', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const documents=new Map(), staged=new Map();
    let holdPatch=null;
    const user={id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',email:'checklist@example.test'};
    let numberRequests = 0;
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('/catalog/collector-numbers.json')) {
        numberRequests++;
        if (width === 390 && numberRequests === 1) return route.fulfill({ status: 503 });
      }
      if(url.pathname==='/api/v1/auth.php')return route.fulfill({json:{enabled:true,migrationEnabled:true,user,csrfToken:'fixture'}});
      if(url.pathname!=='/api/v1/sync.php')return route.continue();
      const action=url.searchParams.get('action'), body=route.request().postDataJSON();
      if(action==='read')return route.fulfill({json:{document:documents.get(url.searchParams.get('document'))??null}});
      if(action==='migration-stage'){if(body.variant==='selected')staged.set(body.document,body.state);return route.fulfill({json:{staged:true}});}
      if(action==='migration-commit'){
        for(const [document,state] of staged)documents.set(document,{app:'pokedex-binder',document,resourceId:user.id,schemaVersion:1,revision:1,acknowledgedSequence:0,state});
        return route.fulfill({json:{documents:[...documents.values()]}});
      }
      if(action==='write'){
        if(holdPatch)await holdPatch;
        const doc=documents.get(body.document);
        if(body.mutationSequence>doc.acknowledgedSequence){doc.revision++;doc.state=body.state;doc.acknowledgedSequence=body.mutationSequence;}
        return route.fulfill({json:{document:doc}});
      }
      return route.fulfill({status:400,json:{error:{code:'unknown_action'}}});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/utilities/pokedex-binder/`);
    await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#pokemon-details')).toBeHidden();
    await expect(page.locator('#binder-view')).not.toHaveClass(/has-details/);
    await expect(page.locator('.dex-intro')).not.toContainText('Fill the gaps');
    assert.equal(await page.locator('#dex-filter').evaluate(node => getComputedStyle(node).appearance), 'none');
    await page.locator('#sync-open').click();
    await page.locator('#binder-account-review').click();
    await page.locator('#binder-migration-layout').selectOption('device');
    await page.locator('#binder-migration-form button[type=submit]').click();
    await expect(page.locator('#dex-status')).toHaveText('Synced · Saved on this device');
    await page.keyboard.press('Escape');
    await page.locator('#view-checklist').click();
    const rows = page.locator('.dex-checklist-row');
    await expect(rows).toHaveCount(100);
    await page.locator('#checklist-more').click();
    await expect(rows).toHaveCount(200);
    await page.locator('#checklist-sort').selectOption('name');
    await expect(rows).toHaveCount(100);
    await expect(rows.first()).toContainText('Abomasnow');
    await page.getByRole('button', { name: 'Jump to Z', exact: true }).click();
    await expect(page.locator('.dex-checklist-name:focus')).toHaveText(/^Z/);
    await expect(rows).toHaveCount(1025);
    await page.locator('#checklist-sort').selectOption('name-desc');
    await expect(rows.first()).toContainText('Zygarde');
    await page.getByRole('button', { name: 'Jump to A', exact: true }).click();
    await expect(page.locator('.dex-checklist-name:focus')).toHaveText(/^A/);
    await page.locator('#checklist-sort').selectOption('dex-desc');
    await expect(rows.first()).toContainText('Pecharunt');
    await page.locator('#checklist-sort').selectOption('name');
    assert.equal(numberRequests, 0, 'Unfiltered checklist does not fetch numbers');
    await page.locator('#checklist-set').fill('151 (MEW)');
    await expect(page.locator('#checklist-count')).toContainText('151 Pokémon');
    await expect(rows.first()).toContainText('Abra');
    const abra = page.locator('#checklist-row-63');
    const cardNumbers = '.dex-checklist-card-numbers';
    if (width === 390) {
      await expect(page.locator('#checklist-number-status')).toHaveText('Card numbers couldn’t load.');
      await page.locator('#checklist-number-retry').click();
    }
    await expect(abra.locator(cardNumbers)).toHaveText('Card #063');
    await expect(page.locator('#checklist-row-6').locator(cardNumbers)).toHaveText('Cards #006, #183, #199');
    await page.locator('#checklist-set').fill('Base Set');
    await expect(abra.locator(cardNumbers)).toHaveText('Card #43');
    await page.locator('#checklist-sort').selectOption('collector');
    await expect(rows.first()).toContainText('Alakazam');
    await expect(rows.nth(1).locator(cardNumbers)).toHaveText('Card #2');
    await page.locator('#checklist-sort').selectOption('collector-desc');
    await expect(rows.first()).toContainText('Weedle');
    await expect(rows.first().locator(cardNumbers)).toHaveText('Card #69');
    await page.locator('#checklist-set').fill('base');
    await expect(page.locator('#checklist-number-status')).toHaveText('Choose one set to sort by its card numbers.');
    await expect(abra.locator(cardNumbers)).toBeHidden();
    await page.locator('#checklist-set').fill('151 (MEW)');
    await expect(rows.first()).toContainText('Mew');
    await expect(rows.first().locator(cardNumbers)).toHaveText('Cards #151, #193, #205');
    await page.locator('#checklist-sort').selectOption('name');
    await expect(abra.locator(cardNumbers)).toHaveText('Card #063');
    assert.equal(numberRequests, width === 390 ? 2 : 1, 'Set switches reuse the loaded lookup');
    await abra.locator('.dex-checklist-name').click();
    await expect(abra).toHaveClass(/selected/);
    let releasePatch;
    holdPatch = new Promise(resolve => { releasePatch = resolve; });
    await page.locator('#owned-list-63').check();
    await expect(abra).toHaveClass(/owned/);
    await expect(abra.locator('.dex-collected-label')).toBeVisible();
    await expect(page.locator('#dex-status')).not.toHaveText('Synced · Saved on this device');
    await abra.locator('.dex-checklist-name').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    releasePatch(); holdPatch = null;
    await expect(page.locator('#dex-status')).toHaveText('Synced · Saved on this device');
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'Abra', 'Sync acknowledgment preserves selected text');
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await expect(abra).toHaveClass(/selected/);
    const otherTab = await context.newPage();
    await otherTab.goto(`${origin}/utilities/pokedex-binder/`);
    await expect(otherTab.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await abra.locator('.dex-checklist-name').evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    });
    await otherTab.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('2');
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'Abra', 'Another tab updating ownership preserves selected row text');
    await otherTab.locator('#owned-grid-1').uncheck();
    await expect(page.locator('#owned-count')).toHaveText('1');
    await otherTab.close();
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await page.locator('#checklist-hide-collected').check();
    await expect(abra).toHaveCount(0);
    await page.locator('#checklist-hide-collected').uncheck();
    await expect(abra).toHaveCount(1);
    await page.locator('#dex-filter').selectOption('owned');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.dex-checklist-location')).toHaveAttribute('aria-label', 'Page 4 · Row 4, column 3');
    await page.locator('#dex-filter').selectOption('missing');
    await expect(page.locator('#checklist-count')).toContainText('150 Pokémon');
    await page.locator('#dex-generation').selectOption('2');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#checklist-list')).toContainText('No Pokémon match');
    await page.locator('#dex-generation').selectOption('all');
    await page.locator('#dex-filter').selectOption('all');
    await page.locator('#dex-search').fill('mr mime');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Mr. Mime');
    await page.locator('#dex-search').fill('');
    await page.locator('#checklist-set').fill('not a real set');
    await expect(rows).toHaveCount(0);
    await page.locator('#checklist-set').fill('mew');
    await expect(page.locator('#checklist-count')).toContainText('151 Pokémon');
    await rows.first().locator('[data-goto]').click();
    await expect(page.locator('#page-heading')).toHaveText('Page 4');
    await expect(page.locator('#open-grid-63')).toHaveAttribute('aria-label', /row 4, column 3/);
    await page.locator('#view-checklist').click();
    await expect(page.locator('#checklist-set')).toHaveValue('mew');
    await page.locator('#owned-list-63').uncheck();
    await page.locator('#checklist-set').fill('151 (MEW)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal overflow');
    await page.screenshot({ path: `output/pokedex-checklist/${width}.png` });
    await page.locator('#checklist-clear-set').click();
    await expect(page.locator('#checklist-set')).toHaveValue('');
    await expect(page.locator('#checklist-count')).toContainText('1025 Pokémon');
    await expect(abra.locator(cardNumbers)).toBeHidden();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed checklist sorting, set/name/ownership/generation filters and stable locations at ${width}px`);
  }
} finally { await browser.close(); }
