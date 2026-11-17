import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'
import { emptyCompanionProgress } from '../../src/domain/companion-progress'
import { accountKey, ACTIVE_ACCOUNT_KEY, documentKeys, documents } from '../../src/account-storage'
import type { RemoteDocument } from '../../../../packages/accounts/client'

const revision = (JSON.parse(readFileSync('public/catalog.json', 'utf8')) as { revision: string }).revision
const id = '11111111-1111-4111-8111-111111111111'
test('reviews and connects existing saves without changing originals, then persists account edits through reload', async ({ page }) => {
  const initial = emptyCompanionProgress(revision); initial.modules.material = { tracked: true, records: { unknownMaterial: { count: '90071992547409931234567890', discovered: false } } }
  const original = JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: initial })
  await page.addInitScript(({ key, value }) => { if (!sessionStorage.getItem('seeded-account-test')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded-account-test', 'yes') } }, { key: documentKeys.progress, value: original })
  const server = new Map<string, RemoteDocument>(), selected = new Map<string, unknown>(), writes: unknown[] = [], calls: string[] = []
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), action = url.searchParams.get('action')!, body = request.method() === 'POST' ? request.postDataJSON() : null
    calls.push(action)
    if (url.pathname.endsWith('auth.php')) { await route.fulfill({ json: { enabled: true, migrationEnabled: true, user: { id, email: 'private@example.test' }, csrfToken: 'test-csrf' } }); return }
    expect(request.headers()['x-account-id']).toBe(id)
    if (action === 'read') { await route.fulfill({ json: { document: server.get(url.searchParams.get('document')!) ?? null } }); return }
    if (action === 'migration-stage') { if (body.variant === 'selected') selected.set(body.document, body.state); await route.fulfill({ json: { staged: true } }); return }
    if (action === 'migration-commit') {
      expect(body.documents).toHaveLength(4)
      for (const name of documents) server.set(name, { resourceId: 'resource-' + name, app: 'idle-slayer-companion', document: name, schemaVersion: 1, revision: 1, state: selected.get(name), acknowledgedSequence: 0 })
      await route.fulfill({ json: { documents: [...server.values()] } }); return
    }
    if (action === 'write') {
      writes.push(body); const before = server.get(body.document)!
      expect(body.baseRevision).toBe(before.revision); expect(body.mutationSequence).toBe(before.acknowledgedSequence + 1)
      const document = { ...before, revision: before.revision + 1, state: body.state, acknowledgedSequence: body.mutationSequence }; server.set(body.document, document)
      await route.fulfill({ json: { document } }); return
    }
    await route.fulfill({ status: 404, json: { error: { code: 'test_route', message: 'Unexpected test request' } } })
  })
  await page.goto('./')
  await page.getByRole('button', { name: 'Account & sync', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Account & sync', exact: true })
  await dialog.getByRole('button', { name: 'Review and connect saved data', exact: true }).click()
  await expect(dialog.getByRole('group', { name: 'Companion progress', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Connect and verify all saved data', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), ACTIVE_ACCOUNT_KEY)).toBe(id)
  expect(await page.evaluate((key) => localStorage.getItem(key), documentKeys.progress)).toBe(original)
  expect(calls.filter((action) => action === 'migration-stage')).toHaveLength(8)
  // The boundary remounts only after all account documents have been verified.
  await page.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await expect.poll(() => writes.length).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).pending.progress ?? null, accountKey(id))).toBe(null)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Show spoilers', exact: true })).toBeChecked()
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), accountKey(id))
  expect(saved.remote.progress.state.modules.material.records.unknownMaterial.count).toBe('90071992547409931234567890')
  expect(await page.evaluate((key) => localStorage.getItem(key), documentKeys.progress)).toBe(original)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('keeps invalid browser saves untouched and account actions private', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{broken-original'), documentKeys.comparison)
  await page.route('**/api/v1/auth.php?**', (route) => route.fulfill({ json: { enabled: true, migrationEnabled: true, user: { id, email: 'private@example.test' }, csrfToken: 'test' } }))
  let syncRequests = 0
  await page.route('**/api/v1/sync.php?**', async (route) => { syncRequests++; await route.fulfill({ json: { document: null } }) })
  await page.goto('./')
  await page.getByRole('button', { name: 'Account & sync', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Account & sync', exact: true })
  await dialog.getByRole('button', { name: 'Review and connect saved data', exact: true }).click()
  await expect(dialog.getByText('Saved comparison could not be validated.', { exact: true })).toBeVisible()
  expect(syncRequests).toBe(0)
  expect(await page.evaluate((key) => localStorage.getItem(key), documentKeys.comparison)).toBe('{broken-original')
  expect(await dialog.evaluate((element) => !!element.closest('.telemetry-private.rr-block'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})
