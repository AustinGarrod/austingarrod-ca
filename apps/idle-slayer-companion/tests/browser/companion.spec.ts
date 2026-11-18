import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { encodeGameSaveFixture, nativeSaveFixture } from '../fixtures/game-save'
import { COMPANION_STORAGE_KEY } from '../../src/domain/companion-storage'
import type { CompanionCatalog, CompanionProgress } from '../../src/domain/companion-types'
import nativeRules from '../../data/companion-native-rules.json' with { type: 'json' }
import resetRules from '../../src/data/companion-reset-rules.json' with { type: 'json' }
import { emptyCompanionProgress } from '../../src/domain/companion-progress'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/companion-catalog.json', 'utf8')) as CompanionCatalog
const achievement = catalog.entities.find((entity) => entity.system === 'achievement')!
const recipe = catalog.entities.find((entity) => entity.system === 'craft' && entity.permanent && entity.recipe?.length)!
const material = nativeRules.imports.find((rule) => rule.kind === 'material')!
const progress = (page: Page): Promise<CompanionProgress | null> => page.evaluate((key) => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).progress : null }, COMPANION_STORAGE_KEY)
async function navigate(page: Page, name: string) {
  const navigation = page.getByRole('navigation', { name: 'Companion sections' })
  if (!await navigation.isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await navigation.getByRole('button', { name, exact: true }).click()
}
const card = (page: Page, system: string, id: string) => page.locator(`[id="companion-entity-${system}-${id}"]`)

test('opens a real overview, records an achievement, and keeps a shared goal through navigation', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  await navigate(page, 'Achievements')
  await expect(page.getByRole('heading', { name: achievement.title, exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('searchbox', { name: 'Search visible achievements' }).fill(achievement.title)
  const entry = card(page, 'achievement', achievement.id)
  await entry.getByRole('combobox', { name: 'Achievement', exact: true }).selectOption('yes')
  await expect.poll(async () => (await progress(page))?.modules.achievement.records[achievement.id]?.completed).toBe(true)
  await entry.getByRole('button', { name: `Pin ${achievement.title} as a goal`, exact: true }).click()
  await navigate(page, 'Overview')
  await expect(page.getByText(achievement.title, { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText(achievement.title, { exact: true })).toBeVisible()
})

test('craft observations share ownership while planning never spends material stock', async ({ page }) => {
  await page.goto('./crafting/')
  await page.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('searchbox', { name: 'Search visible crafting & materials' }).fill(recipe.title)
  const entry = card(page, 'craft', recipe.id)
  await entry.getByRole('combobox', { name: 'Item ownership', exact: true }).selectOption('yes')
  await expect.poll(async () => (await progress(page))?.ascension.milestones[recipe.id]).toBe(true)
  const before = (await progress(page))!.modules.material
  await entry.getByRole('textbox', { name: `Planned quantity for ${recipe.title}` }).fill('2')
  await entry.getByRole('button', { name: 'Update plan', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Shopping list', exact: true })).toBeVisible()
  expect((await progress(page))!.modules.material).toEqual(before)
  await page.reload()
  await page.getByRole('searchbox', { name: 'Search visible crafting & materials' }).fill(recipe.title)
  await expect(card(page, 'craft', recipe.id).getByRole('textbox', { name: `Planned quantity for ${recipe.title}` })).toHaveValue('2')
})

test('removing a shared craft previews dependent Ascension corrections and applies them with one Undo', async ({ page }) => {
  const map = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
  const armory = catalog.entities.find((entity) => entity.system === 'craft' && entity.title === 'Armory')!
  const initial = emptyCompanionProgress(map.revision)
  initial.ascension.epoch = 2
  initial.ascension.showSpoilers = true
  initial.ascension.milestones = Object.fromEntries(map.milestones.map((entry) => [entry.id, true]))
  initial.ascension.purchases = Object.fromEntries(map.upgrades.map((upgrade) => [upgrade.id, { epoch: upgrade.activation === 'after-ultra-ascension' ? 1 : 2, active: true }]))
  initial.modules.material = { tracked: true, records: { [material.id]: { discovered: true, count: '12345' } } }
  initial.modules.achievement = { tracked: true, records: { [achievement.id]: { completed: true } } }
  const dependent = map.upgrades.filter((entry) => ['Chest In a Chest', "Mimic's Corpse", 'Multiplier Manifest', 'Great Loot'].includes(entry.title))
  expect(dependent).toHaveLength(4)
  await page.addInitScript(({ key, initial }) => localStorage.setItem(key, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: initial })), { key: COMPANION_STORAGE_KEY, initial })
  await page.goto('./crafting/')
  await page.getByRole('searchbox', { name: 'Search visible crafting & materials' }).fill(armory.title)
  await card(page, 'craft', armory.id).getByRole('combobox', { name: 'Item ownership', exact: true }).selectOption('no')
  const dialog = page.getByRole('dialog', { name: 'Review shared item correction', exact: true })
  await expect(dialog.getByRole('heading', { name: 'Apply this correction?', exact: true })).toBeVisible()
  for (const entry of dependent) await expect(dialog).toContainText(entry.title)
  expect(await progress(page)).toEqual(initial)
  await dialog.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await progress(page)).toEqual(initial)
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await card(page, 'craft', armory.id).getByRole('combobox', { name: 'Item ownership', exact: true }).selectOption('no')
  await dialog.getByRole('button', { name: 'Apply correction', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.milestones[armory.id]).toBeUndefined()
  const corrected = (await progress(page))!
  for (const entry of dependent) expect(corrected.ascension.purchases[entry.id]).toBeUndefined()
  expect(Object.keys(corrected.ascension.purchases)).toHaveLength(map.upgrades.length - dependent.length)
  expect(corrected.modules.craft.records[armory.id]).toEqual({ completed: false })
  expect(corrected.modules.material).toEqual(initial.modules.material)
  expect(corrected.modules.achievement).toEqual(initial.modules.achievement)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => progress(page)).toEqual(initial)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.milestones[armory.id]).toBeUndefined()
})

test('full save import previews privately and applies every supported system with one Undo', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Import save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Import game save', exact: true })
  const buffer = encodeGameSaveFixture(nativeSaveFixture({ version: '7.3.4', epoch: '3', integers: { [achievement.id]: 1 }, strings: { [material.key]: '12345678901234567890', 'unrelated-private-preference': 'synthetic-secret' } }))
  await dialog.getByLabel('Choose game save').setInputFiles({ name: 'synthetic.sav', mimeType: 'application/octet-stream', buffer: Buffer.from(buffer) })
  await expect(dialog.getByRole('heading', { name: 'Apply this snapshot?', exact: true })).toBeVisible()
  await expect(dialog.getByText(achievement.title, { exact: true })).toHaveCount(0)
  expect(await progress(page)).toBeNull()
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.modules.achievement.records[achievement.id]?.completed).toBe(true)
  const imported = (await progress(page))!
  expect(imported.ascension.epoch).toBe(3)
  expect(imported.modules.material.records[material.id]).toEqual({ discovered: true, count: '12345678901234567890' })
  expect(Object.values(imported.modules).every((module) => module.tracked)).toBe(true)
  expect(JSON.stringify(imported)).not.toContain('synthetic-secret')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(0)
  expect(Object.values((await progress(page))!.modules).every((module) => !module.tracked)).toBe(true)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(3)
})

test('an unrelated catalog failure does not disable achievements or progress export', async ({ page }) => {
  await page.route('**/catalog.json', (route) => route.abort())
  await page.goto('./achievements/')
  await expect(page.getByRole('heading', { name: 'Achievements', exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Show spoilers', exact: true }).check()
  await page.getByRole('searchbox', { name: 'Search visible achievements' }).fill(achievement.title)
  await card(page, 'achievement', achievement.id).getByRole('combobox', { name: 'Achievement', exact: true }).selectOption('yes')
  await expect.poll(async () => (await progress(page))?.modules.achievement.records[achievement.id]?.completed).toBe(true)
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Companion progress', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/^idle-slayer-companion-/)
})

test('mobile navigation traps focus and all section controls stay within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto('./')
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Your companion', exact: true })
  await expect(drawer).toBeVisible()
  for (let index = 0; index < 14; index++) await page.keyboard.press('Tab')
  expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
  await navigate(page, 'Crafting & materials')
  await expect(page.getByRole('heading', { name: 'Crafting & materials', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('actual Ultra Ascension previews and resets the real quest-pack catalog with atomic Undo', async ({ page }) => {
  const map = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
  const initial = emptyCompanionProgress(map.revision)
  if (map.ultraAscension.kind !== 'active') throw new Error('Reviewed native gate changed')
  initial.ascension.purchases[map.ultraAscension.id] = { epoch: 0, active: true }
  const pack = catalog.entities.find((entity) => entity.system === 'quest' && entity.category === 'Quest packs' && resetRules.upgrades.some((rule) => rule.id === entity.id && !rule.retain))!
  const quest = resetRules.quests.find((rule) => rule.retain === 'never' && catalog.entities.some((entity) => entity.system === 'quest' && entity.id === rule.id))!
  initial.modules.quest = { tracked: true, records: { [pack.id]: { completed: true }, [quest.id]: { claimed: true, count: '12' } } }
  const stored = JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: null, progress: initial })
  await page.addInitScript(({ key, stored }) => localStorage.setItem(key, stored), { key: COMPANION_STORAGE_KEY, stored })
  await page.goto('./')
  await page.getByRole('button', { name: 'Record Ultra Ascension…', exact: true }).click()
  const preview = page.getByRole('dialog', { name: 'Review companion Ultra Ascension', exact: true })
  await expect(preview.getByRole('heading', { name: 'Apply this Ultra Ascension?', exact: true })).toBeVisible()
  expect(await progress(page)).toEqual(initial)
  await preview.getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(1)
  expect((await progress(page))!.modules.quest.records[pack.id].completed).toBe(false)
  expect((await progress(page))!.modules.quest.records[quest.id]).toMatchObject({ claimed: false, count: '0' })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => progress(page)).toEqual(initial)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(async () => (await progress(page))?.ascension.epoch).toBe(1)
})

test('closing an intentions read and rejecting a later file cannot revive the abandoned preview', async ({ page }) => {
  await page.goto('./')
  await page.evaluate(() => {
    const win = window as Window & { releaseIntentionsRead?: () => Promise<void> }
    const native = File.prototype.text
    let first = true
    File.prototype.text = function () {
      if (!first) return native.call(this)
      first = false
      return new Promise<string>((resolve) => { win.releaseIntentionsRead = async () => resolve(await native.call(this)) })
    }
  })
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  const workspace = { format: 'idle-slayer-companion-workspace', version: 1, goals: [], recipePlans: { 'synthetic-recipe': '2' } }
  await dialog.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'first.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(workspace)) })
  await expect(dialog.getByText('Reading and validating locally…', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('button', { name: /^(Backup & transfer|Backup)$/ }).click()
  await dialog.getByLabel('Restore intentions', { exact: true }).setInputFiles({ name: 'oversize.json', mimeType: 'application/json', buffer: Buffer.alloc(65537, 32) })
  await expect(dialog.getByText('The intentions file exceeds its size limit.', { exact: true })).toBeVisible()
  await page.evaluate(async () => { await (window as Window & { releaseIntentionsRead?: () => Promise<void> }).releaseIntentionsRead?.() })
  await expect(dialog.getByRole('region', { name: 'Review intentions restore', exact: true })).toHaveCount(0)
  await expect(dialog.getByText('The intentions file exceeds its size limit.', { exact: true })).toBeVisible()
})

test('changed legacy tab progress can be exported before acknowledging the Companion copy', async ({ page, context }) => {
  const map = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
  const legacy = emptyProfile(map.revision), initial = emptyCompanionProgress(map.revision)
  initial.modules.achievement = { tracked: true, records: { [achievement.id]: { completed: true } } }
  const baseline = JSON.stringify(legacy)
  await page.addInitScript(({ key, old, initial, baseline }) => {
    if (!localStorage.getItem(key)) { localStorage.setItem(old, baseline); localStorage.setItem(key, JSON.stringify({ format: 'idle-slayer-companion-storage', version: 1, legacyBaseline: baseline, progress: initial })) }
  }, { key: COMPANION_STORAGE_KEY, old: PROFILE_STORAGE_KEY, initial, baseline })
  await page.goto('./')
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  const changed = { ...legacy, purchases: { [map.startId]: { epoch: 0, active: true } }, milestones: { 'future-legacy-item': true } }
  const other = await context.newPage()
  await other.goto('./')
  await other.evaluate(({ key, changed }) => localStorage.setItem(key, JSON.stringify(changed)), { key: PROFILE_STORAGE_KEY, changed })
  await page.getByRole('button', { name: 'Review recovery', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Backup & transfer', exact: true })
  await expect(dialog).toContainText('The older map tab’s changes are not included in this Companion snapshot.')
  const pending = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export changed legacy map copy', exact: true }).click()
  const path = await (await pending).path()
  expect(JSON.parse(readFileSync(path!, 'utf8'))).toEqual(changed)
  expect(await progress(page)).toEqual(initial)
  await dialog.getByRole('button', { name: 'Use checked saved progress', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply snapshot', exact: true }).click()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).legacyBaseline, COMPANION_STORAGE_KEY)).toBe(JSON.stringify(changed))
  await other.close()
  await page.reload()
  await expect(page.getByRole('main', { name: 'Overview', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review recovery', exact: true })).toHaveCount(0)
  expect(await progress(page)).toEqual(initial)
})
