import { expect, test } from './fixtures'
import { openAction } from './helpers/app'

const profileKey = 'idle-slayer-ascension-map.profile.v1'
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`optional help guides explicit setup without changing progress at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await expect(page.locator('.react-flow__node').first()).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const before = await page.evaluate((key) => window.__readMapProfileText(key), profileKey)
    await openAction(page, 'Map help…')
    const help = page.getByRole('dialog', { name: 'Map help', exact: true })
    await expect(help).toBeVisible()
    await expect(help.locator('dt')).toHaveText(['+ Available', '◇ Locked', '✓ Purchased and active', '◷ Owned · awaiting activation'])
    await expect(help).toContainText('does not apply a new reset or activate pending Astrals')
    await expect(help).toContainText('one Tab stop')
    await expect(help).not.toContainText('Astral Slayer')
    expect(await help.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await help.getByRole('button', { name: 'Open Progress', exact: true }).click()
    const progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
    await expect(progress.getByRole('button', { name: 'Import game save…', exact: true })).toBeVisible()
    await expect(progress.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })).toHaveValue('0')
    await expect(progress.getByRole('button', { name: 'Map help…', exact: true })).toHaveCount(0)
    await progress.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await openAction(page, 'Map help…')
    await help.getByRole('button', { name: 'Open Milestones', exact: true }).click()
    const milestones = page.getByRole('dialog', { name: 'Milestones', exact: true })
    await expect(milestones).toContainText('No milestone controls are currently revealed')
    await expect(milestones.getByRole('checkbox')).toHaveCount(0)
    await milestones.getByRole('button', { name: 'Review spoiler setting', exact: true }).click()
    const options = page.getByRole('dialog', { name: 'Map options', exact: true })
    await expect(options.getByRole('checkbox', { name: 'Show spoilers', exact: true })).not.toBeChecked()
    await expect(options).toContainText('Ultra Ascensions 0')
    expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBe(before)
    await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.map-summary')).toContainText('Ultra Ascensions 0')
  })
}
