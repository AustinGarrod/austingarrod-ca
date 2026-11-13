import { installProfileTestHelpers } from './fixtures'
import { chromium, expect, test as base, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const key = catalog.upgrades.find((node) => node.title === 'Astral Key' && node.cost === '1000000000000000000')!
const exact = '1,000,000,000,000,000,000 Slayer Points'
const test = base.extend<{ fontSize: number }>({
  fontSize: [16, { option: true }],
  page: async ({ baseURL, fontSize }, use, info) => {
    // Include native persistent-profile startup/cleanup without widening the
    // normal action and assertion timeouts.
    info.setTimeout(60_000)
    const directory = info.outputPath('cost-font-profile')
    await mkdir(join(directory, 'Default'), { recursive: true })
    await writeFile(join(directory, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { default_font_size: fontSize } } }))
    let context: BrowserContext | undefined
    const errors: string[] = []
    const watch = (page: Page) => page.on('pageerror', (error) => errors.push(error.message))
    try {
      context = await chromium.launchPersistentContext(directory, {
        channel: 'chromium', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'], baseURL, viewport: { width: 320, height: 568 },
        ...(info.project.name === 'mobile' ? { isMobile: true, hasTouch: true, userAgent: info.project.use.userAgent, deviceScaleFactor: info.project.use.deviceScaleFactor } : {}),
      })
      await installProfileTestHelpers(context)
      context.pages().forEach(watch)
      context.on('page', watch)
      await context.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
      await context.route('https://analytics.garrod.house/**', (route) => route.abort())
      const page = await context.newPage(); await page.emulateMedia({ reducedMotion: 'reduce' })
      await use(page)
    } finally {
      await context?.close()
      if (dirname(resolve(directory)) !== resolve(info.outputDir)) throw new Error('Refusing to remove a font profile outside its test output directory')
      await rm(directory, { recursive: true, force: true })
      expect(errors, 'Unhandled browser errors during this exact-cost scenario').toEqual([])
    }
  },
})

async function exactCompact(cost: Locator) {
  await expect(cost).toHaveAccessibleName(exact)
  await expect(cost).toHaveAttribute('title', '1,000,000,000,000,000,000 SP')
  await expect(cost.locator('sup')).toHaveText('18')
  await expect(cost.locator('[aria-hidden]')).toHaveText('1 × 1018 SP')
  expect(await cost.evaluate((element) => { const boundary = element.parentElement!.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(element.querySelector('[aria-hidden]')!); return [...range.getClientRects()].every((box) => box.left >= boundary.left - 1 && box.right <= boundary.right + 1) })).toBe(true)
}

for (const fontSize of [16, 32]) test.describe(`${fontSize}px browser font`, () => {
  test.use({ fontSize })
  test('search, inspector, purchase and recommendation costs stay exact and readable on a narrow screen', async ({ page }, info) => {
    const profile = { ...emptyProfile(catalog.revision), epoch: 3, showSpoilers: true }
    for (const node of catalog.upgrades) profile.purchases[node.id] = { epoch: 3, active: true }
    for (const item of catalog.milestones) profile.milestones[item.id] = true
    delete profile.purchases[key.id]
    await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { Object.assign(window, { copiedExactCost: text }) } } }))
    await page.goto('./ascension/'); await expect(page.locator('html')).toHaveCSS('font-size', `${fontSize}px`)
    await page.getByRole('searchbox').fill('Astral Key')
    const result = page.locator(`.search-result[data-upgrade-id="${key.id}"]`)
    await exactCompact(result.getByRole('math'))
    await expect(result).toContainText(`ID: ${key.id}`)
    const labels = await page.locator('.search-result').filter({ has: page.locator('.discovery-title', { hasText: /^Astral Key$/ }) }).getByRole('math').evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')))
    expect(new Set(labels).size).toBe(11)
    await result.focus(); await page.screenshot({ path: info.outputPath('exact-cost-search.png') })
    await result.click()
    const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
    await exactCompact(details.locator('.detail-cost').getByRole('math'))
    expect(await details.locator('.detail-cost').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(fontSize * .8125)
    const expand = details.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
    const full = details.getByRole('region', { name: 'Exact Slayer Point cost', exact: true })
    await expect(full.getByRole('math')).toHaveAccessibleName(exact)
    await expect(full.getByRole('math')).toHaveText('1,000,000,000,000,000,000 SP')
    await expect(full).toContainText(`Upgrade ID: ${key.id}`)
    for (const group of await full.locator('.cost-digits').all()) {
      expect(await group.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); return new Set([...range.getClientRects()].map((box) => Math.round(box.top))).size })).toBe(1)
    }
    await full.getByRole('button', { name: 'Copy exact cost', exact: true }).click()
    await expect(full.getByRole('status')).toHaveText('Exact cost copied.')
    expect(await page.evaluate(() => (window as Window & { copiedExactCost?: string }).copiedExactCost)).toBe(key.cost)
    await full.getByRole('math').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('exact-cost-details.png') })
    await details.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    const purchase = page.getByRole('dialog', { name: 'Record purchase?', exact: true })
    await exactCompact(purchase.locator(`li[data-upgrade-id="${key.id}"]`).getByRole('math'))
    expect(await purchase.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await purchase.getByRole('math').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('exact-cost-purchase.png') })
    await purchase.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('button', { name: 'Next upgrade', exact: true }).click()
    const recommendations = page.getByRole('dialog', { name: 'Suggested next upgrade', exact: true })
    await expect(recommendations.locator('.recommendation-main')).toHaveAttribute('data-upgrade-id', key.id)
    await exactCompact(recommendations.locator('.recommendation-cost').getByRole('math'))
    expect(await recommendations.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    for (const button of await recommendations.locator('.recommendation-actions > button').all()) {
      await button.scrollIntoViewIfNeeded()
      expect(await button.evaluate((element) => {
        const boundary = element.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(element)
        return element.scrollWidth <= element.clientWidth + 1 && [...range.getClientRects()].every((box) => box.left >= boundary.left - 1 && box.right <= boundary.right + 1)
      })).toBe(true)
    }
    await recommendations.locator('.recommendation-cost').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('exact-cost-recommendation.png') })
    await recommendations.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await page.getByRole('button', { name: 'Map options', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Progress', exact: true }).click()
    const incoming = structuredClone(profile); incoming.purchases[key.id] = { epoch: 3, active: true }
    await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-exact-cost.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) })
    const restore = page.getByRole('dialog', { name: 'Restore progress?', exact: true })
    const comparison = restore.getByRole('region', { name: 'Progress differences', exact: true })
    await expect(comparison).toHaveClass(/telemetry-private rr-block/)
    await exactCompact(comparison.locator('li').filter({ hasText: key.id }).getByRole('math'))
    await comparison.getByRole('math').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('exact-cost-comparison.png') })
    await restore.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(profile)
  })

  test('clipboard failure offers exact selectable digits and a different same-title selection clears feedback', async ({ page }) => {
    await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...emptyProfile(catalog.revision), showSpoilers: true } })
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Synthetic clipboard rejection') } } }))
    await page.goto('./ascension/'); await page.getByRole('searchbox').fill('Astral Key')
    await page.locator(`.search-result[data-upgrade-id="${key.id}"]`).click()
    const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
    const expand = details.getByRole('button', { name: 'Show details', exact: true }); if (await expand.isVisible()) await expand.click()
    await details.getByRole('button', { name: 'Copy exact cost', exact: true }).click()
    await expect(details.getByRole('status')).toContainText('Copy unavailable')
    const manual = details.getByRole('textbox', { name: 'Exact cost digits', exact: true })
    await expect(manual).toHaveValue(key.cost); await manual.focus()
    expect(await manual.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([0, key.cost.length])
    expect(await details.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    const other = catalog.upgrades.find((node) => node.title === key.title && node.id !== key.id)!
    await page.getByRole('searchbox').fill('Astral Key'); await page.locator(`.search-result[data-upgrade-id="${other.id}"]`).click()
    await expect(details.getByRole('textbox', { name: 'Exact cost digits', exact: true })).toHaveCount(0)
    await expect(details.getByRole('status')).toBeEmpty()
    await expect(details.locator('.detail-cost').getByRole('math')).toHaveAttribute('data-exact-cost', other.cost)
  })

  test('future long mantissas wrap without losing a significant digit', async ({ page }, info) => {
    const value = '12345678901234567890123456789012345678901'
    const exact = `${BigInt(value).toLocaleString('en')} Slayer Points`
    const fixture = { ...catalog, upgrades: catalog.upgrades.map((node) => node.id === key.id ? { ...node, cost: value } : node) }
    await page.route('**/catalog.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }))
    await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile: { ...emptyProfile(catalog.revision), showSpoilers: true } })
    await page.goto('./ascension/'); await page.getByRole('searchbox').fill('Astral Key')
    const result = page.locator(`.search-result[data-upgrade-id="${key.id}"]`)
    const cost = result.getByRole('math')
    await expect(cost).toHaveAccessibleName(exact)
    await expect(cost.locator('[aria-hidden]')).toHaveText('1.2345678901234567890123456789012345678901 × 1040 SP')
    await result.click()
    const heading = page.locator('.detail-cost')
    await expect(heading.getByRole('math')).toHaveAccessibleName(exact)
    expect(await heading.evaluate((element) => { const range = document.createRange(); range.selectNodeContents(element); const boundary = element.getBoundingClientRect(); return [...range.getClientRects()].every((box) => box.left >= boundary.left - 1 && box.right <= boundary.right + 1) })).toBe(true)
    await page.screenshot({ path: info.outputPath('future-cost-mantissa.png') })
  })
})
