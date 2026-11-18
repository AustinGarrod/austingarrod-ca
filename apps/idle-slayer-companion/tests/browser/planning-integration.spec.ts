import { expect, test } from './fixtures'

const controls = ['Compare prerequisite routes…', 'Analyze forward impact…'] as const
const purchase = 'Record purchase…'
const pairs = [[controls[0], controls[1]], [controls[1], controls[0]], [controls[0], purchase], [purchase, controls[0]]] as const
for (const [first, second] of pairs) test(`queued ${first} then ${second} opens one current dialog`, async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 568 })
  await page.addInitScript(() => { if (location.origin !== 'null') localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled') })
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.getByRole('searchbox').fill('Permanent Slayer')
  await page.getByRole('searchbox').press('Enter')
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  const stored = await page.evaluate(() => Object.keys(localStorage).sort().map((key) => [key, window.__readMapProfileText(key)]))
  const connected = await page.locator('.details').evaluate((element, labels) => {
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('.detail-actions button, .detail-secondary button')]
    const previous = buttons.find((button) => button.textContent === labels.first)
    const next = buttons.find((button) => button.textContent === labels.second)
    if (!previous || !next) throw new Error('Both planning actions must follow the native purchase controls')
    previous.click()
    const connected = next.isConnected
    next.click()
    return connected
  }, { first, second })
  expect(connected).toBe(true)
  const name = (label: string) => label === purchase ? 'Record purchase?' : label === controls[0] ? 'Prerequisite routes' : 'Forward impact'
  const currentName = name(second), previousName = name(first)
  const dialog = page.getByRole('dialog', { name: currentName, exact: true })
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('dialog', { name: previousName, exact: true })).toHaveCount(0)
  if (second !== purchase) {
    const panel = dialog.locator(second === controls[0] ? '.prerequisite-routes' : '.forward-impact')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveClass(/telemetry-private rr-block/)
  }
  expect(await page.evaluate(() => Object.keys(localStorage).sort().map((key) => [key, window.__readMapProfileText(key)]))).toEqual(stored)
  await page.keyboard.press('Escape')
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
})
