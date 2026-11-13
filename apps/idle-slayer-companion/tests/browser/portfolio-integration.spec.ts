import { test, expect } from '@playwright/test'

test.describe('assembled portfolio integration', () => {
  test.skip(!process.env.PLAYWRIGHT_BASE_URL, 'Requires the assembled portfolio preview')

  test('portfolio routes, utility discovery and mobile menu remain usable', async ({ page, baseURL, isMobile }) => {
    const origin = new URL(baseURL!).origin
    await page.route('https://analytics.garrod.house/**', (route) => route.abort())
    await page.route('https://reports.garrod.house/**', (route) => route.abort())
    for (const route of ['/', '/about/', '/projects/', '/utilities/', '/contact/', '/404.html']) {
      const response = await page.goto(origin + route)
      expect(response?.status()).toBe(200)
      await expect(page.locator('h1')).toHaveCount(1)
      await expect(page.locator('main')).toHaveCount(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    await page.goto(origin + '/utilities/')
    const card = page.locator('article#idle-slayer-companion')
    await expect(card.getByRole('heading', { name: 'Idle Slayer Companion' })).toBeVisible()
    await card.getByRole('link', { name: 'Open utility' }).click()
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://austingarrod.ca/utilities/idle-slayer-companion/')
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/utilities/idle-slayer-companion/manifest.webmanifest')
    await page.goto(origin + '/contact/')
    await expect(page.locator('form.contact-form')).toHaveAttribute('action', '/contact.php')
    if (isMobile) {
      await page.getByRole('button', { name: 'Toggle navigation' }).click()
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Utilities', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Utilities', exact: true })).toBeVisible()
    }
  })

  test('worker scopes and static downloads remain separate', async ({ page, request, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const companion = await (await request.get(origin + '/utilities/idle-slayer-companion/manifest.webmanifest')).json()
    const radius = await (await request.get(origin + '/utilities/radius-map/manifest.webmanifest')).json()
    expect(companion.scope).toBe('/utilities/idle-slayer-companion/')
    expect(radius.scope).toBe('/utilities/radius-map/')
    expect(companion.id).not.toBe(radius.id)
    const resume = await request.get(origin + '/austin-garrod-resume.pdf')
    expect(resume.status()).toBe(200)
    expect((await resume.body()).subarray(0, 5).toString()).toBe('%PDF-')
    await page.route('https://**', (route) => route.abort())
    await page.goto(origin + '/utilities/radius-map/')
    await expect(page.locator('#map')).toBeVisible()
    await expect(page.locator('#location-form')).toBeVisible()
    await expect(page.locator('#save-measurement-button')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  })
})
