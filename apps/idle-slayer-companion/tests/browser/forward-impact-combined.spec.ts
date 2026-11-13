import { expect, test } from './fixtures'

for (const next of ['Recent upgrades…', 'Compare this upgrade…']) test(`a same-task ${next} action replaces the private forecast without changing stored documents`, async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.goto('./ascension/'); await expect(page.locator('.toolbar')).toBeVisible()
  await page.getByRole('searchbox').fill('Permanent Slayer')
  await page.getByRole('searchbox').press('Enter')
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  const stored = await page.evaluate(() => Object.keys(localStorage).sort().map((key) => [key, window.__readMapProfileText(key)]))
  const connected = await page.locator('.details').evaluate((element, next) => {
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')]
    const analyze = buttons.find((button) => button.textContent === 'Analyze forward impact…')
    const following = buttons.find((button) => button.textContent === next)
    if (!analyze || !following) throw new Error('Expected both actual native auxiliary controls')
    if (!analyze.closest('.detail-secondary') || !(element.querySelector('.detail-actions')!.compareDocumentPosition(analyze) & Node.DOCUMENT_POSITION_FOLLOWING)) throw new Error('Expected analysis after main purchase controls')
    analyze.click()
    const connected = following.isConnected
    following.click()
    return connected
  }, next)
  expect(connected).toBe(true)
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  const dialog = page.getByRole('dialog', { name: next === 'Recent upgrades…' ? 'Recent upgrades' : 'Saved upgrade comparison', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Forward impact', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => Object.keys(localStorage).sort().map((key) => [key, window.__readMapProfileText(key)]))).toEqual(stored)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
})
