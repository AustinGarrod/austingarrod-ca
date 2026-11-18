import { installProfileTestHelpers } from './fixtures'
import { expect, test } from './fixtures'
import { chromium, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
import { openProgress, selectUpgrade } from './helpers/app'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
const initial = emptyProfile(catalog.revision)
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)
async function seed(page: Page, profile: Profile) { await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile }) }
async function open(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const compact = page.getByRole('button', { name: 'Map options', exact: true })
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Plan hypothetical UAs…', exact: true }).click()
  return page.getByRole('dialog', { name: 'Hypothetical UA roadmap', exact: true })
}
const stage = (dialog: Locator, number: number) => dialog.locator(`[data-roadmap-stage="${number}"]`)
async function add(dialog: Locator, number: number, title: string) {
  const editor = stage(dialog, number), picker = editor.locator('.roadmap-picker')
  if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) await picker.locator('summary').click()
  await picker.getByRole('searchbox').fill(title)
  await picker.locator(`[data-roadmap-choice="${node(title).id}"]`).click()
}
async function intend(dialog: Locator, number: number) { const radio = stage(dialog, number).getByRole('radio'); if (await radio.count()) await radio.first().check() }
async function boundary(dialog: Locator, number: number) {
  await dialog.getByRole('checkbox', { name: `Full Ultra Ascension after stage ${number}`, exact: true }).check()
  await stage(dialog, number).getByRole('button', { name: `Include native UA prerequisite in stage ${number}`, exact: true }).click()
  await intend(dialog, number)
}
test('compares two deliberate sequences through two full native resets without writes or invented history', async ({ page }) => {
  const lord = node('Land Lord'), scales = node('Astral Scales'), slayer = node('Astral Slayer')
  const actual = { ...initial, epoch: 1, purchases: { [slayer.id]: { epoch: 0, active: true }, [lord.id]: { epoch: 1, active: false }, UNKNOWN_PRIVATE: { epoch: 1, active: true } } }
  await seed(page, actual); await page.goto('./ascension/'); const bytes = await stored(page), url = page.url(), dialog = await open(page)
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Activate Scales through two UAs')
  await boundary(dialog, 1)
  await expect(stage(dialog, 1).locator('.roadmap-reset')).toContainText('Land Lord')
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click(); await add(dialog, 2, scales.title); await boundary(dialog, 2)
  await expect(stage(dialog, 2).locator('.roadmap-reset')).toContainText('Astral Scales')
  await expect(stage(dialog, 2)).toContainText('Reacquired after hypothetical reset')
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click(); await add(dialog, 3, scales.title)
  await stage(dialog, 3).getByRole('combobox').selectOption('activate')
  await expect(stage(dialog, 3).locator('[data-roadmap-step]')).toHaveCount(0)
  await expect(stage(dialog, 3)).toContainText('Hypothetical stage start: Owned and active')
  await expect(dialog.locator('[data-roadmap-summary="0"]')).toContainText('supported by reviewed tree rules')
  await dialog.getByRole('button', { name: 'Add comparison sequence', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Try Scales before activating Land Lord')
  await add(dialog, 1, scales.title)
  await expect(dialog.locator('[data-roadmap-summary="1"]')).toContainText('full total withheld')
  await expect(stage(dialog, 1)).toContainText('pending ownership is not repurchased')
  await expect(dialog.locator('[data-roadmap-summary]')).toHaveCount(2)
  expect(await dialog.textContent()).not.toContain('UNKNOWN_PRIVATE')
  expect(await stored(page)).toBe(bytes); expect(page.url()).toBe(url)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBeNull()
  await page.keyboard.press('Escape'); const progress = await openProgress(page)
  await expect(progress.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
test('each reset requires fresh eligibility and later route intentions clear after earlier edits', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Choose every OR path')
  await add(dialog, 1, 'Legendary Belt'); await expect(stage(dialog, 1).getByRole('radio')).toHaveCount(4)
  await expect(stage(dialog, 1)).toContainText('Choose an intended route explicitly')
  await boundary(dialog, 1)
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click(); await add(dialog, 2, 'Legendary Belt'); await intend(dialog, 2)
  await stage(dialog, 2).getByRole('checkbox', { name: 'Full Ultra Ascension after stage 2', exact: true }).check(); await intend(dialog, 2)
  await expect(stage(dialog, 2)).toContainText('native Ultra Ascension prerequisite is not yet proved')
  await stage(dialog, 2).getByRole('button', { name: 'Include native UA prerequisite in stage 2', exact: true }).click(); await intend(dialog, 2)
  await expect(stage(dialog, 2).locator('.roadmap-reset')).toBeVisible()
  await stage(dialog, 1).getByRole('button', { name: 'Remove target Ultra Ascension', exact: true }).click()
  await expect(stage(dialog, 1).getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(stage(dialog, 2)).toContainText('Unavailable until the preceding stage')
  await stage(dialog, 1).getByRole('button', { name: 'Include native UA prerequisite in stage 1', exact: true }).click(); await intend(dialog, 1)
  await expect(stage(dialog, 2).getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(stage(dialog, 2)).toContainText('Choose an intended route explicitly')
  expect(await stored(page)).toBeNull()
})
test('future epoch reveals stay absent from later pickers and every displayed result', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Fixed original map')
  await boundary(dialog, 1)
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click()
  const picker = stage(dialog, 2).locator('.roadmap-picker'); await picker.locator('summary').click(); await picker.getByRole('searchbox').fill('Astral Slayer')
  await expect(picker).toContainText('No current visible matches')
  expect(await dialog.textContent()).not.toContain(node('Astral Slayer').id)
  await expect(dialog.locator(`[data-roadmap-choice="${node('Astral Slayer').id}"]`)).toHaveCount(0)
  expect(await stored(page)).toBeNull()
})
test('explicit staged item receipts remain hypothetical across full resets and never write milestones', async ({ page }) => {
  const lock = node('Limit Break'), gate = lock.reveal.kind === 'all' ? lock.reveal.requirements.find((requirement) => requirement.kind === 'milestone') : undefined
  if (!gate || gate.kind !== 'milestone') throw new Error('Expected native Limit Break receipt gate')
  const actual = { ...initial, epoch: 1, showSpoilers: true, purchases: Object.fromEntries(catalog.upgrades.filter((entry) => entry.id !== lock.id).map((entry) => [entry.id, { epoch: 1, active: true }])) }
  await seed(page, actual); await page.goto('./ascension/'); const bytes = await stored(page), dialog = await open(page)
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Assume item receipt before UA'); await add(dialog, 1, lock.title)
  await expect(stage(dialog, 1)).toContainText('Incomplete')
  await stage(dialog, 1).locator('.roadmap-items summary').click(); await stage(dialog, 1).locator(`[data-roadmap-item="${gate.id}"]`).check()
  await dialog.getByRole('checkbox', { name: 'Full Ultra Ascension after stage 1', exact: true }).check()
  await expect(stage(dialog, 1).locator('.roadmap-reset')).toContainText(lock.title)
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click(); await add(dialog, 2, lock.title); await stage(dialog, 2).getByRole('combobox').selectOption('activate')
  await stage(dialog, 2).locator('.roadmap-items summary').click()
  const receipt = stage(dialog, 2).locator(`[data-roadmap-item="${gate.id}"]`); await expect(receipt).toBeChecked(); await expect(receipt).toBeDisabled()
  await expect(stage(dialog, 2)).toContainText('Earlier hypothetical receipt:'); await expect(stage(dialog, 2).locator('[data-roadmap-step]')).toHaveCount(0)
  expect(await stored(page)).toBe(bytes)
})
test('external actual progress closes all stale outputs and clean reopening discards both sequences', async ({ page, context }) => {
  await seed(page, { ...initial, showSpoilers: true }); await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Private old sequence'); await add(dialog, 1, 'Astral Scales')
  const other = await context.newPage(); await other.goto('./ascension/'); await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(dialog).toHaveCount(0)
  const fresh = await open(page); await expect(fresh.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('')
  await expect(fresh.locator('[data-roadmap-target]')).toHaveCount(0); expect(await fresh.textContent()).not.toContain('Private old sequence')
  await other.close()
})
test('recovery replaces the roadmap with exactly one native modal and preserves the unsaved session', async ({ page, context }) => {
  await seed(page, initial)
  await page.addInitScript((key) => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic write failure'); original.call(this, name, value) } }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/'); await page.getByRole('button', { name: 'Return to start', exact: true }).click(); await page.getByRole('button', { name: 'Record purchase…', exact: true }).click(); await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  const other = await context.newPage(); await other.goto('./ascension/'); await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify({ ...profile, showSpoilers: true })), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  const dialog = await open(page); await dialog.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(page.getByRole('dialog', { name: 'Backup & transfer', exact: true })).toBeVisible(); await expect(dialog).toHaveCount(0)
  await expect(page.locator('.map-summary')).toContainText('1 /'); await other.close()
})
for (const purchaseFirst of [true, false]) test(`queued connected native purchase and roadmap openers leave one dialog (${purchaseFirst})`, async ({ page }) => {
  await page.goto('./ascension/'); await selectUpgrade(page, 'Permanent Slayer'); const expand = page.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
  const connected = await page.locator('.details').evaluate((details, purchaseFirst) => {
    const buttons = [...details.querySelectorAll<HTMLButtonElement>('button')], purchase = buttons.find((button) => button.textContent === 'Record purchase…')!, roadmap = buttons.find((button) => button.textContent === 'Plan hypothetical UAs…')!
    const first = purchaseFirst ? purchase : roadmap, second = purchaseFirst ? roadmap : purchase
    first.click(); const connected = second.isConnected; second.click(); return connected
  }, purchaseFirst)
  expect(connected).toBe(true); await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: purchaseFirst ? 'Hypothetical UA roadmap' : 'Record purchase?', exact: true })).toBeVisible()
  expect(await stored(page)).toBeNull()
})
test('a connected opener after an actual change can only open a fresh current-scope roadmap', async ({ page }) => {
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible(); const compact = page.getByRole('button', { name: 'Map options', exact: true }); await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).evaluate((dialog) => {
    const input = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!, button = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Plan hypothetical UAs…')!
    input.click(); if (!button.isConnected) throw new Error('Expected old opener still connected'); button.click()
  })
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  // React's native checkbox dispatch may refresh the connected button's handler
  // synchronously. A fresh opener is valid; an older handler must refuse it.
  const dialog = page.getByRole('dialog', { name: 'Hypothetical UA roadmap', exact: true })
  if (await dialog.count()) {
    await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('')
    await expect(dialog.locator('[data-roadmap-target]')).toHaveCount(0)
    const picker = dialog.locator('.roadmap-picker'); await picker.locator('summary').click(); await picker.getByRole('searchbox').fill('Astral Slayer')
    await expect(picker.locator(`[data-roadmap-choice="${node('Astral Slayer').id}"]`)).toHaveCount(1)
  }
  await expect.poll(async () => JSON.parse((await stored(page))!).showSpoilers).toBe(true)
})
test('opening a roadmap invalidates a held older backup read and a late picker selection', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as Window & { releaseRoadmapBackup?: () => void; roadmapBackupFinished?: boolean }, native = File.prototype.text
    File.prototype.text = async function () { if (this.name !== 'held.json') return native.call(this); await new Promise<void>((resolve) => { win.releaseRoadmapBackup = resolve }); const text = await native.call(this); win.roadmapBackupFinished = true; return text }
  })
  await page.goto('./ascension/'); await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'held.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...initial, epoch: 7 })) })
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseRoadmapBackup?: () => void }).releaseRoadmapBackup)).toBe('function')
  await page.keyboard.press('Escape'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Newer roadmap')
  await page.evaluate(() => (window as Window & { releaseRoadmapBackup?: () => void }).releaseRoadmapBackup!())
  await expect.poll(() => page.evaluate(() => (window as Window & { roadmapBackupFinished?: boolean }).roadmapBackupFinished)).toBe(true)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...initial, epoch: 8 })) })
  await expect(page.locator('dialog[open]')).toHaveCount(1); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('Newer roadmap'); expect(await stored(page)).toBeNull()
})
test('compact details preserve the native purchase Tab path while auxiliary roadmap controls stay hidden', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 }); await page.goto('./ascension/'); await page.getByRole('searchbox').fill('Permanent Slayer'); await page.getByRole('searchbox').press('Enter')
  await expect(page.locator('.details h2')).toBeFocused(); await expect(page.getByRole('button', { name: 'Plan hypothetical UAs…', exact: true })).not.toBeVisible(); await expect(page.locator('.detail-secondary')).toHaveCount(1)
  let reached = false
  for (let index = 0; index < 5; index++) { await page.keyboard.press('Tab'); if (await page.getByRole('button', { name: 'Record purchase…', exact: true }).evaluate((button) => button === document.activeElement)) { reached = true; break } }
  expect(reached).toBe(true)
})
test('same-task duplicate controls enforce two plans, four stages and one minimum stage', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('First bounded sequence')
  const connected = await dialog.getByRole('button', { name: 'Add comparison sequence', exact: true }).evaluate((element) => { const button = element as HTMLButtonElement; button.click(); const connected = button.isConnected; button.click(); return connected })
  expect(connected).toBe(true)
  await expect(dialog.getByRole('group', { name: 'Choose sequence', exact: true }).getByRole('button')).toHaveCount(2)
  await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('')
  await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Second bounded sequence')
  await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).evaluate((element) => { const button = element as HTMLButtonElement; for (let index = 0; index < 7; index++) button.click() })
  await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(4); await expect(dialog.getByRole('button', { name: 'Add purchase stage', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Remove last stage', exact: true }).evaluate((element) => { const button = element as HTMLButtonElement; for (let index = 0; index < 8; index++) button.click() })
  await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(1); await expect(dialog.getByRole('button', { name: 'Remove last stage', exact: true })).toBeDisabled()
  expect(await stored(page)).toBeNull(); expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBeNull()
})
test('a queued plan switch rejects the old active plan stage and target handlers', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('First sequence'); await add(dialog, 1, 'Permanent Quests')
  await dialog.getByRole('button', { name: 'Add comparison sequence', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Second sequence')
  const picker = stage(dialog, 1).locator('.roadmap-picker'); await picker.locator('summary').click(); await picker.getByRole('searchbox').fill('Permanent Slayer')
  const connected = await dialog.evaluate((element, id) => {
    const first = [...element.querySelectorAll<HTMLButtonElement>('[aria-label="Choose sequence"] button')].find((button) => button.textContent === 'First sequence')!
    const oldAdd = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Add purchase stage')!, oldTarget = element.querySelector<HTMLButtonElement>(`[data-roadmap-choice="${id}"]`)!
    first.click(); const connected = oldAdd.isConnected && oldTarget.isConnected; oldAdd.click(); oldTarget.click(); return connected
  }, catalog.startId)
  expect(connected).toBe(true); await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('First sequence')
  await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(1); await expect(dialog.locator('[data-roadmap-target]')).toHaveCount(1); await expect(dialog.locator(`[data-roadmap-target="${node('Permanent Quests').id}"]`)).toHaveCount(1)
  await dialog.getByRole('group', { name: 'Choose sequence', exact: true }).getByRole('button', { name: 'Second sequence', exact: true }).click()
  await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(1); await expect(dialog.locator('[data-roadmap-target]')).toHaveCount(0); expect(await stored(page)).toBeNull()
})
test('a queued removed-stage picker cannot edit the new stage at the same position', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Stage identity guard'); await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click()
  const picker = stage(dialog, 2).locator('.roadmap-picker'); await picker.locator('summary').click(); await picker.getByRole('searchbox').fill('Permanent Slayer')
  const connected = await dialog.evaluate((element, id) => {
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')], remove = buttons.find((button) => button.textContent === 'Remove last stage')!, add = buttons.find((button) => button.textContent === 'Add purchase stage')!, oldTarget = element.querySelector<HTMLButtonElement>(`[data-roadmap-stage="2"] [data-roadmap-choice="${id}"]`)!
    remove.click(); add.click(); const connected = oldTarget.isConnected; oldTarget.click(); return connected
  }, catalog.startId)
  expect(connected).toBe(true); await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(2); await expect(stage(dialog, 2).locator('[data-roadmap-target]')).toHaveCount(0); expect(await stored(page)).toBeNull()
})
test('captured old plan name and stage callbacks cannot edit their former plan after a switch', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('First protected plan')
  await dialog.getByRole('button', { name: 'Add comparison sequence', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Second protected plan')
  await dialog.getByRole('group', { name: 'Choose sequence', exact: true }).getByRole('button', { name: 'First protected plan', exact: true }).click()
  await dialog.evaluate((element) => {
    const props = (node: HTMLElement) => {
      const key = Object.keys(node).find((key) => key.startsWith('__reactProps$'))
      if (!key) throw new Error('Expected live React native-control callbacks')
      return (node as unknown as Record<string, Record<string, unknown>>)[key]
    }
    const input = element.querySelector<HTMLInputElement>('input[aria-label="Plan name"]')!, buttons = [...element.querySelectorAll<HTMLButtonElement>('button')]
    const oldName = props(input).onChange as (event: { target: { value: string } }) => void
    const oldAdd = props(buttons.find((button) => button.textContent === 'Add purchase stage')!).onClick as () => void
    buttons.find((button) => button.textContent === 'Second protected plan')!.click()
    oldName({ target: { value: 'STALE NAME MUST NOT REPLACE FIRST' } }); oldAdd()
  })
  await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('Second protected plan'); await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(1)
  await dialog.getByRole('group', { name: 'Choose sequence', exact: true }).getByRole('button', { name: 'First protected plan', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Plan name', exact: true })).toHaveValue('First protected plan'); await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(1); expect(await stored(page)).toBeNull()
})
test('a captured old boundary callback cannot reset the replacement stage at the same position', async ({ page }) => {
  await page.goto('./ascension/'); const dialog = await open(page); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Protected replacement boundary'); await dialog.getByRole('button', { name: 'Add purchase stage', exact: true }).click()
  await dialog.evaluate((element) => {
    const boundary = element.querySelector<HTMLInputElement>('[aria-label="Full Ultra Ascension after stage 2"]')!, key = Object.keys(boundary).find((key) => key.startsWith('__reactProps$'))
    if (!key) throw new Error('Expected live React boundary callback')
    const oldChange = (boundary as unknown as Record<string, { onChange: (event: { target: { checked: boolean } }) => void }>)[key].onChange
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')]
    buttons.find((button) => button.textContent === 'Remove last stage')!.click(); buttons.find((button) => button.textContent === 'Add purchase stage')!.click()
    oldChange({ target: { checked: true } })
  })
  await expect(dialog.locator('[data-roadmap-stage]')).toHaveCount(2)
  await expect(stage(dialog, 2).getByRole('checkbox', { name: 'Full Ultra Ascension after stage 2', exact: true })).not.toBeChecked()
  await expect(stage(dialog, 2).locator('.roadmap-reset')).toHaveCount(0); expect(await stored(page)).toBeNull()
})
test('roadmap choices, boundaries and comparison remain reachable with real 32px text and native Tab', async ({ baseURL }, info) => {
  const directory = info.outputPath('roadmap-font-profile'); await mkdir(join(directory, 'Default'), { recursive: true }); await writeFile(join(directory, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }))
  const context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], baseURL, viewport: { width: 320, height: 568 }, ...(info.project.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) })
  await installProfileTestHelpers(context)
  const errors: string[] = []; context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)))
  try {
    await context.addInitScript(({ key, profile }) => { if (location.origin !== 'null') { localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'); localStorage.setItem(key, JSON.stringify(profile)) } }, { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true } })
    const page = await context.newPage(); await page.goto('./ascension/'); await expect(page.locator('html')).toHaveCSS('font-size', '32px'); const dialog = await open(page)
    await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Readable sequence')
    const picker = stage(dialog, 1).locator('.roadmap-picker'); await picker.locator('summary').click(); const input = picker.getByRole('searchbox'); await input.fill('Astral Key'); const choices = picker.locator('[data-roadmap-choice]'); expect(await choices.count()).toBe(13); await input.focus()
    for (const button of await choices.all()) {
      await page.keyboard.press('Tab'); await expect(button).toBeFocused()
      expect(await button.evaluate((element) => {
        const dialog = element.closest('dialog')!, bounds = dialog.getBoundingClientRect(), heading = dialog.querySelector('.dialog-heading')!.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element.querySelector('b')!)
        return [...range.getClientRects()].every((line) => line.top >= heading.bottom && line.bottom <= bounds.bottom && line.left >= bounds.left && line.right <= bounds.right && document.elementFromPoint(line.x + line.width / 2, line.y + line.height / 2)?.closest('button') === element)
      })).toBe(true)
    }
    await page.keyboard.press('Enter'); await expect(stage(dialog, 1).locator('[data-roadmap-target]')).toHaveCount(1)
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); const mode = stage(dialog, 1).getByRole('combobox'); await mode.scrollIntoViewIfNeeded(); await expect(mode).toBeInViewport(); expect((await mode.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      const boundary = stage(dialog, 1).locator('.roadmap-boundary'); await boundary.scrollIntoViewIfNeeded(); expect((await boundary.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true); await page.screenshot({ path: info.outputPath(`roadmap-${viewport.width}-32.png`) })
    }
    await dialog.getByRole('button', { name: 'Add comparison sequence', exact: true }).click(); await dialog.getByRole('textbox', { name: 'Plan name', exact: true }).fill('Second readable sequence'); await expect(dialog.locator('[data-roadmap-summary]')).toHaveCount(2)
  } finally { await context.close(); expect(errors).toEqual([]) }
})
