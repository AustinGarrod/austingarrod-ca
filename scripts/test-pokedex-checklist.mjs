// Run against npm run preview only. No production or third-party requests.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { binderAction, chooseFilter, goHome, homeCard, homeCards, newSetBinder, openBinder, openSettings, returnToBinders } from './test-pokedex-helpers.mjs';

const origin = process.env.POKEDEX_CHECKLIST_ORIGIN || 'http://localhost:4321';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Checklist checks must stay local.');
await mkdir('output/pokedex-checklist', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });

async function checkPrintingArtwork(page) {
  const fixture = await readFile(new URL('../public/utilities/pokedex-binder/sprites/25.png', import.meta.url));
  await page.route('https://assets.tcgdex.net/**', route => route.request().url().endsWith('/high.webp')
    ? route.fulfill({ status: 503 }) : route.fulfill({ contentType: 'image/png', body: fixture }));
  await openBinder(page, 'National Pokédex');
  await page.locator('#view-binder').click();
  await page.locator('#dex-search').fill('#0025');
  await page.locator('#results-list [data-goto="25"]').click();
  const list = page.locator('#printing-list');
  await expect(list.locator('img').first()).toHaveAttribute('fetchpriority', 'high');
  const offscreen = list.locator('img').nth(24);
  await expect(offscreen).not.toHaveAttribute('src');
  const deferredSource = await offscreen.getAttribute('data-artwork-src');
  assert.ok(deferredSource);
  await offscreen.scrollIntoViewIfNeeded();
  await expect(offscreen).toHaveAttribute('src', deferredSource);

  const search = page.locator('#printing-search');
  await search.fill('MEW');
  const artwork = list.getByRole('link', { name: 'View Pikachu 025 card artwork' });
  await expect(artwork).toHaveAttribute('href', /\/sv03\.5\/025\/high\.webp$/);
  await artwork.click();
  const dialog = page.getByRole('dialog', { name: 'Pikachu · #025' });
  await expect(dialog.getByRole('link', { name: 'Open original' })).toHaveAttribute('href', /\/sv03\.5\/025\/high\.webp$/);
  await expect(dialog.getByRole('status')).toHaveText('Full-size artwork unavailable.');
  await expect.poll(() => dialog.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(artwork).toBeFocused();
}

async function checkControlSizing(page) {
  const viewport = page.viewportSize();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: viewport.height });
    // Controls hidden at this width (the Show filter sits behind Filter on phones) are skipped.
    const controls = await page.locator([
      '#binder-back', '#catalog-search-open', '#binder-menu > summary', '#master-workspace .dex-search',
      '#master-filter-toggle', '#master-status', '#master-view-binder', '#master-view-checklist',
      '#master-page-prev', '#master-page-select', '#master-page-next',
    ].join(', ')).evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => {
      const { width, height } = node.getBoundingClientRect();
      return { id: node.id || 'binder search', width, height };
    }));
    for (const control of controls) {
      assert.ok(Math.abs(control.height - 44) < 1, `${control.id} is ${control.height}px tall at ${width}px`);
      assert.ok(control.width >= 44, `${control.id} is at least 44px wide at ${width}px`);
    }
    const widthOf = id => controls.find(control => control.id === id).width;
    assert.ok(Math.abs(widthOf('master-view-binder') - widthOf('master-view-checklist')) < 1, 'Binder view toggles share the available width');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No control overflow at ${width}px`);
  }
  await page.setViewportSize(viewport);
}

async function checkBulkSelections(page, documents) {
  await openBinder(page, 'National Pokédex');
  await expect(page.locator('#master-select-set')).toHaveAttribute('hidden', '');
  await expect(page.locator('#master-select-page')).toBeHidden();

  const workspace = page.locator('#master-workspace');
  const progress = workspace.locator('#master-progress');
  const dialog = page.getByRole('dialog', { name: 'Mark cards collected' });
  const all = dialog.getByRole('checkbox', { name: 'Select all', exact: true });
  const choices = dialog.locator('#master-bulk-cards input');
  const count = dialog.locator('#master-bulk-count');
  const message = workspace.locator('#master-bulk-message');
  const pageAction = workspace.getByRole('button', { name: 'Select all on page' });
  const saved = name => documents.get('master-sets')?.state.binders.find(binder => binder.name === name);

  await openBinder(page, '151 checklist');
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  await workspace.locator('#master-search').fill('#001');
  await workspace.locator('#master-checklist-finish').selectOption({ label: 'Reverse holo' });
  await expect(workspace.locator('.dex-checklist-row')).toHaveCount(1);
  await expect(pageAction).toBeHidden();
  await binderAction(page, '#master-select-set');
  await expect(dialog).toContainText('151 checklist · Whole set · Required cards');
  await expect(choices).toHaveCount(358);
  await expect(dialog.locator('input[value="001:reverse"]')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Mark 358 collected' })).toBeInViewport();
  await dialog.screenshot({ path: `output/pokedex-checklist/bulk-${page.viewportSize().width}.png` });
  await all.uncheck();
  await expect(dialog.getByRole('button', { name: 'Mark 0 collected' })).toBeDisabled();
  await all.check();
  await dialog.locator('input[value="002:reverse"]').press('Space');
  await expect(count).toHaveText('357 of 358 selected');
  assert.equal(await all.evaluate(box => box.indeterminate), true);
  await dialog.getByRole('button', { name: 'Mark 357 collected' }).click();
  await expect(dialog).toBeHidden();
  await expect(progress).toHaveText('359 / 360');
  await expect(message).toHaveText('Marked 357 cards collected.');
  await expect.poll(() => saved('151 checklist')?.owned.length).toBe(359);
  assert.ok(!saved('151 checklist').owned.includes('002:reverse'));
  assert.equal(saved('Futsal numbers').owned.length, 3);

  await newSetBinder(page);
  await page.locator('#master-set').fill('sv03.5');
  await page.locator('#master-name').fill('151 by number');
  await page.locator('#master-goal').selectOption('numbers');
  await page.locator('#master-columns').fill('3');
  await page.locator('#master-rows').fill('2');
  await page.locator('#master-blanks').fill('1');
  await page.getByRole('button', { name: 'Save binder' }).click();
  await expect(progress).toHaveText('0 / 207');
  await binderAction(page, '#master-add-extra');
  await page.locator('#master-extra-name').fill('Signed extra');
  await page.locator('#master-extra-form').getByRole('button', { name: 'Add extra' }).click();
  await expect(page.locator('#master-extra-dialog')).toBeHidden();
  await workspace.getByRole('button', { name: 'Binder', exact: true }).click();
  await workspace.locator('#master-page-select').selectOption('35');
  const grid = workspace.locator('#master-binder-grid');
  await expect(grid.locator('.dex-pocket-blank')).toHaveCount(1);
  const expectedKeys = await grid.locator('input[data-key]').evaluateAll(inputs => inputs.map(input => input.dataset.key));
  await grid.locator('[data-set-open]').first().click();
  await workspace.locator('#set-detail-status-ordered').check();
  await expect(workspace.locator('#master-ordered')).toHaveText('1');
  await page.keyboard.press('Escape');
  await chooseFilter(page, '#master-status', 'owned');
  await pageAction.click();
  await expect(dialog).toContainText('151 by number · Page 35');
  await expect(dialog.getByRole('checkbox', { name: /Signed extra · Custom extra · Optional/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /Any finish · Ordered/ })).toBeChecked();
  assert.deepEqual(await choices.evaluateAll(inputs => inputs.map(input => input.value)), expectedKeys);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(pageAction).toBeFocused();
  await expect(progress).toHaveText('0 / 207');
  await expect(workspace.locator('#master-optional')).toHaveText('0 / 1');
  await expect(workspace.locator('#master-ordered')).toHaveText('1');

  await pageAction.click();
  await dialog.getByRole('button', { name: 'Mark 5 collected' }).click();
  await expect(dialog).toBeHidden();
  await expect(progress).toHaveText('4 / 207');
  await expect(workspace.locator('#master-optional')).toHaveText('1 / 1');
  await expect(workspace.locator('#master-ordered')).toHaveText('0');
  await expect(pageAction).toBeDisabled();
  await expect(workspace.locator('#master-page-heading')).toBeFocused();
  await expect.poll(() => saved('151 by number')?.owned).toEqual(expectedKeys.toSorted());
  assert.equal(saved('151 by number').ordered, undefined);
  await workspace.locator('#master-page-select').selectOption('34');
  await expect(grid.locator('input:checked')).toHaveCount(0);

  await binderAction(page, '#master-add-extra');
  await page.locator('#master-extra-name').fill('Another optional extra');
  await page.locator('#master-extra-form').getByRole('button', { name: 'Add extra' }).click();
  await expect(workspace.locator('#master-optional')).toHaveText('1 / 2');
  await binderAction(page, '#master-select-set');
  await expect(choices).toHaveCount(203);
  assert.ok(await choices.evaluateAll(inputs => inputs.every(input => input.value.endsWith(':*'))));
  await dialog.getByRole('button', { name: 'Mark 203 collected' }).click();
  await expect(progress).toHaveText('207 / 207');
  await expect(page.locator('#master-select-set')).toBeDisabled();
  await expect.poll(() => saved('151 by number')?.owned.length).toBe(208);
  await page.reload();
  await expect(progress).toHaveText('207 / 207');
  await expect(workspace.locator('#master-optional')).toHaveText('1 / 2');
}

async function checkSetChecklist(page, width) {
  await page.locator('#view-binder').click();
  await goHome(page);
  // One binder: no combined totals.
  await expect(homeCards(page)).toHaveCount(1);
  await expect(page.locator('#set-overview-totals')).toBeHidden();
  await newSetBinder(page);
  await page.locator('#master-set').fill('sv03.5');
  await page.locator('#master-name').fill('151 checklist');
  await page.getByRole('button', { name: 'Save binder' }).click();
  await expect(page.locator('#master-editor')).toBeHidden();
  const workspace = page.locator('#master-workspace');
  await workspace.getByRole('button', { name: 'Binder', exact: true }).click();
  await expect(page.locator('#master-page-heading')).toHaveText('Page 1');
  await checkControlSizing(page);
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  const rows = workspace.locator('.dex-checklist-row');
  const sort = workspace.getByLabel('Sort checklist');
  const search = workspace.locator('#master-search');
  const finish = workspace.locator('#master-checklist-finish');
  const hideCollected = workspace.getByRole('checkbox', { name: /show only missing/i });
  const clear = workspace.getByRole('button', { name: 'Clear filters', exact: true });
  const regular = rows.filter({ has: page.locator('[data-key="001:normal"]') });
  const reverse = rows.filter({ has: page.locator('[data-key="001:reverse"]') });

  await expect(rows).toHaveCount(100);
  await workspace.getByRole('button', { name: /show more/i }).click();
  await expect(rows).toHaveCount(200);
  await sort.selectOption('name');
  await expect(rows.first()).toContainText('Abra');
  await workspace.getByRole('button', { name: 'Jump to Z', exact: true }).click();
  await expect(workspace.locator('.dex-checklist-name:focus')).toHaveText(/^Z/);
  await sort.selectOption('collector-desc');
  await expect(rows.first()).toContainText('Basic Psychic Energy');

  await search.fill('#001');
  await expect(rows).toHaveCount(2);
  const location = reverse.locator('.dex-checklist-location');
  await expect(location).toHaveAttribute('aria-label', 'Page 1 · Row 1, column 2');
  await regular.getByRole('radio', { name: 'Have it' }).check();
  await chooseFilter(page, '#master-status', 'owned');
  await expect(rows).toHaveCount(1);
  await expect(regular.getByRole('radio', { name: 'Have it' })).toBeChecked();
  await chooseFilter(page, '#master-status', 'missing');
  await expect(rows).toHaveCount(1);
  await expect(location).toHaveAttribute('aria-label', 'Page 1 · Row 1, column 2');
  await chooseFilter(page, '#master-status', 'all');
  await search.fill('Bulbasaur');
  await expect(rows).toHaveCount(3);
  await finish.selectOption({ label: 'Reverse holo' });
  await expect(rows).toHaveCount(1);
  await hideCollected.check();
  await reverse.getByRole('radio', { name: 'Have it' }).click();
  await expect(rows).toHaveCount(0);
  await expect(workspace.locator('#master-list')).toContainText('No cards match');
  await clear.click();
  await expect(search).toHaveValue('');
  await expect(finish).toHaveValue('');
  await expect(hideCollected).not.toBeChecked();
  await expect(rows).toHaveCount(100);
  await search.fill('#001');
  await expect(rows).toHaveCount(2);
  await expect(regular.getByRole('radio', { name: 'Have it' })).toBeChecked();
  await expect(reverse.getByRole('radio', { name: 'Have it' })).toBeChecked();
  await expect(location).toHaveAttribute('aria-label', 'Page 1 · Row 1, column 2');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Set checklist fits the viewport');
  await page.screenshot({ path: `output/pokedex-checklist/set-${width}.png` });

  await openBinder(page, 'National Pokédex');
  await expect(page.locator('#view-checklist')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#checklist-view')).toBeVisible();
  await openBinder(page, '151 checklist');
  await expect(workspace.getByRole('button', { name: 'Checklist', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(hideCollected).toBeVisible();
}

async function checkSetOverview(page, width) {
  await openBinder(page, 'National Pokédex');
  await page.locator('#dex-search').fill('#0025');
  await page.locator('#owned-list-25').check();
  await expect(page.locator('#owned-count')).toHaveText('1');

  await newSetBinder(page);
  await page.locator('#master-set').fill('fut2020');
  await page.locator('#master-name').fill('Futsal numbers');
  await page.locator('#master-goal').selectOption('numbers');
  await page.getByRole('button', { name: 'Save binder' }).click();
  await expect(page.locator('#master-editor')).toBeHidden();
  const workspace = page.locator('#master-workspace');
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  for (const [name, required] of [['Prize card', true], ['Signed copy', false]]) {
    await binderAction(page, '#master-add-extra');
    await page.locator('#master-extra-name').fill(name);
    await page.locator('#master-extra-required').setChecked(required);
    await page.locator('#master-extra-form').getByRole('button', { name: 'Add extra' }).click();
    await expect(page.locator('#master-extra-dialog')).toBeHidden();
  }
  await workspace.getByRole('radiogroup', { name: /Signed copy/ }).getByRole('radio', { name: 'Have it' }).check();
  await workspace.locator('[data-key="1:*"]').check();
  await expect(page.locator('#master-progress')).toHaveText('1 / 6');
  await expect(page.locator('#master-optional')).toHaveText('1 / 1');
  const futsalCatalog = '**/catalog/master-sets/fut2020.json';
  if (width === 390) await page.route(futsalCatalog, route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');

  const overview = page.locator('#set-overview');
  const binder = name => homeCard(page, name);
  async function expectBinder(name, owned, required) {
    const row = binder(name);
    await expect(row.locator('[data-owned-count]')).toHaveText(String(owned));
    await expect(row.locator('[data-needed-count]')).toHaveText(String(required - owned));
    await expect(row.locator('[data-required-count]')).toHaveText(String(required));
    await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuetext', `${owned} of ${required} required cards owned`);
  }
  async function expectOverall(owned, percentage) {
    // The home totals include the National Pokédex (1,025 species) with the set binders.
    const required = 360 + 6 + 1025;
    await expect(page.locator('#set-overview-owned')).toHaveText(String(owned));
    await expect(page.locator('#set-overview-needed')).toHaveText((required - owned).toLocaleString('en-CA'));
    await expect(page.locator('#set-overview-percent')).toHaveText(percentage);
    const progress = page.locator('#set-overview-progress');
    await expect.poll(() => progress.evaluate(bar => bar.position)).toBeCloseTo(owned / required, 4);
  }

  await goHome(page);
  await expect(overview).toBeVisible();
  await expect(overview.locator('[data-overview-binder]')).toHaveCount(3);
  await expect(binder('National Pokédex').locator('[data-owned-count]')).toHaveText('1');
  await expectBinder('151 checklist', 2, 360);
  if (width === 390) {
    await expect(binder('Futsal numbers')).toContainText('Set checklist could not load');
    await expect(page.locator('#set-overview-progress')).toBeHidden();
    await page.unroute(futsalCatalog);
    await overview.getByRole('button', { name: 'Retry loading sets' }).click();
  }
  await expectBinder('Futsal numbers', 1, 6);
  await expectOverall(4, '0.3%');
  await binder('Futsal numbers').locator('[data-overview-binder]').click();
  await expect(overview).toBeHidden();
  await expect(page.locator('#master-title')).toContainText('Futsal numbers');
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  await workspace.getByRole('radiogroup', { name: /Prize card/ }).getByRole('radio', { name: 'Have it' }).check();
  await expect(page.locator('#master-progress')).toHaveText('2 / 6');
  await goHome(page);
  await expectBinder('151 checklist', 2, 360);
  await expectBinder('Futsal numbers', 2, 6);
  await expectOverall(5, '0.4%');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Set overview fits the viewport');
  await overview.screenshot({ path: `output/pokedex-checklist/overview-${width}.png` });
}

async function checkAnniversaryExpansion(page, documents) {
  const save = page.getByRole('button', { name: 'Save binder' });
  const progress = page.locator('#master-progress');
  const ordered = page.locator('#master-ordered');
  const mainKey = '001:*';
  const orderedKey = '002:*';
  await newSetBinder(page);
  await page.locator('#master-set').fill('30th');
  await page.locator('#master-name').fill('Anniversary test');
  const full = page.getByRole('checkbox', { name: 'Include the full checklist (199 distinct cards)' });
  await expect(full).toBeVisible();
  await expect(full).not.toBeChecked();
  await save.click();
  await expect(progress).toHaveText('0 / 161');
  const workspace = page.locator('#master-workspace');
  await workspace.getByRole('button', { name: 'Binder', exact: true }).click();
  await expect(workspace.locator(`[data-set-open="${mainKey}"] img`)).toHaveAttribute(
    'src', 'https://assets.tcgdex.net/en/me/30th/001/low.webp');
  await workspace.locator(`[data-key="${mainKey}"]`).check();
  await workspace.locator(`[data-set-open="${orderedKey}"]`).click();
  await page.locator('#master-pokemon-details').getByRole('radio', { name: 'Ordered' }).check();
  await expect(ordered).toHaveText('1');
  await binderAction(page, '#master-settings');
  await full.check();
  const layout = page.getByRole('group', { name: 'Full checklist layout' });
  await layout.getByRole('button', { name: 'Move 30th Classic Collection up' }).click();
  await layout.getByRole('checkbox', { name: 'Start 30th Celebration on a fresh page' }).check();
  await expect(layout.locator('li strong')).toHaveText(['30th Classic Collection', '30th Celebration', 'Mega Evolution Energy']);
  await save.click();
  await expect(progress).toHaveText('1 / 199');
  await expect(ordered).toHaveText('1');
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  await workspace.locator('#master-search').fill('30th Classic Collection');
  const classic = workspace.locator('[data-key="30th-c/001:holo+stamp=30th-anniversary"]');
  const classicRow = workspace.locator('[data-checklist-row="30th-c/001:holo+stamp=30th-anniversary"]');
  await expect(classicRow.locator('img')).toHaveAttribute(
    'src', 'https://tcgplayer-cdn.tcgplayer.com/product/714372_200w.jpg');
  await classicRow.getByRole('button', { name: /Go to .* binder page/ }).click();
  await expect(workspace.locator('#master-page-heading')).toHaveText('Page 1');
  await workspace.locator('#master-page-select').selectOption('2');
  await expect(workspace.getByText('Blank before next section')).toHaveCount(2);
  await workspace.locator('#master-page-select').selectOption('3');
  await expect(workspace.locator(`[data-set-open="${mainKey}"]`)).toHaveAttribute('aria-label', /row 1, column 1/);
  await workspace.getByRole('button', { name: 'Checklist', exact: true }).click();
  await expect(classic).not.toBeChecked();
  await classic.check();
  await expect(progress).toHaveText('2 / 199');
  await expect.poll(() => documents.get('master-sets')?.state.binders.find(b => b.name === 'Anniversary test')).toMatchObject({
    settings: {
      includeRelated: true,
      sectionLayout: [{ id: '30th-c' }, { id: '@extras' }, { id: '30th', newPage: true }, { id: 'mee' }],
    },
    owned: [mainKey, '30th-c/001:holo+stamp=30th-anniversary'],
    ordered: [orderedKey],
  });
  await binderAction(page, '#master-settings');
  await full.uncheck();
  await save.click();
  await expect(progress).toHaveText('1 / 161');
  await expect(ordered).toHaveText('1');
  await binderAction(page, '#master-settings');
  await full.check();
  await expect(layout.getByRole('checkbox', { name: 'Start 30th Celebration on a fresh page' })).toBeChecked();
  await save.click();
  await expect(progress).toHaveText('2 / 199');
  await expect(classic).toBeChecked();
}

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
    await page.goto(`${origin}/utilities/pokemon-binder/`);
    await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await page.locator('#first-dex').click();
    await expect(page.locator('#pokemon-details')).toBeHidden();
    await expect(page.locator('#binder-view')).not.toHaveClass(/has-details/);
    await expect(page.locator('#binder-bar')).not.toContainText('Fill the gaps');
    assert.equal(await page.locator('#dex-filter').evaluate(node => getComputedStyle(node).appearance), 'none');
    await openSettings(page);
    await page.locator('#binder-account-review').click();
    await page.locator('#binder-migration-layout').selectOption('device');
    await page.locator('#binder-migration-form button[type=submit]').click();
    await expect(page.locator('#dex-status')).toHaveText('Synced · Saved on this device');
    await returnToBinders(page);
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
    await expect(abra.getByRole('radio', { name: 'Have it' })).toBeChecked();
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
    await otherTab.goto(`${origin}/utilities/pokemon-binder/`);
    await expect(otherTab.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    // A new tab opens on the list of binders.
    await openBinder(otherTab, 'National Pokédex');
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
    await chooseFilter(page, '#dex-filter', 'owned');
    await expect(rows).toHaveCount(1);
    await expect(rows.first().locator('.dex-checklist-location')).toHaveAttribute('aria-label', 'Page 4 · Row 4, column 3');
    await chooseFilter(page, '#dex-filter', 'missing');
    await expect(page.locator('#checklist-count')).toContainText('150 Pokémon');
    await chooseFilter(page, '#dex-generation', '2');
    await expect(rows).toHaveCount(0);
    await expect(page.locator('#checklist-list')).toContainText('No Pokémon match');
    await chooseFilter(page, '#dex-generation', 'all');
    await chooseFilter(page, '#dex-filter', 'all');
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
    await page.locator('#list-missing-63').check();
    await page.locator('#checklist-set').fill('151 (MEW)');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'No horizontal overflow');
    await page.screenshot({ path: `output/pokedex-checklist/${width}.png` });
    await page.locator('#checklist-clear-set').click();
    await expect(page.locator('#checklist-set')).toHaveValue('');
    await expect(page.locator('#checklist-count')).toContainText('1025 Pokémon');
    await expect(abra.locator(cardNumbers)).toBeHidden();
    await page.locator('#dex-search').fill('Abra');
    await chooseFilter(page, '#dex-filter', 'missing');
    await chooseFilter(page, '#dex-generation', '1');
    await page.locator('#checklist-set').fill('151 (MEW)');
    await page.locator('#checklist-hide-collected').check();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.locator('#dex-search')).toHaveValue('');
    await expect(page.locator('#dex-filter')).toHaveValue('all');
    await expect(page.locator('#dex-generation')).toHaveValue('all');
    await expect(page.locator('#checklist-set')).toHaveValue('');
    await expect(page.locator('#checklist-hide-collected')).not.toBeChecked();
    await expect(page.locator('#checklist-count')).toContainText('1025 Pokémon');
    await checkSetChecklist(page, width);
    await checkSetOverview(page, width);
    await checkAnniversaryExpansion(page, documents);
    await checkBulkSelections(page, documents);
    await checkPrintingArtwork(page);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Passed National and set binder checklists, navigation, set overview totals, bulk selection, and artwork at ${width}px`);
  }
} finally { await browser.close(); }
