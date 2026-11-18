import { seedProfile } from './helpers/profile'
import { openProgress } from './helpers/app'
import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const ua = catalog.upgrades.find((node) => node.title === 'Ultra Ascension')!
const cases = ['active', 'pending', 'absent-source', 'absent-target'] as const
const retainedText = 'Existing purchase · retained by Astral progress on reset'

for (const retention of catalog.grants) {
  if (retention.when.kind !== 'active') throw new Error('Expected reviewed active-source retention')
  const sourceId = retention.when.id
  const source = catalog.upgrades.find((node) => node.id === sourceId)!
  const target = catalog.upgrades.find((node) => node.id === retention.ids[0])!
  for (const condition of cases) {
    test(`${target.title} details match reset with ${condition} ${source.title}`, async ({ page }) => {
      const profile = { ...emptyProfile(catalog.revision), epoch: 1 }
      profile.purchases[ua.id] = { epoch: 1, active: true }
      if (condition !== 'absent-source') profile.purchases[source.id] = { epoch: 1, active: condition !== 'pending' }
      if (condition !== 'absent-target') profile.purchases[target.id] = { epoch: 1, active: true }
      const retained = condition === 'active' || condition === 'pending' && source.activation === 'after-ultra-ascension'
      const before = structuredClone(profile)
      await seedProfile(page, profile)
      await page.goto('./ascension/')
      await page.getByRole('searchbox').fill(target.title)
      await page.locator('.search-result').filter({ hasText: target.title }).first().click()
      const explanation = page.locator('.details dl dd').last()
      await expect(explanation).toHaveText(retained ? retainedText : condition === 'absent-target' ? 'Repeat purchase · not currently owned' : 'Repeat purchase · clears on reset')
      await expect(page.locator('.details').getByRole('button', { name: condition === 'absent-target' ? 'Record purchase…' : 'Remove purchase…', exact: true })).toBeVisible()
      await expect(page.locator('.details').getByRole('button', { name: condition === 'absent-target' ? 'Remove purchase…' : 'Record purchase…', exact: true })).toHaveCount(0)
      if (!visibility(catalog, profile).ids.has(source.id)) await expect(page.locator('.details')).not.toContainText(source.title)
      expect(await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(before)
      await openProgress(page)
      await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
      const retainedGroup = page.getByRole('region', { name: 'Ascension reset effects', exact: true }).locator(':scope > section').filter({ has: page.getByRole('heading', { name: /Conditionally retained purchases/ }) })
      if (retained) await expect(retainedGroup).toContainText(target.title)
      else await expect(retainedGroup).not.toContainText(target.title)
      await page.getByRole('button', { name: 'Record companion Ultra Ascension', exact: true }).click()
      await expect.poll(() => page.evaluate(({ key, id }) => JSON.parse(window.__readMapProfileText(key)!).purchases[id], { key: PROFILE_STORAGE_KEY, id: target.id })).toEqual(retained ? before.purchases[target.id] : undefined)
      await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!).epoch, PROFILE_STORAGE_KEY)).toBe(2)
    })
  }
}
