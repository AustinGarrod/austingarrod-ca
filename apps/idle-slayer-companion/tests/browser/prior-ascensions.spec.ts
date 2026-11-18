import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog, type Profile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const pending = catalog.upgrades.find((node) => node.title === 'Land Lord')!
const retained = catalog.upgrades.find((node) => node.title === 'Astral Slayer')!
const seed: Profile = { ...emptyProfile(catalog.revision), epoch: 2, purchases: {
  [catalog.startId]: { epoch: 2, active: true }, [pending.id]: { epoch: 2, active: false },
  [retained.id]: { epoch: 1, active: true }, 'unknown-future': { epoch: 2, active: false },
}, milestones: { 'unknown-milestone': true } }

async function openAction(page: Page, name: string) {
  await expect(page.locator('.toolbar')).toBeVisible()
  const action = page.getByRole('button', { name, exact: true })
  if (!await action.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await action.click()
}
async function saved(page: Page) {
  return page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)
}
async function review(page: Page, value: string) {
  await openAction(page, 'Progress')
  await page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true }).fill(value)
  await page.getByRole('button', { name: 'Review history…', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, seed }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(seed))
  }, { key: PROFILE_STORAGE_KEY, seed })
  await page.goto('./ascension/')
})

test('editing, leaving and cancelling prior history keeps progress unchanged', async ({ page }) => {
  await openAction(page, 'Progress')
  const progress = page.getByRole('dialog', { name: 'Your progress', exact: true })
  await expect(progress).toContainText('Preview a new reset: clear repeat purchases')
  await expect(progress).toContainText('review and confirm to record it')
  await expect(progress).toContainText('Undo in this session or an earlier JSON backup')
  const input = progress.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })
  await input.fill('7'); await input.press('Tab')
  expect(await saved(page)).toEqual(seed)
  await progress.getByRole('button', { name: 'Close dialog', exact: true }).click()
  expect(await saved(page)).toEqual(seed)
  await review(page, '7')
  const confirmation = page.getByRole('dialog', { name: 'Record prior Ultra Ascensions?', exact: true })
  await expect(confirmation).toContainText('from 2 to 7')
  await expect(confirmation).toContainText('does not apply an Ultra Ascension reset')
  expect(await saved(page)).toEqual(seed)
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await saved(page)).toEqual(seed)
  await openAction(page, 'Progress')
  await expect(page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })).toHaveValue('2')
})

test('invalid counts explain rejection accessibly without silently replacing the draft', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openAction(page, 'Progress')
  const input = page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })
  for (const [value, explanation] of [
    ['', 'Enter the number'], ['-1', 'whole number'], ['2.5', 'whole number'],
    ['1', 'cannot lower'], ['1000001', 'up to 1,000,000'], ['2', 'already recorded'],
  ]) {
    await input.fill(value)
    await page.getByRole('button', { name: 'Review history…', exact: true }).click()
    const feedback = page.getByRole('dialog').locator('.dialog-feedback[role="status"]')
    await expect(feedback).toContainText(explanation)
    await expect(feedback).toBeInViewport()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAccessibleDescription(new RegExp(explanation))
    await expect(input).toHaveValue(value)
    await expect(page.getByRole('dialog', { name: 'Record prior Ultra Ascensions?', exact: true })).toHaveCount(0)
    expect(await saved(page)).toEqual(seed)
  }
  await input.fill('3')
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByRole('dialog').locator('.dialog-feedback')).toHaveText('')
})

test('confirmed history moves current known epochs, preserves retained state and supports Undo and reload', async ({ page }) => {
  await review(page, '1000000')
  const expected = { ...seed, epoch: 1_000_000, purchases: {
    ...seed.purchases, [catalog.startId]: { epoch: 1_000_000, active: true }, [pending.id]: { epoch: 1_000_000, active: false },
  } }
  await page.getByRole('button', { name: 'Record history', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(expected)
  await openAction(page, 'Undo')
  await expect.poll(() => saved(page)).toEqual(seed)
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await review(page, '1000000')
  await page.getByRole('button', { name: 'Record history', exact: true }).click()
  await expect.poll(() => saved(page)).toEqual(expected)
  await page.reload(); await openAction(page, 'Progress')
  await expect(page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true })).toHaveValue('1000000')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  expect(JSON.parse(readFileSync((await (await download).path())!, 'utf8'))).toEqual(expected)
})

test('history drafts and confirmation counts use replay exclusion without hidden upgrade names', async ({ page }) => {
  await openAction(page, 'Progress')
  const form = page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true }).locator('..').locator('..')
  await expect(form).toHaveClass(/telemetry-private/)
  await expect(form).toHaveClass(/rr-block/)
  await page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions', exact: true }).fill('7')
  await page.getByRole('button', { name: 'Review history…', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Record prior Ultra Ascensions?', exact: true })
  await expect(confirmation.locator(':scope > p')).toHaveClass(/telemetry-private rr-block/)
  await expect(confirmation).not.toContainText(pending.title)
  await expect(confirmation).not.toContainText('unknown-future')
})

test('external progress changes invalidate an unconfirmed history preview', async ({ page, context }) => {
  await review(page, '7')
  const other = await context.newPage(); await other.goto(page.url())
  await review(other, '4')
  await other.getByRole('button', { name: 'Record history', exact: true }).click()
  await expect.poll(() => saved(other)).toMatchObject({ epoch: 4 })
  await expect(page.getByRole('dialog', { name: 'Record prior Ultra Ascensions?', exact: true })).toHaveCount(0)
  expect(await saved(page)).toMatchObject({ epoch: 4 })
})
