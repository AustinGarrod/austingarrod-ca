import { expect, test } from './fixtures'
import { openData } from './helpers/app'

test('sequential keyboard navigation skips backing file inputs while visible picker buttons work', async ({ page }) => {
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  const footerPrivacy = page.locator('footer').getByRole('button', { name: 'Privacy & tracking', exact: true })
  const lastVisible = await footerPrivacy.isVisible() ? footerPrivacy : page.getByRole('button', { name: 'Map navigation', exact: true })
  await lastVisible.focus()
  // The map keeps one backing input, for game saves; JSON restores moved to Data & backup's visible file field.
  const inputs = page.locator('input[type="file"]')
  expect(await inputs.count()).toBe(1)
  for (let count = 0; count < 2; count++) {
    await page.keyboard.press('Tab')
    for (const input of await inputs.all()) await expect(input).not.toBeFocused()
  }

  const data = await openData(page, { advanced: false })
  const restorePicker = page.waitForEvent('filechooser')
  await data.getByLabel('Restore from a backup file', { exact: true }).click()
  const restore = await restorePicker
  expect(restore.isMultiple()).toBe(false)
  await restore.setFiles([])
  await data.getByRole('button', { name: 'Import save…', exact: true }).click()
  const gamePicker = page.waitForEvent('filechooser')
  await page.getByRole('dialog', { name: 'Import save', exact: true }).getByLabel('Choose game save', { exact: true }).click()
  expect((await gamePicker).isMultiple()).toBe(false)
})
