import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const activation of ['search-enter', 'result-enter', 'result-space'] as const) {
  test(`keyboard ${activation} reaches details controls and returns to search after dismissal`, async ({ page }) => {
    await page.goto('./ascension/')
    const search = page.getByRole('searchbox')
    await search.fill('Permanent Slayer')
    if (activation === 'search-enter') await search.press('Enter')
    else {
      await page.locator('.search-result').first().focus()
      await page.keyboard.press(activation === 'result-enter' ? 'Enter' : 'Space')
    }
    const details = page.getByRole('complementary', { name: 'Upgrade details' })
    const heading = details.getByRole('heading', { name: 'Permanent Slayer', exact: true })
    await expect(heading).toBeVisible()
    // Bounded baseline evidence on a failure, without traversing the graph on passing runs.
    try { await expect(heading).toBeFocused() } catch (error) {
      let tabs = 0, graphStops = 0
      while (tabs < 170 && !await page.evaluate(() => Boolean(document.activeElement?.closest('.details')))) {
        await page.keyboard.press('Tab'); tabs++
        if (await page.evaluate(() => Boolean(document.activeElement?.closest('.react-flow__node')))) graphStops++
      }
      console.info(`Local keyboard baseline: ${tabs} tabs, ${graphStops} graph-node stops before inspector controls`)
      throw error
    }
    await expect(heading).toBeInViewport()
    const purchase = details.getByRole('button', { name: 'Record purchase…', exact: true })
    let tabs = 0
    do {
      await page.keyboard.press('Tab'); tabs++
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.details')))).toBe(true)
    } while (tabs < 8 && !await purchase.evaluate((element) => element === document.activeElement))
    await expect(purchase).toBeFocused()
    expect(tabs).toBeLessThanOrEqual(5)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Record purchase?', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(purchase).toBeFocused()
    await details.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
    await expect(details).toHaveCount(0)
    await expect(search).toBeFocused()
    // Selecting the already selected ID must still fulfill a fresh keyboard focus request.
    await search.press('Enter')
    await expect(heading).toBeFocused()
    await search.focus()
    await search.press('Enter')
    await expect(heading).toBeFocused()
    await details.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
    await expect(search).toBeFocused()
  })
}

test('pointer search selection retains focus behavior and empty results cannot select hidden upgrades', async ({ page }) => {
  await page.goto('./ascension/')
  const search = page.getByRole('searchbox')
  await search.fill('Permanent Slayer')
  await page.locator('.search-result').first().click()
  const details = page.getByRole('complementary', { name: 'Upgrade details' })
  await expect(details.getByRole('heading', { name: 'Permanent Slayer', exact: true })).not.toBeFocused()
  await details.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
  await expect(search).not.toBeFocused()
  await search.fill('Astral')
  await expect(page.locator('.search-result')).toHaveCount(0)
  await search.press('Enter')
  await expect(details).toHaveCount(0)
  await expect(search).toBeFocused()
})
