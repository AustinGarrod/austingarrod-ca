import { installProfileTestHelpers } from './fixtures'
import { expect, test } from './fixtures'
import { chromium, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { GOALS_STORAGE_KEY } from '../../src/domain/goals'
const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const node = (title: string) => catalog.upgrades.find((upgrade) => upgrade.title === title)!
const initial = emptyProfile(catalog.revision)
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})
async function seed(page: Page, profile: Profile) { await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile }) }
async function open(page: Page) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const compact = page.getByRole('button', { name: 'Map options', exact: true })
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await page.getByRole('dialog', { name: 'Map options', exact: true }).getByRole('button', { name: 'Compare prerequisite routes…', exact: true }).click()
  return page.getByRole('dialog', { name: 'Prerequisite routes', exact: true })
}
async function add(page: Page, title: string) {
  const picker = page.locator('.route-picker')
  if (!await picker.evaluate((element) => (element as HTMLDetailsElement).open)) await picker.locator('summary').click()
  await picker.getByRole('searchbox').fill(title)
  await picker.locator(`[data-route-choice="${node(title).id}"]`).click()
}
const stored = (page: Page) => page.evaluate((key) => window.__readMapProfileText(key), PROFILE_STORAGE_KEY)

test('four complete Legendary Belt alternatives and intended OR choice never change progress or its history', async ({ page }) => {
  await page.goto('./ascension/'); const url = page.url(), dialog = await open(page)
  await add(page, 'Legendary Belt')
  await expect(dialog.locator('.route-card')).toHaveCount(4)
  expect((await dialog.locator('.route-card').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-route-cost')))).sort()).toEqual(['1006', '436', '641', '651'])
  expect((await dialog.locator('.route-total [data-exact-cost]').evaluateAll((costs) => costs.map((cost) => cost.getAttribute('data-exact-cost')))).sort()).toEqual(['1006', '436', '641', '651'])
  await expect(dialog).toContainText('Pink Ore'); await expect(dialog).toContainText('Purple Ore')
  await dialog.getByRole('radio').nth(1).check()
  await expect(dialog.getByRole('status', { name: 'Route comparison state', exact: true })).toContainText('intended route is selected for reference only')
  expect(await stored(page)).toBeNull(); expect(page.url()).toBe(url)
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBeNull()
  await page.keyboard.press('Escape')
  const compact = page.getByRole('button', { name: 'Map options', exact: true })
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: 'Map view…', exact: true })).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
test('shared target purchases count once and saved goal completion modes are copied without edits', async ({ page }) => {
  const goals = { version: 1, targets: [{ id: node('Permanent Quests').id, mode: 'acquire' }, { id: node('Soul Reaper').id, mode: 'activate' }] }
  const bytes = JSON.stringify(goals)
  await page.addInitScript(({ key, bytes }) => localStorage.setItem(key, bytes), { key: GOALS_STORAGE_KEY, bytes })
  await page.goto('./ascension/'); const dialog = await open(page)
  await dialog.locator('.route-goals summary').click()
  await dialog.locator(`[data-route-goal="${node('Permanent Quests').id}"]`).click()
  await dialog.locator(`[data-route-goal="${node('Soul Reaper').id}"]`).click()
  await expect(dialog.locator('.route-card')).toHaveCount(1)
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', '14')
  await expect(dialog.locator('.route-steps li')).toHaveCount(4)
  await expect(dialog).toContainText('Shared purchase subtotal: 6 SP')
  await expect(dialog).toContainText('Permanent Quests: target-specific shown additions 3 SP')
  await expect(dialog).toContainText('Soul Reaper: target-specific shown additions 5 SP')
  await expect(dialog.getByRole('combobox', { name: `Completion for Soul Reaper ${node('Soul Reaper').id}`, exact: true })).toHaveValue('activate')
  expect(await page.evaluate((key) => window.__readMapProfileText(key), GOALS_STORAGE_KEY)).toBe(bytes)
  expect(await stored(page)).toBeNull()
})
test('pending Astral ownership can finish acquisition but cannot satisfy activation or be repurchased', async ({ page }) => {
  const lock = node('Limit Break')
  const profile = { ...initial, epoch: 1, showSpoilers: true, purchases: { [lock.id]: { epoch: 1, active: false } } }
  await seed(page, profile); await page.goto('./ascension/'); const dialog = await open(page)
  await add(page, lock.title)
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', '0')
  await dialog.getByRole('combobox', { name: `Completion for ${lock.title} ${lock.id}`, exact: true }).selectOption('activate')
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', 'incomplete')
  await expect(dialog).toContainText('already owned but inactive')
  await expect(dialog.locator(`[data-route-step="${lock.id}"]`)).toHaveCount(0)
  expect(await stored(page)).toBe(JSON.stringify(profile))
})
test('combined long catalog totals use shared exact compact notation with full accessible digits', async ({ page }) => {
  const chosen = [node('Random Shine'), node('Collateral')]
  const profile = { ...initial, epoch: 2, showSpoilers: true, purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => !chosen.some((target) => target.id === upgrade.id)).map((upgrade) => [upgrade.id, { epoch: 2, active: true }])), milestones: Object.fromEntries(catalog.milestones.map((item) => [item.id, true as const])) }
  const total = chosen.reduce((sum, upgrade) => sum + BigInt(upgrade.cost), 0n).toString()
  await page.setViewportSize({ width: 320, height: 568 })
  await seed(page, profile); await page.goto('./ascension/'); const dialog = await open(page)
  for (const upgrade of chosen) await add(page, upgrade.title)
  await expect(dialog.locator('.route-card')).toHaveCount(1)
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', total)
  const exact = dialog.locator('.route-total').getByRole('math', { name: `${BigInt(total).toLocaleString('en')} Slayer Points`, exact: true })
  await expect(exact).toHaveAttribute('data-exact-cost', total)
  await expect(exact.locator('sup')).toHaveText(String(total.length - 1))
  await exact.scrollIntoViewIfNeeded()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await stored(page)).toBe(JSON.stringify(profile))
})
test('an external item remains a visible explicit assumption and never becomes recorded progress', async ({ page }) => {
  const lock = node('Limit Break'), requirement = lock.reveal.kind === 'all' ? lock.reveal.requirements.find((gate) => gate.kind === 'milestone')! : undefined
  if (!requirement || requirement.kind !== 'milestone') throw new Error('Expected native Limit Break item gate')
  const profile = { ...initial, epoch: 1, showSpoilers: true, purchases: Object.fromEntries(catalog.upgrades.filter((upgrade) => upgrade.id !== lock.id).map((upgrade) => [upgrade.id, { epoch: 1, active: true }])) }
  await seed(page, profile); await page.goto('./ascension/'); const dialog = await open(page)
  await add(page, lock.title)
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', 'incomplete')
  await dialog.locator('.route-assumptions summary').click()
  await dialog.locator(`[data-route-milestone="${requirement.id}"]`).check()
  await expect(dialog.locator('.route-card')).toHaveAttribute('data-route-cost', lock.cost)
  await expect(dialog).toContainText('Conditional on listed items')
  await expect(dialog).toContainText('Explicit item assumptions')
  expect(await stored(page)).toBe(JSON.stringify(profile))
})
test('external visibility changes close the comparison and no hidden goal or target context returns', async ({ page, context }) => {
  const hidden = node('Limit Break'), profile = { ...initial, showSpoilers: true }
  await seed(page, profile)
  await page.addInitScript(({ key, id }) => localStorage.setItem(key, JSON.stringify({ version: 1, targets: [{ id, mode: 'activate' }] })), { key: GOALS_STORAGE_KEY, id: hidden.id })
  await page.goto('./ascension/'); let dialog = await open(page); await add(page, hidden.title)
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(dialog).toHaveCount(0); dialog = await open(page)
  await expect(dialog.locator('[data-route-target]')).toHaveCount(0)
  await dialog.getByRole('searchbox', { name: 'Find a route target', exact: true }).fill(hidden.title)
  await expect(dialog).toContainText('No visible matches')
  await expect(dialog.locator(`[data-route-choice="${hidden.id}"]`)).toHaveCount(0)
  await expect(dialog.locator(`[data-route-goal="${hidden.id}"]`)).toHaveCount(0)
  expect(await stored(page)).toBe(JSON.stringify(initial)); await other.close()
})
test('progress-conflict review replaces the route dialog with one correctly named native modal', async ({ page, context }) => {
  await seed(page, initial)
  await page.addInitScript((key) => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (name, value) { if ([key, ...(key === 'idle-slayer-ascension-map.profile.v1' ? ['idle-slayer-companion.progress.v1'] : key === 'idle-slayer-ascension-map.goals.v1' ? ['idle-slayer-companion.workspace.v1'] : [])].includes(name)) throw new DOMException('Synthetic profile refusal'); set.call(this, name, value) } }, PROFILE_STORAGE_KEY)
  await page.goto('./ascension/'); await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click(); await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  const other = await context.newPage(); await other.goto(page.url())
  await other.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify({ ...profile, showSpoilers: true })), { key: PROFILE_STORAGE_KEY, profile: initial })
  await expect(page.getByRole('button', { name: 'Review progress conflict', exact: true })).toBeVisible()
  const dialog = await open(page)
  await dialog.getByRole('button', { name: 'Review progress conflict', exact: true }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Backup & transfer', exact: true })).toBeVisible()
  await other.close()
})
test('route targets and choices remain usable with real 32px text and native Tab', async ({ baseURL }, info) => {
  test.setTimeout(60_000) // Include native persistent font-profile cleanup; assertion timeouts remain unchanged.
  const directory = info.outputPath('route-font-profile')
  await mkdir(join(directory, 'Default'), { recursive: true })
  await writeFile(join(directory, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: 32 } } }))
  const context = await chromium.launchPersistentContext(directory, { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], baseURL, viewport: { width: 320, height: 568 }, ...(info.project.name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) })
  await installProfileTestHelpers(context)
  const errors: string[] = [], watch = (page: Page) => page.on('pageerror', (error) => errors.push(error.message))
  context.pages().forEach(watch); context.on('page', watch)
  try {
    await context.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
    const page = await context.newPage(); await page.goto('./ascension/')
    await page.evaluate(({ key, profile }) => window.__writeExternalMapProfileText(key, JSON.stringify({ ...profile, showSpoilers: true })), { key: PROFILE_STORAGE_KEY, profile: initial }); await page.reload()
    await expect(page.locator('html')).toHaveCSS('font-size', '32px')
    const dialog = await open(page), input = dialog.getByRole('searchbox', { name: 'Find a route target', exact: true })
    await input.fill('Astral Key'); const choices = dialog.locator('[data-route-choice]')
    expect(await choices.count()).toBe(13)
    await input.focus()
    for (const button of await choices.all()) {
      await page.keyboard.press('Tab'); await expect(button).toBeFocused()
      expect(await button.evaluate((element) => {
        const frame = element.closest('dialog')!.getBoundingClientRect(), heading = element.closest('dialog')!.querySelector('.dialog-heading')!.getBoundingClientRect(), rect = element.getBoundingClientRect()
        const range = document.createRange(); range.selectNodeContents(element.querySelector('b')!)
        const lines = [...range.getClientRects()]
        return rect.width >= 44 && rect.height >= 44 && lines.length > 0 && lines.every((line) => line.top >= heading.bottom && line.bottom <= frame.bottom && line.left >= frame.left && line.right <= frame.right && document.elementFromPoint(line.x + line.width / 2, line.y + line.height / 2)?.closest('button') === element)
      })).toBe(true)
    }
    await page.screenshot({ path: info.outputPath('routes-native-tab-32.png') })
    await page.keyboard.press('Enter')
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    for (const width of [320, 844]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 390 })
      const mode = dialog.getByRole('combobox'); await mode.scrollIntoViewIfNeeded(); await expect(mode).toBeInViewport()
      expect((await mode.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: info.outputPath(`routes-${width}-32.png`) })
    }
    await page.setViewportSize({ width: 320, height: 568 })
    await dialog.locator('.route-targets button').click()
    await add(page, 'Legendary Belt')
    const first = dialog.locator('.route-card[data-route-cost="436"]')
    await expect(first).toHaveAttribute('data-route-cost', '436')
    await first.locator('.route-total').scrollIntoViewIfNeeded()
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath('routes-complete-total-320-32.png') })
    const intention = first.locator('.route-intention')
    await intention.scrollIntoViewIfNeeded()
    const rect = (await intention.boundingBox())!
    expect(rect.width).toBeGreaterThanOrEqual(44); expect(rect.height).toBeGreaterThanOrEqual(44)
    await intention.click(); await expect(first.getByRole('radio')).toBeChecked()
    await page.screenshot({ path: info.outputPath('routes-intention-320-32.png') })
    expect(await stored(page)).toBe(JSON.stringify({ ...initial, showSpoilers: true }))
  } finally { await context.close(); expect(errors, 'Unhandled route actual-font errors').toEqual([]) }
})
