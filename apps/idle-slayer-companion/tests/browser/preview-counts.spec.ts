import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { planRemoval, planUltraAscension, visibility } from '../../src/domain/rules'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const rowLabel = (id: string) => {
  const node = catalog.upgrades.find((node) => node.id === id)!
  return { id, cost: `${BigInt(node.cost).toLocaleString('en')} Slayer Points` }
}

for (const showSpoilers of [false, true]) {
  for (const operation of ['removal', 'reset'] as const) {
    test(`${operation} preview counts and rows share visibility with spoilers ${showSpoilers ? 'shown' : 'hidden'}`, async ({ page }) => {
      const profile = emptyProfile(catalog.revision)
      profile.showSpoilers = showSpoilers
      for (const node of catalog.upgrades) profile.purchases[node.id] = { epoch: 0, active: node.activation === 'immediate' }
      // Synthetic supported ownership with explicit missing milestones, never player data.
      const visible = visibility(catalog, profile)
      const visibleIds = (ids: string[]) => ids.filter((id) => visible.ids.has(id))
      const removal = planRemoval(catalog, profile, catalog.startId)
      const reset = planUltraAscension(catalog, profile)!
      expect(reset).not.toBeNull()
      if (!showSpoilers) {
        expect(visibleIds(removal.removed).length).toBeLessThan(removal.removed.length)
        expect(visibleIds(reset.cleared).length).toBeLessThan(reset.cleared.length)
      }
      await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
      await page.goto('./ascension/')
      await expect(page.locator('.toolbar')).toBeVisible()
      if (operation === 'removal') {
        await page.getByRole('button', { name: 'Return to start', exact: true }).click()
        await page.getByRole('button', { name: 'Remove purchase…', exact: true }).click()
        const expected = visibleIds(removal.removed)
        await expect(page.getByRole('dialog')).toContainText(`This clears ${expected.length} visible purchases`)
        await expect(page.getByRole('dialog').locator('li')).toHaveCount(expected.length)
        expect(await page.getByRole('dialog').locator('li').evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute('data-upgrade-id'), cost: element.querySelector('[role=math]')?.getAttribute('aria-label') })))).toEqual(expected.map(rowLabel))
      } else {
        const progress = page.getByRole('button', { name: 'Progress', exact: true })
        if (!await progress.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
        await progress.click()
        await page.getByRole('button', { name: 'Ultra Ascend…', exact: true }).click()
        const groups = [
          ['Repeat purchases cleared', reset.cleared], ['Astral locks activated', reset.activated], ['Conditionally retained purchases', reset.conditionallyRetained],
        ] as const
        for (const [label, ids] of groups) {
          const section = page.getByRole('region', { name: 'Ascension reset effects', exact: true }).locator(':scope > section').filter({ has: page.getByRole('heading', { name: `${label} (${visibleIds(ids).length})`, exact: true }) })
          await expect(section).toBeVisible()
          await expect(section.locator('li')).toHaveCount(visibleIds(ids).length)
          expect(await section.locator('li').evaluateAll((elements) => elements.map((element) => ({ id: element.getAttribute('data-upgrade-id'), cost: element.querySelector('[role=math]')?.getAttribute('aria-label') })))).toEqual(catalog.upgrades.filter((node) => visibleIds(ids).includes(node.id)).map((node) => rowLabel(node.id)))
        }
      }
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(operation === 'reset' ? 'Lists show only your current visible entries' : 'The change applies to the entire profile. Lists and counts show only currently visible upgrades.')
      await page.getByRole('button', { name: operation === 'reset' ? 'Record companion Ultra Ascension' : 'Apply changes', exact: true }).click()
      const expected = operation === 'removal' ? removal.profile : reset.profile
      await expect.poll(() => page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!), PROFILE_STORAGE_KEY)).toEqual(expected)
    })
  }
}
