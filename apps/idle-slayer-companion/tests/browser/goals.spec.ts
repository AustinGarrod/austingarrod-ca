import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { COMPANION_WORKSPACE_KEY } from '../../src/domain/companion-workspace'
import { visibility } from '../../src/domain/rules'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function choose(page: Page, title: string, mode = 'acquire') {
  await page.getByRole('searchbox').fill(title)
  await page.locator('.search-result').filter({ has: page.locator('.discovery-title', { hasText: new RegExp('^' + title + '$') }) }).first().click()
  const toggle = page.getByRole('button', { name: 'Show details', exact: true })
  if (await toggle.isVisible()) await toggle.click()
  await page.getByRole('button', { name: 'Set progression goal…', exact: true }).click()
  await page.getByRole('combobox', { name: 'Goal completion', exact: true }).selectOption(mode)
  await page.getByRole('button', { name: 'Save goal', exact: true }).click()
  await expect(page.locator('.goals-panel')).toContainText('Intention recorded')
}
async function progress(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const action = page.getByRole('button', { name: 'Progress', exact: true })
  if (!await action.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await action.click()
}
const saved = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)

test('intentions persist independently, reorder and retire without recording purchases or entering progress backups', async ({ page }) => {
  await page.goto('./ascension/')
  await choose(page, 'Minions')
  await expect(page.locator('.goal-list')).toContainText('Blocked by native requirements')
  expect(await saved(page)).toBeNull()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await choose(page, 'Permanent Slayer', 'rebuild')
  const goals = page.locator('.goal-list li')
  await expect(goals).toHaveCount(2)
  await goals.nth(1).getByRole('button', { name: 'Higher priority', exact: true }).click()
  await expect(goals.first()).toHaveAttribute('data-goal-id', catalog.startId)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const path = await (await download).path()
  expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual(initial)
  expect(await saved(page)).toBeNull()
  await page.reload(); await progress(page)
  await expect(page.locator('.goal-list li')).toHaveCount(2)
  await page.locator('.goal-list li').last().getByRole('button', { name: 'Retire goal', exact: true }).click()
  await expect(page.locator('.goal-list li')).toHaveCount(1)
  await expect(page.locator('.goals-panel')).toHaveClass(/rr-block/)
})

test('intentions stay usable across dialog lifetimes when saving fails', async ({ page }) => {
  await page.addInitScript((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new Error('synthetic storage failure'); native.call(this, name, value) }
  }, GOALS_STORAGE_KEY)
  await page.goto('./ascension/'); await choose(page, 'Permanent Slayer', 'rebuild')
  await expect(page.locator('.goals-panel')).toContainText('Intentions could not be saved')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  await expect(page.locator('.goal-list li')).toHaveCount(1)
  await expect(page.locator('.goal-list')).toContainText('Eligible to purchase')
  expect(await saved(page)).toBeNull()
})

test('hidden and unknown saved goals remain retained without contributing identities or counts', async ({ page }) => {
  const hidden = catalog.upgrades.find((upgrade) => !visibility(catalog, initial).ids.has(upgrade.id))!
  const intentions = { version: 1, targets: [{ id: hidden.id, mode: 'activate' }, { id: 'future-unknown-private', mode: 'rebuild' }, { id: catalog.startId, mode: 'acquire' }] }
  await page.addInitScript(({ key, intentions }) => localStorage.setItem(key, JSON.stringify(intentions)), { key: GOALS_STORAGE_KEY, intentions })
  await page.goto('./ascension/'); await progress(page)
  await expect(page.locator('.goal-list li')).toHaveCount(1)
  await expect(page.locator('.goals-panel')).toContainText('1 visible goal · 0 achieved')
  await expect(page.locator('.goals-panel')).not.toContainText(hidden.title)
  expect(await page.locator('.goals-panel').innerHTML()).not.toContain('future-unknown-private')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), GOALS_STORAGE_KEY)).toEqual(intentions)
})

test('pending acquisition and activation goals use actual ownership and cross-tab progress', async ({ page, context }) => {
  const scales = node('Astral Scales')
  await page.addInitScript(({ key, profile, goalsKey, id }) => {
    localStorage.setItem(key, JSON.stringify(profile))
    localStorage.setItem(goalsKey, JSON.stringify({ version: 1, targets: [{ id, mode: 'activate' }] }))
  }, { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true, purchases: { [scales.id]: { epoch: 0, active: false } } }, goalsKey: GOALS_STORAGE_KEY, id: scales.id })
  await page.goto('./ascension/'); await progress(page)
  await expect(page.locator('.goal-list')).toContainText('Owned, awaiting activation')
  await expect(page.locator('.goals-panel')).toContainText('0 achieved')
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true, purchases: { [scales.id]: { epoch: 0, active: true } } } })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await progress(page)
  await expect(page.locator('.goals-panel')).toContainText('1 achieved')
  await expect(page.locator('.goal-list')).toContainText('Achieved')
})

test('unreadable saved goals are preserved until deliberate confirmed recovery', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, '{invalid-private-fixture'), GOALS_STORAGE_KEY)
  await page.goto('./ascension/'); await choose(page, 'Permanent Slayer')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBe('{invalid-private-fixture')
  await page.getByRole('button', { name: "Save this visit's goals…", exact: true }).click()
  await page.getByRole('button', { name: 'Cancel intentions recovery', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBe('{invalid-private-fixture')
  await page.getByRole('button', { name: "Save this visit's goals…", exact: true }).click()
  await page.getByRole('button', { name: 'Replace checked saved intentions with this visit', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), GOALS_STORAGE_KEY)).toEqual({ version: 1, targets: [{ id: catalog.startId, mode: 'acquire' }] })
  expect(await saved(page)).toBeNull()
})


test('recurring checklist recomputes from a real reset and retains conditionally kept Village Key', async ({ page }) => {
  const landlord = node('Land Lord'), village = node('Village Key')
  const profile = { ...initial, epoch: 1, showSpoilers: true, purchases: Object.fromEntries(catalog.upgrades.map((upgrade) => [upgrade.id, { epoch: 1, active: upgrade.id !== landlord.id }])) }
  const intentions = { version: 1, targets: [{ id: village.id, mode: 'rebuild' }, { id: catalog.startId, mode: 'rebuild' }] }
  await page.addInitScript(({ key, profile, goalsKey, intentions }) => {
    localStorage.setItem(key, JSON.stringify(profile)); localStorage.setItem(goalsKey, JSON.stringify(intentions))
  }, { key: PROFILE_STORAGE_KEY, profile, goalsKey: GOALS_STORAGE_KEY, intentions })
  await page.goto('./ascension/'); await progress(page)
  await expect(page.locator('.goals-panel')).toContainText('2 achieved')
  await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true }).getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 2')
  await progress(page)
  await expect(page.locator('.goals-panel')).toContainText('1 achieved')
  await expect(page.locator(`.goal-list li[data-goal-id="${village.id}"]`)).toContainText('Achieved')
  await expect(page.locator(`.goal-list li[data-goal-id="${catalog.startId}"]`)).toContainText('Eligible to purchase')
  const actual = JSON.parse((await saved(page))!)
  expect(actual.purchases[village.id]).toBeTruthy()
  expect(actual.purchases[catalog.startId]).toBeUndefined()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  if (!await undo.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await undo.click()
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  await expect(page.locator('.goals-panel')).toContainText('2 achieved')
  expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), GOALS_STORAGE_KEY)).toEqual(intentions)
})


test('unsaved intentions survive external goal changes until deliberate recovery', async ({ page, context }) => {
  await page.addInitScript((key) => {
    const native = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new Error('synthetic storage failure'); native.call(this, name, value) }
  }, GOALS_STORAGE_KEY)
  await page.goto('./ascension/'); await choose(page, 'Permanent Slayer', 'rebuild')
  const other = await context.newPage(); await other.goto(page.url())
  const incoming = { version: 1, targets: [{ id: node('Minions').id, mode: 'acquire' }] }
  await other.evaluate(({ key, incoming }) => window.__writeExternalMapProfileText(key, JSON.stringify(incoming)), { key: GOALS_STORAGE_KEY, incoming })
  await expect(page.locator('.goals-panel')).toContainText('Saved intentions changed in another tab')
  await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
  await page.getByRole('button', { name: 'Review saved goals', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel intentions recovery', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
  await page.getByRole('button', { name: 'Review saved goals', exact: true }).click()
  await page.getByRole('button', { name: 'Use checked saved intentions', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
  await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', node('Minions').id)
  expect(await saved(page)).toBeNull()
})


for (const failure of ['unavailable', 'corrupt'] as const) {
  test(`failed ${failure} saved-goal recovery preserves usable visit intentions`, async ({ page }) => {
    await page.addInitScript((key) => {
      const win = window as Window & { refuseGoalWrites?: boolean; refuseGoalReads?: boolean }
      win.refuseGoalWrites = true
      const set = Storage.prototype.setItem, get = Storage.prototype.getItem
      Storage.prototype.setItem = function (name, value) {
        if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name) && win.refuseGoalWrites) throw new Error('Synthetic goal write refusal')
        set.call(this, name, value)
      }
      Storage.prototype.getItem = function (name) {
        if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name) && win.refuseGoalReads) throw new Error('Synthetic goal read refusal')
        return get.call(this, name)
      }
    }, GOALS_STORAGE_KEY)
    await page.goto('./ascension/'); await choose(page, 'Permanent Slayer', 'rebuild')
    await page.getByRole('button', { name: 'Review saved goals', exact: true }).click()
    await page.evaluate(({ key, failure }) => {
      const win = window as Window & { refuseGoalWrites?: boolean; refuseGoalReads?: boolean }
      if (failure === 'unavailable') win.refuseGoalReads = true
      else { win.refuseGoalWrites = false; window.__writeExternalMapProfileText(key, '{private-corrupt-goal-fixture'); win.refuseGoalWrites = true }
    }, { key: GOALS_STORAGE_KEY, failure })
    await page.getByRole('button', { name: 'Use checked saved intentions', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
    await expect(page.locator('.goal-list li')).toHaveCount(1)
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
    await expect(page.locator('.goal-list')).toContainText('Recurring rebuild')
    await expect(page.locator('.goals-panel')).toContainText(failure === 'corrupt' ? 'Saved intentions are invalid' : 'Saved intentions could not be read')
    await expect(page.locator('.goals-panel')).not.toContainText('private-corrupt-goal-fixture')
    expect(await saved(page)).toBeNull()
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await progress(page)
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
    await page.evaluate(() => {
      const win = window as Window & { refuseGoalWrites?: boolean; refuseGoalReads?: boolean }
      win.refuseGoalReads = false; win.refuseGoalWrites = false
    })
    await page.getByRole('button', { name: "Save this visit's goals…", exact: true }).click()
    await page.getByRole('button', { name: 'Replace checked saved intentions with this visit', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
    expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), GOALS_STORAGE_KEY)).toEqual({ version: 1, targets: [{ id: catalog.startId, mode: 'rebuild' }] })
  })

  test(`clean goals survive an external ${failure} read until valid confirmed replacement`, async ({ page, context }) => {
    await page.addInitScript((key) => {
      const get = Storage.prototype.getItem
      Storage.prototype.getItem = function (name) {
        if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name) && (window as Window & { refuseGoalReads?: boolean }).refuseGoalReads) throw new Error('Synthetic goal read refusal')
        return get.call(this, name)
      }
    }, GOALS_STORAGE_KEY)
    await page.goto('./ascension/'); await choose(page, 'Permanent Slayer')
    const incoming = { version: 1, targets: [{ id: node('Minions').id, mode: 'activate' }] }
    const other = await context.newPage(); await other.goto(page.url())
    if (failure === 'unavailable') await page.evaluate(() => { (window as Window & { refuseGoalReads?: boolean }).refuseGoalReads = true })
    await other.evaluate(({ key, failure, incoming }) => window.__writeExternalMapProfileText(key, failure === 'corrupt' ? '{private-corrupt-goal-fixture' : JSON.stringify(incoming)), { key: GOALS_STORAGE_KEY, failure, incoming })
    await expect(page.locator('.goals-panel')).toContainText(failure === 'corrupt' ? 'Saved intentions are invalid' : 'Saved intentions could not be read')
    await expect(page.locator('.goal-list li')).toHaveCount(1)
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
    await expect(page.locator('.goals-panel')).not.toContainText('private-corrupt-goal-fixture')
    expect(await saved(page)).toBeNull()
    await page.evaluate(() => { (window as Window & { refuseGoalReads?: boolean }).refuseGoalReads = false })
    await other.evaluate(({ key, incoming }) => window.__writeExternalMapProfileText(key, JSON.stringify(incoming)), { key: GOALS_STORAGE_KEY, incoming })
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
    await page.getByRole('button', { name: 'Review saved goals', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel intentions recovery', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', catalog.startId)
    await page.getByRole('button', { name: 'Review saved goals', exact: true }).click()
    await page.getByRole('button', { name: 'Use checked saved intentions', exact: true }).click()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await progress(page)
    await expect(page.locator('.goal-list li')).toHaveAttribute('data-goal-id', node('Minions').id)
    expect(await saved(page)).toBeNull()
  })
}


// Adopt an external storage notification in the capture phase of the same
// native click. useSyncExternalStore may commit the latest props immediately;
// the command must preserve the other tab's new entry in either case.
for (const action of ['save', 'retire', 'higher', 'lower'] as const) {
  test(`${action} intention edit racing external adoption preserves the other tab's new goals`, async ({ page }) => {
    const available = visibility(catalog, initial).upgrades.filter((upgrade) => upgrade.id !== catalog.startId && upgrade.id !== node('Minions').id)
    const original = { version: 1, targets: [{ id: catalog.startId, mode: 'acquire' }, { id: node('Minions').id, mode: 'acquire' }] }
    const incoming = { ...original, targets: [...original.targets, { id: available[0]!.id, mode: 'acquire' }] }
    await page.addInitScript(({ key, original }) => localStorage.setItem(key, JSON.stringify(original)), { key: GOALS_STORAGE_KEY, original })
    await page.goto('./ascension/')
    await page.getByRole('searchbox').fill('Permanent Slayer')
    await page.locator(`.search-result[data-upgrade-id="${catalog.startId}"]`).click()
    const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
    await page.getByRole('button', { name: 'Set progression goal…', exact: true }).click()
    await page.getByRole('combobox', { name: 'Goal completion', exact: true }).selectOption('activate')
    await expect(page.locator('.goal-list li')).toHaveCount(2)
    const control = action === 'save' ? page.getByRole('button', { name: 'Save goal', exact: true }) :
      action === 'retire' ? page.locator('.goal-list li').first().getByRole('button', { name: 'Retire goal', exact: true }) :
      action === 'higher' ? page.locator('.goal-list li').last().getByRole('button', { name: 'Higher priority', exact: true }) :
      page.locator('.goal-list li').first().getByRole('button', { name: 'Lower priority', exact: true })
    await control.evaluate((element, { legacyKey, key, incoming }) => {
      element.addEventListener('click', () => {
        const oldValue = localStorage.getItem(key)
        window.__writeExternalMapProfileText(legacyKey, JSON.stringify(incoming))
        dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: localStorage.getItem(key), storageArea: localStorage }))
      }, { capture: true, once: true })
    }, { legacyKey: GOALS_STORAGE_KEY, key: COMPANION_WORKSPACE_KEY, incoming })
    await control.click()
    const expected = { ...incoming, targets: action === 'save' ? incoming.targets.map((goal, index) => index === 0 ? { ...goal, mode: 'activate' } : goal) : action === 'retire' ? incoming.targets.slice(1) : [incoming.targets[1], incoming.targets[0], incoming.targets[2]] }
    await expect(page.locator('.goal-list li')).toHaveCount(expected.targets.length)
    await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), GOALS_STORAGE_KEY)).toEqual(expected)
    expect(await saved(page)).toBeNull()
  })
}
