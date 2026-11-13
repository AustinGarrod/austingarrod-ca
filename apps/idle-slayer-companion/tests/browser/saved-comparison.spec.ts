import { installProfileTestHelpers } from './fixtures'
import { expect, test } from './fixtures'
import { chromium, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'
import { upgradeState } from '../../src/domain/discovery'
import { COMPARISON_STORAGE_KEY, emptyComparison, exportComparison } from '../../src/domain/saved-comparison'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const upgrade = (title: string) => catalog.upgrades.find((node) => node.title === title)!
const ids = (titles: string[]) => titles.map((title) => upgrade(title).id)
const makeList = (ids: string[]) => ({ ...emptyComparison(), ids })
const cost = (value: string) => `${BigInt(value).toLocaleString('en')} SP`
const initial = emptyProfile(catalog.revision)
const ordinary = visibility(catalog, initial).upgrades.slice(0, 5)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})
async function seed(page: Page, profile = initial, comparisonIds: string[] = []) {
  await page.addInitScript(({ profile, comparison, profileKey, comparisonKey }) => {
    localStorage.setItem(profileKey, JSON.stringify(profile)); localStorage.setItem(comparisonKey, JSON.stringify(comparison))
  }, { profile, comparison: makeList(comparisonIds), profileKey: PROFILE_STORAGE_KEY, comparisonKey: COMPARISON_STORAGE_KEY })
}
async function open(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const mobile = page.getByRole('button', { name: 'Map options', exact: true })
  await (await mobile.isVisible() ? mobile : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Saved upgrade comparison…', exact: true }).click()
  return page.getByRole('dialog', { name: 'Saved upgrade comparison', exact: true })
}
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), COMPARISON_STORAGE_KEY)
const progress = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)

test('queued export uses newly adopted visibility before React commits without editing saved references', async ({ page }) => {
  const hidden = catalog.upgrades.find((node) => !visibility(catalog, initial).ids.has(node.id))!
  const unknown = 'unavailable-queued-export'
  const selected = [hidden.id, catalog.startId, unknown]
  await seed(page, { ...initial, showSpoilers: true }, selected)
  await page.goto('./ascension/'); const dialog = await open(page)
  const download = page.waitForEvent('download')
  const connected = await dialog.evaluate((element, { key, next }) => {
    const button = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Export comparison')!
    const oldValue = window.__readMapProfileText(key), newValue = JSON.stringify(next)
    window.__writeExternalMapProfileText(key, newValue)
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage, url: location.href }))
    const connected = button.isConnected; button.click(); return connected
  }, { key: PROFILE_STORAGE_KEY, next: initial })
  expect(connected).toBe(true)
  const payload = readFileSync((await (await download).path())!, 'utf8')
  expect(JSON.parse(payload)).toEqual(makeList([catalog.startId, unknown]))
  expect(payload).not.toContain(hidden.id)
  await expect(dialog.locator('.saved-comparison-card[data-upgrade-id]')).toHaveCount(1)
  await expect(dialog.locator('.saved-comparison-card')).toHaveCount(2)
  await expect(dialog).toContainText('Unavailable catalog entry')
  await expect(dialog).not.toContainText(hidden.title)
  expect(await stored(page)).toBe(JSON.stringify(makeList(selected)))
  expect(JSON.parse((await progress(page))!)).toEqual(initial)
})

for (const action of ['add', 'restore'] as const) {
  test(`queued ${action} respects newly adopted visibility before React commits`, async ({ page }) => {
    const hidden = catalog.upgrades.find((node) => !visibility(catalog, initial).ids.has(node.id))!
    await seed(page, { ...initial, showSpoilers: true }, [catalog.startId])
    await page.goto('./ascension/'); const dialog = await open(page)
    if (action === 'add') {
      const picker = dialog.locator('.saved-comparison-picker')
      if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) await picker.locator('summary').click()
    } else {
      await dialog.getByLabel('Upgrade comparison JSON backup', { exact: true }).setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(exportComparison(makeList([hidden.id]))) })
      await expect(dialog.getByRole('region', { name: 'Review comparison restore' })).toContainText(hidden.title)
    }
    const connected = await dialog.evaluate((element, { key, next, action, id }) => {
      const button = action === 'add'
        ? element.querySelector<HTMLButtonElement>(`.saved-comparison-results button[data-upgrade-id="${id}"]`)!
        : [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Replace comparison')!
      const oldValue = window.__readMapProfileText(key), newValue = JSON.stringify(next)
      window.__writeExternalMapProfileText(key, newValue)
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage, url: location.href }))
      const connected = button.isConnected; button.click(); return connected
    }, { key: PROFILE_STORAGE_KEY, next: initial, action, id: hidden.id })
    expect(connected).toBe(true)
    await expect(dialog.locator('.saved-comparison-card[data-upgrade-id]')).toHaveCount(1)
    await expect(dialog).not.toContainText(hidden.title)
    await expect(dialog).toContainText('Comparison saved on this device.')
    expect(await stored(page)).toBe(JSON.stringify(makeList([catalog.startId])))
    expect(JSON.parse((await progress(page))!)).toEqual(initial)
  })
}

async function choose(page: Page, id: string) {
  const picker = page.locator('.saved-comparison-picker')
  if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) await picker.locator('summary').click()
  await picker.locator(`button[data-upgrade-id="${id}"]`).click()
  await expect.poll(() => stored(page)).toBe(exportComparison(makeList(await page.locator('.saved-comparison-card[data-upgrade-id]').evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.upgradeId!)))))
}

test('arbitrary visible states compare exact native facts without changing progress', async ({ page }) => {
  const profile = { ...initial, epoch: 1, showSpoilers: true, purchases: { [upgrade('Permanent Slayer').id]: { epoch: 0, active: true }, [upgrade('Limit Break').id]: { epoch: 1, active: false } } }
  const available = catalog.upgrades.find((node) => upgradeState(node, profile) === 'available')!
  const entries = [upgrade('Permanent Slayer'), upgrade('Limit Break'), upgrade('Coimbo Release'), available]
  await seed(page, profile, entries.map((node) => node.id)); await page.goto('./ascension/')
  const before = await progress(page), dialog = await open(page)
  await expect(dialog.locator('.saved-comparison-card')).toHaveCount(4)
  for (const node of entries) {
    const card = dialog.locator(`.saved-comparison-card[data-upgrade-id="${node.id}"]`)
    await expect(card).toContainText(node.description); await expect(card).toContainText(cost(node.cost)); await expect(card).toContainText(node.id)
    await expect(card).toContainText('Purchase requirements'); await expect(card).toContainText('Reveal requirements')
    await card.locator('summary').click()
    for (const source of node.sources) await expect(card).toContainText(source.label)
  }
  await expect(dialog).toContainText('Owned and active'); await expect(dialog).toContainText('Owned · awaiting activation')
  await expect(dialog).toContainText('Locked · native requirements not recorded'); await expect(dialog).toContainText('Available · prerequisites recorded')
  await expect(dialog.getByRole('button', { name: /Record purchase|Apply purchases/ })).toHaveCount(0)
  expect(await progress(page)).toBe(before)
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
})

test('picker adds, explicitly replaces and removes stable IDs and survives reopening', async ({ page }) => {
  await seed(page); await page.goto('./ascension/'); const before = await progress(page)
  let dialog = await open(page)
  for (const node of ordinary.slice(0, 4)) await choose(page, node.id)
  await expect(dialog.locator(`.saved-comparison-results button[data-upgrade-id="${ordinary[4].id}"]`)).toBeDisabled()
  await dialog.getByRole('button', { name: 'Replace entry 2…', exact: true }).click()
  await choose(page, ordinary[4].id)
  await expect(dialog.locator(`.saved-comparison-card[data-upgrade-id="${ordinary[1].id}"]`)).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Remove entry 1', exact: true }).click()
  await expect(dialog.locator('.saved-comparison-card')).toHaveCount(3)
  const saved = await stored(page)
  await page.keyboard.press('Escape'); dialog = await open(page)
  await expect(dialog.locator('.saved-comparison-card')).toHaveCount(3); expect(await stored(page)).toBe(saved)
  expect(await progress(page)).toBe(before)
})

test('duplicate Astral Keys keep separate costs, rules and map identity', async ({ page }) => {
  const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key').slice(-4)
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile, keys.map((node) => node.id)); await page.goto('./ascension/')
  const dialog = await open(page)
  for (const node of keys) await expect(dialog.locator(`article[data-upgrade-id="${node.id}"]`)).toContainText(cost(node.cost))
  await dialog.locator(`article[data-upgrade-id="${keys[2].id}"]`).getByRole('button', { name: 'Show on map', exact: true }).click()
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', keys[2].id)
  await expect(page.locator('.details h2')).toBeFocused()
  expect(await progress(page)).toBe(JSON.stringify(profile))
})

test('requirement review uses the existing return route without changing either stored document', async ({ page }) => {
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile, ids(['Coimbo Release', 'Limit Break', 'Astral Slayer'])); await page.goto('./ascension/')
  const before = await progress(page), reference = await stored(page), dialog = await open(page)
  await dialog.locator(`article[data-upgrade-id="${upgrade('Coimbo Release').id}"]`).getByRole('button', { name: /^Review Limit Break/ }).first().click()
  await expect(page.locator('.details h2')).toHaveText('Limit Break')
  await expect(page.locator('.details h2')).toBeFocused()
  await page.getByRole('button', { name: 'Return to Coimbo Release', exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText('Coimbo Release')
  await page.getByRole('button', { name: 'Compare this upgrade…', exact: true }).click()
  await expect(page.locator('.saved-comparison-card')).toHaveCount(3)
  // A new comparison review starts at its chosen card, not an older route origin.
  await page.locator(`article[data-upgrade-id="${upgrade('Coimbo Release').id}"]`).getByRole('button', { name: /^Review Limit Break/ }).first().click()
  await page.getByRole('button', { name: 'Compare this upgrade…', exact: true }).click()
  await page.locator(`article[data-upgrade-id="${upgrade('Astral Slayer').id}"]`).getByRole('button', { name: 'Review At least one Ultra Ascension', exact: true }).first().click()
  await expect(page.getByRole('dialog', { name: 'Your progress', exact: true }).getByRole('button', { name: 'Return to Astral Slayer', exact: true })).toBeVisible()
  expect(await progress(page)).toBe(before); expect(await stored(page)).toBe(reference)
})

test('native reset and Undo recompute facts while leaving the reference list unchanged', async ({ page }) => {
  const lock = upgrade('Limit Break'), reset = upgrade('Ultra Ascension'), repeat = upgrade('Permanent Slayer')
  const profile = { ...initial, showSpoilers: true, epoch: 1, purchases: { [lock.id]: { epoch: 1, active: false }, [reset.id]: { epoch: 1, active: true }, [repeat.id]: { epoch: 1, active: true } } }
  await seed(page, profile, [lock.id, repeat.id]); await page.goto('./ascension/')
  const reference = await stored(page)
  let dialog = await open(page)
  await expect(dialog.locator(`article[data-upgrade-id="${lock.id}"]`)).toContainText('Owned · awaiting activation')
  await page.keyboard.press('Escape')
  const mobile = page.getByRole('button', { name: 'Map options', exact: true })
  if (await mobile.isVisible()) await mobile.click()
  await page.getByRole('button', { name: 'Progress', exact: true }).click()
  await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true }).getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
  dialog = await open(page)
  await expect(dialog.locator(`article[data-upgrade-id="${lock.id}"]`)).toContainText('Owned and active')
  await expect(dialog.locator(`article[data-upgrade-id="${repeat.id}"]`)).toContainText('not currently owned')
  expect(await stored(page)).toBe(reference)
  await page.keyboard.press('Escape')
  if (await mobile.isVisible()) {
    await mobile.click()
    await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Undo', exact: true }).click()
  } else {
    await page.locator('.companion-session-status').getByRole('button', { name: 'Undo', exact: true }).click()
  }
  await expect.poll(async () => JSON.parse((await progress(page))!)).toEqual(profile)
  expect(await stored(page)).toBe(reference)
})

test('current visibility hides identities, counts, picker options and exported IDs after external progress', async ({ page, context }) => {
  const secret = ids(['Limit Break', 'Coimbo Release'])
  const profile = { ...initial, showSpoilers: true }
  await seed(page, profile, [ordinary[0].id, ...secret]); await page.goto('./ascension/')
  await page.getByRole('searchbox').fill('Limit Break')
  await page.locator(`.search-result[data-upgrade-id="${secret[0]}"]`).click()
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('button', { name: 'Compare this upgrade…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Saved upgrade comparison', exact: true })
  await dialog.getByRole('button', { name: 'Replace entry 2…', exact: true }).click()
  await page.evaluate(() => {
    const labels: string[] = []
    Object.assign(window, { comparisonLabelMutations: labels })
    new MutationObserver((records) => {
      for (const record of records) {
        const parent = record.target instanceof Element ? record.target : record.target.parentElement
        if (parent?.closest('.saved-comparison-picker summary')) labels.push(record.oldValue ?? '', record.target.textContent ?? '')
      }
    }).observe(document.querySelector('.saved-comparison')!, { subtree: true, characterData: true, characterDataOldValue: true })
  })
  const other = await context.newPage(); await other.goto('./ascension/')
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(dialog.locator('.saved-comparison-card')).toHaveCount(1)
  await expect(dialog).toContainText('Compared entries · 1 / 4')
  await expect(dialog.getByRole('searchbox', { name: 'Find a visible upgrade', exact: true })).toHaveValue('')
  await expect(dialog.locator('.saved-comparison-picker summary')).toHaveText('Choose a visible upgrade')
  expect(await page.evaluate(() => (window as unknown as { comparisonLabelMutations: string[] }).comparisonLabelMutations.some((label) => label.includes('entry 0')))).toBe(false)
  for (const id of secret) { await expect(dialog).not.toContainText(id); await expect(dialog).not.toContainText(catalog.upgrades.find((node) => node.id === id)!.title) }
  const event = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Export comparison', exact: true }).click()
  const download = await event
  expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual(makeList([ordinary[0].id]))
  expect(JSON.parse((await stored(page))!).ids).toEqual([ordinary[0].id, ...secret])
  await choose(page, ordinary[1].id)
  expect(JSON.parse((await stored(page))!).ids).toEqual([ordinary[0].id, ordinary[1].id])
  await other.close()
})

test('unavailable entries are honest and exportable without inventing catalog facts', async ({ page }) => {
  await seed(page, initial, ['SENTINEL-unknown-comparison']); await page.goto('./ascension/'); const dialog = await open(page)
  await expect(dialog.locator('article')).toContainText('Unavailable catalog entry')
  await expect(dialog).not.toContainText('SENTINEL-unknown-comparison')
  await expect(dialog.locator('article').getByRole('button', { name: 'Show on map' })).toHaveCount(0)
  const event = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Export comparison', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await event).path())!, 'utf8'))).toEqual(makeList(['SENTINEL-unknown-comparison']))
  await dialog.getByRole('button', { name: 'Remove entry 1', exact: true }).click()
  await expect(dialog.locator('article')).toHaveCount(0)
})

test('comparison restore requires confirmation and rejects profile or oversized files', async ({ page }) => {
  await seed(page, initial, [ordinary[0].id]); await page.goto('./ascension/'); const before = await progress(page), dialog = await open(page)
  const file = dialog.getByLabel('Upgrade comparison JSON backup', { exact: true })
  await file.setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(exportComparison(makeList([ordinary[1].id]))) })
  await expect(dialog.getByRole('region', { name: 'Review comparison restore' })).toContainText(ordinary[1].title)
  expect(JSON.parse((await stored(page))!).ids).toEqual([ordinary[0].id])
  await dialog.getByRole('button', { name: 'Cancel restore', exact: true }).click()
  await file.setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) })
  await expect(dialog).toContainText('not a supported comparison backup')
  await file.setInputFiles({ name: 'huge.json', mimeType: 'application/json', buffer: Buffer.from(' '.repeat(4097)) })
  await expect(dialog).toContainText('not a supported comparison backup')
  await file.setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(exportComparison(makeList([ordinary[1].id]))) })
  await dialog.getByRole('button', { name: 'Replace comparison', exact: true }).click()
  await expect.poll(() => stored(page)).toBe(exportComparison(makeList([ordinary[1].id])))
  expect(await progress(page)).toBe(before)
})

test('clean cross-tab updates invalidate restore and adopt the latest comparison', async ({ page, context }) => {
  await seed(page, initial, [ordinary[0].id]); await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.getByLabel('Upgrade comparison JSON backup', { exact: true }).setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(exportComparison(makeList([ordinary[1].id]))) })
  await expect(dialog.getByRole('region', { name: 'Review comparison restore' })).toBeVisible()
  const other = await context.newPage(); await other.goto('./ascension/')
  await other.evaluate(({ key, value }) => window.__writeExternalMapProfileText(key, value), { key: COMPARISON_STORAGE_KEY, value: exportComparison(makeList([ordinary[2].id])) })
  await expect(dialog.getByRole('region', { name: 'Review comparison restore' })).toHaveCount(0)
  await expect(dialog.locator('article')).toContainText(ordinary[2].title)
  await other.close()
})

test('unchanged corrupt comparison storage stays recoverable and requires explicit replacement', async ({ page }) => {
  await seed(page)
  await page.addInitScript((key) => localStorage.setItem(key, 'SENTINEL-invalid-private-comparison'), COMPARISON_STORAGE_KEY)
  await page.goto('./ascension/'); const dialog = await open(page), before = await progress(page)
  await expect(dialog).not.toContainText('SENTINEL-invalid-private-comparison')
  await dialog.getByRole('button', { name: 'Refresh recovery', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Replace saved comparison…', exact: true })).toBeVisible()
  await dialog.locator(`.saved-comparison-results button[data-upgrade-id="${ordinary[0].id}"]`).click()
  expect(await stored(page)).toBe('SENTINEL-invalid-private-comparison')
  await dialog.getByRole('button', { name: 'Replace saved comparison…', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Review comparison recovery' })).toContainText('cannot be read as a supported reference list')
  await dialog.getByRole('button', { name: 'Confirm comparison recovery', exact: true }).click()
  await expect.poll(() => stored(page)).toBe(exportComparison(makeList([ordinary[0].id])))
  expect(await progress(page)).toBe(before)
})

test('dirty external races keep memory and require fresh deliberate recovery', async ({ page, context }) => {
  await seed(page)
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('SENTINEL-private-storage'); return original.call(this, name, value) }
  }, COMPARISON_STORAGE_KEY)
  await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.locator(`.saved-comparison-results button[data-upgrade-id="${ordinary[0].id}"]`).click()
  await expect(dialog).toContainText('Saving failed'); await expect(dialog).not.toContainText('SENTINEL-private-storage')
  const other = await context.newPage(); await other.goto('./ascension/')
  const external = exportComparison(makeList([ordinary[1].id]))
  await other.evaluate(({ key, value }) => window.__writeExternalMapProfileText(key, value), { key: COMPARISON_STORAGE_KEY, value: external })
  await expect(dialog).toContainText('Your local comparison was kept')
  await expect(dialog.locator('article')).toContainText(ordinary[0].title)
  await dialog.getByRole('button', { name: 'Use saved comparison…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm comparison recovery', exact: true }).click()
  await expect(dialog.locator('article')).toContainText(ordinary[1].title)
  expect(await stored(page)).toBe(external); expect(await progress(page)).toBe(JSON.stringify(initial))
  await other.close()
})

test('profile conflict recovery replaces the comparison modal and preserves its saved reference', async ({ page, context }) => {
  await seed(page, initial, [ordinary[1].id])
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic profile write refusal'); return original.call(this, name, value) }
  }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  const reference = await stored(page), dialog = await open(page)
  const other = await context.newPage(); await other.goto('./ascension/')
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true } })
  await dialog.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  const recovery = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await expect(recovery).toBeVisible()
  await recovery.getByRole('button', { name: 'Close dialog', exact: true }).click()
  expect(await stored(page)).toBe(reference)
  await other.close()
})

test('late comparison file reads cannot reopen a closed or changed reference', async ({ page }) => {
  await seed(page)
  await page.addInitScript(() => {
    const original = File.prototype.text
    File.prototype.text = function () { const file = this; return new Promise((resolve) => setTimeout(() => { void original.call(file).then(resolve) }, 300)) }
  })
  await page.goto('./ascension/'); let dialog = await open(page)
  await dialog.getByLabel('Upgrade comparison JSON backup', { exact: true }).setInputFiles({ name: 'comparison.json', mimeType: 'application/json', buffer: Buffer.from(exportComparison(makeList([ordinary[1].id]))) })
  await page.keyboard.press('Escape'); dialog = await open(page)
  await page.waitForTimeout(400)
  await expect(dialog.getByRole('region', { name: 'Review comparison restore' })).toHaveCount(0)
  expect(JSON.parse((await stored(page))!).ids).toEqual([])
})

test('ordinary narrow comparison controls wrap and retain touch and keyboard access', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key').slice(-4)
  await seed(page, { ...initial, showSpoilers: true }, keys.map((node) => node.id)); await page.goto('./ascension/'); const dialog = await open(page)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  for (const button of await dialog.locator('.saved-comparison-tools button').all()) {
    await button.focus(); await expect(button).toBeFocused()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('comparison-320.png') })
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  const trigger = page.getByRole('button', { name: 'Map options', exact: true }); await expect(trigger).toBeFocused()
})

test('comparison reflows with actual 32px browser text in portrait and landscape', async ({ baseURL }, info) => {
  test.setTimeout(60_000) // Include native persistent font-profile cleanup; assertion timeouts remain unchanged.
  const directory = info.outputPath('comparison-font-profile')
  await mkdir(join(directory, 'Default'), { recursive: true })
  await writeFile(join(directory, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }))
  const context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], baseURL, viewport: { width: 320, height: 568 }, ...(info.project.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) })
  await installProfileTestHelpers(context)
  const errors: string[] = []
  const watch = (page: Page) => page.on('pageerror', (error) => errors.push(error.message))
  context.pages().forEach(watch); context.on('page', watch)
  try {
    await context.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
    await context.route('https://analytics.garrod.house/**', (route) => route.abort())
    const page = await context.newPage()
    await seed(page, { ...initial, showSpoilers: true }, ids(['Limit Break', 'Coimbo Release']))
    await page.goto('./ascension/'); await expect(page.locator('html')).toHaveCSS('font-size', '32px')
    const dialog = await open(page)
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const button = dialog.getByRole('button', { name: 'Remove entry 2', exact: true })
      await button.focus(); await expect(button).toBeFocused(); await expect(button).toBeInViewport()
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true)
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      await page.screenshot({ path: info.outputPath(`comparison-32-${viewport.width}.png`) })
    }
    await page.setViewportSize({ width: 320, height: 568 })
    await dialog.getByRole('button', { name: 'Replace entry 2…', exact: true }).click()
    const largest = catalog.upgrades.reduce((first, node) => BigInt(first.cost) > BigInt(node.cost) ? first : node)
    await dialog.getByRole('searchbox', { name: 'Find a visible upgrade', exact: true }).fill(largest.title)
    const choice = dialog.locator(`.saved-comparison-results button[data-upgrade-id="${largest.id}"]`)
    await choice.focus(); await expect(choice).toBeFocused()
    await expect(choice.locator('b')).toBeInViewport()
    expect(await choice.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    await choice.press('Enter')
    await expect(dialog.locator(`article[data-upgrade-id="${largest.id}"]`)).toContainText(cost(largest.cost))
    await page.screenshot({ path: info.outputPath('comparison-32-largest-choice.png') })
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  } finally { await context.close(); expect(errors, 'Unhandled browser errors during actual-font comparison').toEqual([]) }
})
