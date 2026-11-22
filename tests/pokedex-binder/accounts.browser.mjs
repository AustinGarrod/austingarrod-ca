// Run against a local Astro dev/preview server. Every account response is a local fixture.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const origin = process.env.BINDER_BROWSER_ORIGIN || 'http://127.0.0.1:4325';
assert.ok(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin), 'Use a localhost fixture server.');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const errors = [];
    let user = { id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', email: 'binder@example.test' }, revision = 1;
    let cloud = { schemaVersion: 1, settings: { rows: 3, columns: 4, useBackSides: true, leadingBlankPockets: 0 }, ownedDexIds: [25] };
    let masterRemote=null;
    const stages = new Map(), acks = new Map(), snapshots = [];
    const remote = clientId => ({ resourceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', app: 'pokedex-binder', document: 'binder', schemaVersion: 1, revision, state: cloud, acknowledgedSequence: acks.get(clientId) ?? 0 });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.fulfill({ status: 200, body: '{}', contentType: 'application/json' });
      const action = url.searchParams.get('action'), body = request.method() === 'POST' ? request.postDataJSON() : null;
      if (url.pathname === '/api/v1/auth.php') return route.fulfill({ json: { enabled: true, migrationEnabled: true, user, csrfToken: 'fixture' } });
      if (url.pathname === '/api/v1/sync.php') {
        if (!user || request.headers()['x-account-id'] !== user.id) return route.fulfill({ status: 401, json: { error: { code: 'unauthorized', message: 'Sign in again.' } } });
        if (action === 'read') return route.fulfill({ json: { document: url.searchParams.get('document')==='master-sets'?masterRemote:remote(url.searchParams.get('clientId')) } });
        if (action === 'migration-stage') { stages.set(body.document+':'+body.variant, body); return route.fulfill({ json: { staged: true } }); }
        if (action === 'migration-commit') {
          masterRemote={...remote(body.clientId),document:'master-sets',state:stages.get('master-sets:selected').state};
          snapshots.push(cloud, stages.get('binder:device').state); cloud = stages.get('binder:selected').state; revision++;
          return route.fulfill({ json: { documents: [remote(body.clientId)] } });
        }
        if (action === 'write') {
          if (body.mutationSequence > (acks.get(body.clientId) ?? 0)) { cloud = body.state; revision++; acks.set(body.clientId, body.mutationSequence); }
          return route.fulfill({ json: { document: remote(body.clientId) } });
        }
        return route.fulfill({ status: 400, json: { error: { code: 'fixture_action', message: 'Unexpected action.' } } });
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/utilities/pokedex-binder/`);
    await page.locator('#first-device').click();
    await page.locator('#first-dex').click();
    await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await page.locator('#owned-grid-1').check();
    await expect(page.locator('#owned-count')).toHaveText('1');
    assert.deepEqual(cloud.ownedDexIds, [25], 'Sign-in must not overwrite the account or guest collection.');
    await page.locator('#sync-open').click();
    await expect(page.locator('#binder-account-status')).toContainText('binder@example.test');
    await page.locator('#binder-account-review').click();
    await expect(page.locator('#binder-migration-dialog')).toBeVisible();
    await expect(page.locator('#binder-migration-summary')).toContainText('This device: 1 collected');
    await expect(page.locator('#binder-migration-layout')).toHaveValue('');
    await page.locator('#binder-migration-layout').selectOption('account');
    await mkdir('output', { recursive: true });
    await page.screenshot({ path: `output/pokedex-accounts-review-${viewport.width}.png`, fullPage: false });
    await page.locator('#binder-migration-form button[type=submit]').click();
    await expect(page.locator('#binder-migration-dialog')).not.toBeVisible();
    await expect(page.locator('#owned-count')).toHaveText('2');
    assert.deepEqual(cloud.ownedDexIds, [1, 25]); assert.equal(cloud.settings.rows, 3);
    assert.equal(snapshots.length, 2);
    await page.reload(); await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#owned-count')).toHaveText('2');
    await page.locator('#owned-grid-2').check();
    await expect.poll(() => cloud.ownedDexIds.join(',')).toBe('1,2,25');
    user = null; await page.reload();
    await expect(page.locator('#dex-app')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#owned-count')).toHaveText('1');
    assert.deepEqual(cloud.ownedDexIds, [1, 2, 25], 'Signing out must preserve the account collection.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal overflow.');
    assert.deepEqual(errors, []);
    await context.close();
    process.stdout.write(`Binder account migration, reload, edit, logout and layout passed at ${viewport.width}px.\n`);
  }
} finally { await browser.close(); }
