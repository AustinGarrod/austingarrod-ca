import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import type { Catalog, Profile } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { satisfies, visibility } from '../../src/domain/rules'
import { tabThroughDiscovery } from './helpers/discovery-focus'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const visible = visibility(catalog, initial)
const cost = (value: string) => `${BigInt(value).toLocaleString('en')} SP`
const result = (page: Page, id: string) => page.locator(`.search-result[data-upgrade-id="${id}"]`)

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function seed(page: Page, profile: Profile) {
  await page.addInitScript((profile) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(profile)), profile)
}

test('browses every visible upgrade beyond the former 40-result limit and selects the final result', async ({ page }) => {
  await page.goto('./ascension/')
  await page.getByRole('searchbox').focus()
  await expect(page.locator('.search-result')).toHaveCount(visible.total)
  await expect(page.locator('.results-heading')).toContainText(`${visible.total} visible results`)
  const final = visible.upgrades.at(-1)!
  await result(page, final.id).scrollIntoViewIfNeeded()
  await expect(result(page, final.id)).toBeInViewport()
  await result(page, final.id).click()
  await expect(page.locator('.details h2')).toHaveText(final.title)
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', final.id)
  await expect(page.getByRole('region', { name: 'Visible upgrade results' })).toHaveCount(0)
})

test('discovers native coin effects with status and exact cost while preserving title-first Enter', async ({ page }) => {
  await page.goto('./ascension/')
  const search = page.getByRole('searchbox', { name: 'Search visible upgrade titles and effects' })
  await search.fill('coins')
  for (const title of ['Boost Coin', "Doesn't Matter to Me", 'King of The Sea']) {
    const node = visible.upgrades.find((node) => node.title === title)!
    await expect(result(page, node.id)).toContainText(title)
    await expect(result(page, node.id).getByRole('math')).toHaveAttribute('title', cost(node.cost))
    await expect(result(page, node.id).locator('.discovery-state')).toHaveText(/Available|Locked/)
    await expect(result(page, node.id).locator('.discovery-effect')).toContainText(/coins/i)
  }
  await expect(page.locator('.discovery-controls')).toContainText('SP balance is not checked')
  await search.fill('Permanent Slayer')
  await search.press('Enter')
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await expect(page.locator('.details h2')).toBeFocused()
})

test('filters owned and pending progress separately, keeping spoiler-visible native gates locked', async ({ page }) => {
  const profile = { ...initial, showSpoilers: true, purchases: { [catalog.startId]: { epoch: 0, active: true } } }
  const pending = catalog.upgrades.find((node) => node.activation === 'after-ultra-ascension')!
  profile.purchases[pending.id] = { epoch: 0, active: false }
  await seed(page, profile)
  await page.goto('./ascension/')
  await page.getByRole('searchbox').focus()
  const filter = page.getByRole('combobox', { name: 'Progress state' })
  await filter.selectOption('owned')
  await expect(page.locator('.search-result')).toHaveCount(2)
  await expect(result(page, catalog.startId)).toContainText('Owned and active')
  await expect(result(page, pending.id)).toContainText('Owned · awaiting activation')
  await filter.selectOption('pending')
  await expect(page.locator('.search-result')).toHaveCount(1)
  await expect(result(page, pending.id)).toBeVisible()
  await filter.selectOption('available')
  const available = catalog.upgrades.filter((node) => !profile.purchases[node.id] && satisfies(node.purchase, profile) && satisfies(node.reveal, profile))
  await expect(page.locator('.search-result')).toHaveCount(available.length)
  const gated = catalog.upgrades.find((node) => !profile.purchases[node.id] && !satisfies(node.reveal, profile))!
  await expect(result(page, gated.id)).toHaveCount(0)
  await filter.selectOption('locked')
  await expect(result(page, gated.id)).toContainText('Locked')
  await page.getByRole('searchbox').fill('PRIVATE-NO-MATCH-1122')
  await expect(page.locator('.results-heading')).toContainText('0 visible results')
  await expect(page.getByText('No visible upgrades match this progress state.')).toBeVisible()
})

test('duplicate titles expose stable IDs and exact costs and select the intended upgrade', async ({ page }) => {
  await seed(page, { ...initial, showSpoilers: true })
  await page.goto('./ascension/')
  await page.getByRole('searchbox').fill('Astral Key')
  const keys = catalog.upgrades.filter((node) => node.title === 'Astral Key')
  await expect(page.locator('.search-result').filter({ has: page.locator('.discovery-title', { hasText: /^Astral Key$/ }) })).toHaveCount(keys.length)
  for (const node of keys) {
    await expect(result(page, node.id)).toContainText(`ID: ${node.id}`)
    await expect(result(page, node.id).getByRole('math')).toHaveAttribute('title', cost(node.cost))
  }
  const final = keys.at(-1)!
  await result(page, final.id).click()
  await expect(page.locator('.detail-cost').getByRole('math')).toHaveAttribute('title', cost(final.cost))
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', final.id)
})

test('hidden effects, identities and counts never enter discovery; Escape and Tab preserve focus', async ({ page }) => {
  const hidden = catalog.upgrades.find((node) => !visible.ids.has(node.id))!
  const augmented = { ...catalog, upgrades: catalog.upgrades.map((node) => node.id === hidden.id ? { ...node, title: visible.upgrades[0].title, description: 'PRIVATE-HIDDEN-EFFECT-9981' } : node) }
  await page.route('**/catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(augmented) }))
  await page.goto('./ascension/')
  const search = page.getByRole('searchbox')
  await search.focus()
  await expect(page.locator('.search-result')).toHaveCount(visible.total)
  await expect(page.locator('.discovery-identity')).toHaveCount(0)
  await search.fill('PRIVATE-HIDDEN-EFFECT-9981')
  await expect(page.locator('.search-result')).toHaveCount(0)
  await search.press('Enter')
  await expect(page.locator('.details')).toHaveCount(0)
  await search.fill('')
  await search.press('Tab')
  await expect(page.getByRole('button', { name: 'Close search results' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Progress state' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(search).toBeFocused()
  await expect(page.getByRole('region', { name: 'Visible upgrade results' })).toHaveCount(0)
})

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`discovery scrolls inside ${viewport.width}×${viewport.height} without overflowing the page`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await page.getByRole('searchbox').focus()
    const panel = page.getByRole('region', { name: 'Visible upgrade results' })
    await expect(panel).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('discovery.png') })
    const final = visible.upgrades.at(-1)!
    await result(page, final.id).scrollIntoViewIfNeeded()
    await expect(result(page, final.id)).toBeInViewport()
    await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth - innerWidth, height: document.documentElement.scrollHeight - innerHeight }))).toEqual({ width: 0, height: 0 })
    expect(await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })).toBe(true)
    await result(page, final.id).click()
    await expect(page.locator('.details h2')).toHaveText(final.title)
  })
}

test('native Tab keeps every focused title clear of the sticky header at 320×350', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 350 })
  await page.goto('./ascension/')
  await tabThroughDiscovery(page, visible.upgrades.map((node) => node.id))
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('.details h2')).toHaveText(visible.upgrades.at(-1)!.title)
  await expect(page.locator('.details h2')).toBeFocused()
  await page.getByRole('button', { name: 'Close upgrade details' }).click()
  await expect(page.getByRole('searchbox')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Visible upgrade results' })).toHaveCount(0)
})

test('pointer focus keeps a partially scrolled row stationary until its click selects it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 350 })
  await page.goto('./ascension/')
  await page.getByRole('searchbox').focus()
  const second = visible.upgrades[1]
  const row = result(page, second.id)
  const panel = page.getByRole('region', { name: 'Visible upgrade results' })
  await row.evaluate((button) => {
    const panel = button.closest('.upgrade-discovery')!
    const heading = panel.querySelector('.results-heading')!.getBoundingClientRect()
    const title = button.querySelector('.discovery-title')!.getBoundingClientRect()
    panel.scrollTop += title.top - heading.bottom + title.height / 2
  })
  const point = await row.locator('.discovery-state').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
  })
  const before = await panel.evaluate((element) => element.scrollTop)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await expect(row).toBeFocused()
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(before)
  await page.mouse.up()
  await expect(page.locator('.details h2')).toHaveText(second.title)
  await expect(page.locator('.react-flow__node.selected')).toHaveAttribute('data-id', second.id)
})
