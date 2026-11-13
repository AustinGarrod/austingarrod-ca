import { installProfileTestHelpers } from './fixtures'
import { test, expect } from './fixtures'
import { chromium, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openProgress, purchaseStart, selectUpgrade } from './helpers/app'
import { seedProfile, denyProfileWrites } from './helpers/profile'
import type { Catalog, Profile } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { CHECKPOINT_STORAGE_KEY, emptyCheckpoints, exportCheckpoints, type CheckpointVault } from '../../src/domain/checkpoints'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
import { planUltraAscension, visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const id = (title: string) => catalog.upgrades.find((node) => node.title === title)!.id
const land = catalog.upgrades.find((node) => /land.?lord/i.test(node.title))!
const resetBefore: Profile = { ...initial, epoch: 1, showSpoilers: true, purchases: { [id('Ultra Ascension')]: { epoch: 1, active: true }, [id('Permanent Slayer')]: { epoch: 1, active: true }, [land.id]: { epoch: 1, active: false }, [id('Village Key')]: { epoch: 1, active: true } } }
const entry = (key: string, name: string, profile: Profile) => ({ id: key, name, capturedRevision: profile.catalogRevision, profile })
const vault = (...entries: CheckpointVault['entries']) => ({ ...emptyCheckpoints(), entries })

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
  await context.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})
async function seedVault(page: Page, value: CheckpointVault) {
  await page.addInitScript(({ key, value }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value)) }, { key: CHECKPOINT_STORAGE_KEY, value })
}
async function open(page: Page) {
  const progress = await openProgress(page)
  await progress.getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Progress checkpoints', exact: true })
  await expect(dialog).toBeVisible(); return dialog
}
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), CHECKPOINT_STORAGE_KEY)
const progress = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)
async function capture(page: Page, name: string) {
  await page.getByLabel('Name current checkpoint', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Capture current progress', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Checkpoint storage and actions' })).toContainText('Checkpoints saved on this device.')
}

test('deliberate named snapshots persist across reload without creating progress or undo edits', async ({ page }) => {
  await page.goto('./ascension/'); let dialog = await open(page)
  const before = await progress(page)
  await expect(dialog.getByRole('button', { name: 'Capture current progress', exact: true })).toBeDisabled()
  await capture(page, 'Before my reset')
  const reference = await stored(page)
  expect(await progress(page)).toBe(before)
  await page.reload(); dialog = await open(page)
  await expect(dialog.locator('.checkpoint-list')).toContainText('Before my reset')
  expect(await stored(page)).toBe(reference); expect(await progress(page)).toBe(before)
  await expect(dialog).not.toContainText('Undo is available after replacement')
  await expect(dialog.getByRole('button', { name: /Apply progress|Apply changes/ })).toHaveCount(0)
})

test('current progression intentions and checkpoint references keep independent state and modal routes', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/')
  await selectUpgrade(page, catalog.upgrades.find((node) => node.id === catalog.startId)!.title)
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('button', { name: 'Set progression goal…', exact: true }).click()
  const progressDialog = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await progressDialog.getByRole('combobox', { name: 'Goal completion', exact: true }).selectOption('rebuild')
  await progressDialog.getByRole('button', { name: 'Save goal', exact: true }).click()
  const goals = await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY), before = await progress(page)
  await progressDialog.getByRole('button', { name: 'Progress checkpoints…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Progress checkpoints', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await capture(page, 'Recorded state before goal edit')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBe(goals)
  const references = await stored(page)
  expect(JSON.parse(references!).entries[0].profile).toEqual(initial)
  await page.keyboard.press('Escape')
  const returned = await openProgress(page)
  await returned.getByRole('combobox', { name: 'Goal completion', exact: true }).selectOption('acquire')
  await returned.getByRole('button', { name: 'Save goal', exact: true }).click()
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).not.toBe(goals)
  expect(await stored(page)).toBe(references); expect(await progress(page)).toBe(before)
})

test('four references require explicit deletion; renaming and cancelling deletion leave progress intact', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/'); const dialog = await open(page), before = await progress(page)
  for (let i = 1; i <= 4; i++) await capture(page, `Checkpoint ${i}`)
  await page.getByLabel('Name current checkpoint', { exact: true }).fill('Fifth')
  await expect(dialog.getByRole('button', { name: 'Capture current progress', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Rename checkpoint 2…', exact: true }).click()
  await dialog.getByLabel('New checkpoint name', { exact: true }).fill('Renamed reference')
  await dialog.getByRole('button', { name: 'Save checkpoint name', exact: true }).click()
  await expect(dialog.locator('.checkpoint-list')).toContainText('Renamed reference')
  await dialog.getByRole('button', { name: 'Delete checkpoint 1…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Cancel deletion', exact: true }).click()
  await expect(dialog.locator('.checkpoint-list > li')).toHaveCount(4)
  await dialog.getByRole('button', { name: 'Delete checkpoint 1…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete checkpoint', exact: true }).click()
  await expect(dialog.locator('.checkpoint-list > li')).toHaveCount(3)
  await capture(page, 'New fourth')
  expect(await progress(page)).toBe(before)
})

test('a recorded native reset explains cleared repeat purchases and lasting activation, then reload loses operation proof only', async ({ page }) => {
  await seedProfile(page, resetBefore, true); await page.goto('./ascension/'); let dialog = await open(page)
  await capture(page, 'Before UA')
  await page.keyboard.press('Escape')
  await (await openProgress(page)).getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
  await page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true }).getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
  dialog = await open(page)
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).toContainText('uniquely match recorded operations')
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).toContainText('Matched native reset context cleared')
  await expect(dialog.getByRole('region', { name: 'Progress differences', exact: true })).toContainText(land.title)
  await expect(dialog.getByRole('region', { name: 'Progress differences', exact: true })).toContainText('Owned · awaiting activation → Owned and active')
  await capture(page, 'After UA')
  await dialog.getByRole('group', { name: 'First reference', exact: true }).getByRole('radio', { name: 'Before UA · checkpoint 1', exact: true }).check()
  await dialog.getByRole('group', { name: 'Second reference', exact: true }).getByRole('radio', { name: 'After UA · checkpoint 2', exact: true }).check()
  const beforeReload = await progress(page), references = await stored(page)
  await page.reload(); dialog = await open(page)
  await dialog.getByRole('group', { name: 'Second reference', exact: true }).getByRole('radio', { name: 'After UA · checkpoint 2', exact: true }).check()
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).toContainText('No unique verified operation path')
  expect(await progress(page)).toBe(beforeReload); expect(await stored(page)).toBe(references)
})

test('prior ascension history is a known app edit and never a claimed reset', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/'); let dialog = await open(page)
  await capture(page, 'Before history entry'); await page.keyboard.press('Escape')
  const current = await openProgress(page)
  await current.locator('.prior-ascensions input').fill('1')
  await current.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('button', { name: 'Record history', exact: true }).click()
  await page.keyboard.press('Escape')
  dialog = await open(page)
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).toContainText('Previous ascension history')
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).not.toContainText('Matched native reset context')
})

test('read-only references preserve and explain the actual undo and redo chain', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/'); let dialog = await open(page)
  await capture(page, 'Before purchase'); await page.keyboard.press('Escape')
  await purchaseStart(page)
  dialog = await open(page); await capture(page, 'After purchase'); await page.keyboard.press('Escape')
  await (await openProgress(page)).getByRole('group', { name: 'Session history' }).getByRole('button', { name: 'Undo', exact: true }).click()
  await page.keyboard.press('Escape'); dialog = await open(page)
  await dialog.getByRole('group', { name: 'First reference' }).getByRole('radio', { name: 'After purchase · checkpoint 2', exact: true }).check()
  await expect(dialog.getByRole('region', { name: 'Operation context' })).toContainText('reverses their chronological direction')
  await expect(dialog.getByRole('region', { name: 'Operation context' })).toContainText('Purchase')
  const references = await stored(page), undone = await progress(page)
  await page.keyboard.press('Escape')
  const progressDialog = await openProgress(page)
  await expect(progressDialog.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await progressDialog.getByRole('button', { name: 'Redo', exact: true }).click()
  expect(await progress(page)).not.toBe(undone)
  expect(await stored(page)).toBe(references)
})

test('older spoilers and unknown records cannot widen identity lists or fabricate denominator losses', async ({ page }) => {
  const visible = visibility(catalog, initial), hidden = catalog.upgrades.find((node) => !visible.ids.has(node.id))!
  const old = { ...initial, showSpoilers: true, purchases: { [hidden.id]: { epoch: 0, active: true }, 'SENTINEL-unknown-checkpoint': { epoch: 0, active: true } }, milestones: { 'SENTINEL-unknown-milestone': true as const } }
  await seedProfile(page, initial, true); await seedVault(page, vault(entry('old', 'Earlier reference', old))); await page.goto('./ascension/')
  const dialog = await open(page)
  await expect(dialog).not.toContainText(hidden.title); await expect(dialog).not.toContainText(hidden.id)
  await expect(dialog).not.toContainText('SENTINEL-unknown')
  await expect(dialog).toContainText(`same ${visible.total} currently visible upgrades`)
  await expect(dialog).toContainText('view/catalog change, not an achievement or loss')
  const event = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Export checkpoints', exact: true }).click()
  const exported = JSON.parse(readFileSync((await (await event).path())!, 'utf8')) as CheckpointVault
  expect(exported.entries[0].profile.purchases['SENTINEL-unknown-checkpoint']).toBeDefined()
})

test('hidden-only changes expose neither a difference nor a presence-dependent operation explanation', async ({ page }) => {
  const node = catalog.upgrades.find((candidate) => !visibility(catalog, { ...initial, purchases: { [candidate.id]: { epoch: 0, active: true } } }).ids.has(candidate.id))!
  const current = { ...initial, purchases: { [node.id]: { epoch: 0, active: true } } }
  await seedProfile(page, current, true); await seedVault(page, vault(entry('before', 'Before', initial))); await page.goto('./ascension/')
  const dialog = await open(page)
  await expect(dialog).not.toContainText(node.title)
  await expect(dialog.getByRole('region', { name: 'Operation context', exact: true })).toHaveText(/No differences in the currently visible recorded state/)
})

test('portable restore is separate and confirmed, preserves unknown facts, and rejects injected operation claims', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/'); const dialog = await open(page), before = await progress(page)
  await capture(page, 'Existing reference')
  const restored = vault(entry('portable', 'Portable private name', { ...initial, purchases: { 'unknown-retained': { epoch: 0, active: false } } }))
  const file = dialog.getByLabel('Progress checkpoints JSON backup', { exact: true })
  await file.setInputFiles({ name: 'active-profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(initial)) })
  await expect(dialog).toContainText('not a supported checkpoint collection')
  await file.setInputFiles({ name: 'claims.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...restored, operations: ['ultra_ascension'] })) })
  await expect(dialog).toContainText('not a supported checkpoint collection')
  await file.setInputFiles({ name: 'references.json', mimeType: 'application/json', buffer: Buffer.from(exportCheckpoints(restored, catalog.revision)!) })
  await expect(dialog.getByRole('region', { name: 'Review checkpoint restore' })).toContainText('Portable private name')
  expect(JSON.parse((await stored(page))!).entries[0].name).toBe('Existing reference')
  await dialog.getByRole('button', { name: 'Cancel checkpoint restore', exact: true }).click()
  await file.setInputFiles({ name: 'references.json', mimeType: 'application/json', buffer: Buffer.from(exportCheckpoints(restored, catalog.revision)!) })
  await dialog.getByRole('button', { name: 'Replace checkpoint collection', exact: true }).click()
  await expect.poll(() => stored(page)).toBe(exportCheckpoints(restored, catalog.revision))
  expect(await progress(page)).toBe(before)
})

test('clean external adoption cancels stale edits and later capture preserves the newly adopted list', async ({ page, context }) => {
  await seedProfile(page, initial, true); await seedVault(page, vault(entry('one', 'Original name', initial))); await page.goto('./ascension/')
  const dialog = await open(page)
  await dialog.getByRole('button', { name: 'Rename checkpoint 1…', exact: true }).click()
  await dialog.getByLabel('New checkpoint name', { exact: true }).fill('Stale draft')
  const other = await context.newPage(); await other.goto('./ascension/')
  const newer = vault(entry('one', 'Adopted new name', initial), entry('two', 'Another saved reference', initial))
  await other.evaluate(({ key, text }) => window.__writeExternalMapProfileText(key, text), { key: CHECKPOINT_STORAGE_KEY, text: exportCheckpoints(newer, catalog.revision)! })
  await expect(dialog.locator('.checkpoint-list')).toContainText('Adopted new name')
  await expect(dialog.getByRole('button', { name: 'Save checkpoint name' })).toHaveCount(0)
  await capture(page, 'Fresh third')
  expect(JSON.parse((await stored(page))!).entries.map((entry: { name: string }) => entry.name)).toEqual(['Adopted new name', 'Another saved reference', 'Fresh third'])
  await other.close()
})

test('dirty external changes keep exportable local snapshots and require checked recovery', async ({ page, context }) => {
  await seedProfile(page, initial, true)
  await page.addInitScript((key) => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('SENTINEL-private-checkpoint-error'); return original.call(this, name, value) } }, CHECKPOINT_STORAGE_KEY)
  await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.getByLabel('Name current checkpoint', { exact: true }).fill('Local memory')
  await dialog.getByRole('button', { name: 'Capture current progress', exact: true }).click()
  await expect(dialog).toContainText('Saving failed'); await expect(dialog).not.toContainText('SENTINEL-private-checkpoint-error')
  const other = await context.newPage(); await other.goto('./ascension/')
  const newer = vault(entry('saved', 'Checked saved collection', initial))
  await other.evaluate(({ key, text }) => window.__writeExternalMapProfileText(key, text), { key: CHECKPOINT_STORAGE_KEY, text: exportCheckpoints(newer, catalog.revision)! })
  await expect(dialog).toContainText('This local collection was kept')
  await expect(dialog.locator('.checkpoint-list')).toContainText('Local memory')
  await dialog.getByRole('button', { name: 'Use saved checkpoints…', exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Review checkpoint recovery' })).toContainText('Checked saved collection')
  await dialog.getByRole('button', { name: 'Confirm checkpoint recovery', exact: true }).click()
  await expect(dialog.locator('.checkpoint-list')).toContainText('Checked saved collection')
  await other.close()
})

test('a held checkpoint lock keeps a usable snapshot and retries without changing active progress', async ({ page }) => {
  await seedProfile(page, initial, true); await page.goto('./ascension/'); const dialog = await open(page)
  const before = await progress(page)
  await page.evaluate(async (key) => {
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    void navigator.locks.request(`${key}.write`, async () => {
      entered()
      await new Promise<void>((resolve) => Object.assign(window, { releaseCheckpointLock: resolve }))
    })
    await ready
  }, CHECKPOINT_STORAGE_KEY)
  await dialog.getByLabel('Name current checkpoint', { exact: true }).fill('Busy but retained')
  await dialog.getByRole('button', { name: 'Capture current progress', exact: true }).click()
  await expect(dialog).toContainText('Saving failed or another tab is busy')
  await expect(dialog.locator('.checkpoint-list')).toContainText('Busy but retained')
  expect(await stored(page)).toBeNull(); expect(await progress(page)).toBe(before)
  await page.evaluate(() => (window as unknown as { releaseCheckpointLock: () => void }).releaseCheckpointLock())
  await dialog.getByRole('button', { name: 'Retry checkpoint saving', exact: true }).click()
  await expect(dialog.getByRole('status', { name: 'Checkpoint storage and actions' })).toContainText('saved on this device')
  expect(JSON.parse((await stored(page))!).entries[0].name).toBe('Busy but retained')
  expect(await progress(page)).toBe(before)
})

test('late reads and corrupt storage do not reopen stale references or silently replace data', async ({ page }) => {
  await seedProfile(page, initial, true)
  await page.addInitScript((key) => { localStorage.setItem(key, 'SENTINEL-corrupt-checkpoints'); const original = File.prototype.text; File.prototype.text = function () { const file = this; return new Promise((resolve) => setTimeout(() => { void original.call(file).then(resolve) }, 300)) } }, CHECKPOINT_STORAGE_KEY)
  await page.goto('./ascension/'); let dialog = await open(page)
  await dialog.getByRole('button', { name: 'Refresh checkpoint recovery', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Replace saved checkpoints…', exact: true })).toBeVisible()
  await dialog.getByLabel('Progress checkpoints JSON backup', { exact: true }).setInputFiles({ name: 'references.json', mimeType: 'application/json', buffer: Buffer.from(exportCheckpoints(vault(entry('late', 'Late name', initial)), catalog.revision)!) })
  await page.keyboard.press('Escape'); dialog = await open(page)
  await page.waitForTimeout(400)
  await expect(dialog.getByRole('region', { name: 'Review checkpoint restore' })).toHaveCount(0)
  expect(await stored(page)).toBe('SENTINEL-corrupt-checkpoints')
  await dialog.getByRole('button', { name: 'Replace saved checkpoints…', exact: true }).click()
  await dialog.getByRole('button', { name: 'Confirm checkpoint recovery', exact: true }).click()
  await expect.poll(() => stored(page)).toBe(exportCheckpoints(emptyCheckpoints(), catalog.revision))
})

test('profile recovery remains one correctly named modal and does not edit checkpoints', async ({ page, context }) => {
  await seedProfile(page, initial, true); await denyProfileWrites(page); await seedVault(page, vault(entry('one', 'Reference', initial)))
  await page.goto('./ascension/'); await purchaseStart(page)
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  const references = await stored(page), dialog = await open(page)
  const other = await context.newPage(); await other.goto('./ascension/')
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...initial, showSpoilers: true } })
  await dialog.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Backup & transfer', exact: true })).toBeVisible()
  expect(await stored(page)).toBe(references)
  await other.close()
})

test('ordinary phone references remain readable and keyboard actions retain touch targets', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await seedProfile(page, initial, true); await seedVault(page, vault(entry('one', 'X'.repeat(64), initial), entry('two', 'Another reference', initial)))
  await page.goto('./ascension/'); const dialog = await open(page)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  for (const button of await dialog.locator('.checkpoint-tools button').all()) {
    await button.focus(); await expect(button).toBeFocused(); expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true)
  }
  await page.screenshot({ path: info.outputPath('checkpoints-320.png') })
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
})

test('actual 32px text preserves long names, references and read-only differences in portrait and landscape', async ({ baseURL }, info) => {
  // Windows can spend several seconds closing a persistent font-profile browser
  // while other local scenarios run. Keep assertion timeouts unchanged.
  test.setTimeout(60_000)
  const directory = info.outputPath('checkpoint-font-profile')
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
    await seedProfile(page, resetBefore, true); await seedVault(page, vault(entry('one', 'X'.repeat(64), initial), entry('two', 'After reset reference', planUltraAscension(catalog, resetBefore)!.profile)))
    await page.goto('./ascension/'); await expect(page.locator('html')).toHaveCSS('font-size', '32px')
    const dialog = await open(page)
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const radio = dialog.getByRole('group', { name: 'Second reference', exact: true }).getByRole('radio', { name: 'After reset reference · checkpoint 2', exact: true })
      await radio.focus(); await expect(radio).toBeFocused(); await radio.check()
      const button = dialog.getByRole('button', { name: 'Delete checkpoint 2…', exact: true })
      await button.focus(); await expect(button).toBeFocused(); await expect(button).toBeInViewport()
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true)
      await page.screenshot({ path: info.outputPath(`checkpoints-32-${viewport.width}.png`) })
    }
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
  } finally { await context.close(); expect(errors, 'Unhandled errors in strict font context').toEqual([]) }
})
