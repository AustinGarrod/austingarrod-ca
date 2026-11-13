import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog, Requirement } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { PROFILE_STORAGE_KEY } from '../../src/domain/storage'
import { satisfies } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog

for (const title of ['Soul of The Fallen', 'Soul Climbing Boots']) {
  test(`${title} remains locked while spoiler browsing until its native reveal gate is recorded`, async ({ page }) => {
    const node = catalog.upgrades.find((item) => item.title === title)!
    const profile = emptyProfile(catalog.revision)
    profile.showSpoilers = true
    const supply = (requirement: Requirement) => {
      switch (requirement.kind) {
        case 'all': requirement.requirements.forEach(supply); break
        case 'any': supply(requirement.requirements[0]!); break
        case 'owned': profile.purchases[requirement.id] = { epoch: 0, active: true }; break
        case 'active': profile.purchases[requirement.id] = { epoch: 0, active: true }; break
        case 'milestone': profile.milestones[requirement.id] = true; break
        case 'ultra-ascended': profile.epoch = 1; break
        case 'always': break
      }
    }
    supply(node.purchase)
    expect(satisfies(node.purchase, profile)).toBe(true)
    expect(satisfies(node.reveal, profile)).toBe(false)
    await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: PROFILE_STORAGE_KEY, profile })
    await page.goto('./ascension/')
    await page.getByRole('searchbox').fill(title)
    await page.locator('.search-result').filter({ hasText: title }).first().click()
    await expect(page.locator('.details h2')).toHaveText(title)
    await expect(page.locator('.state-label')).toHaveText('◇ Locked')
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"] .upgrade-node`)).toHaveClass(/\blocked\b/)
    await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Explicit progress required')
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

    supply(node.reveal)
    expect(satisfies(node.reveal, profile)).toBe(true)
    const progress = page.getByRole('button', { name: 'Progress', exact: true })
    if (!await progress.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
    await progress.click()
    await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'synthetic-revealed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) })
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
    await page.getByRole('searchbox').fill(title)
    await page.locator('.search-result').filter({ hasText: title }).first().click()
    await expect(page.locator('.state-label')).toHaveText('+ Available')
    await expect(page.locator(`.react-flow__node[data-id="${node.id}"] .upgrade-node`)).toHaveClass(/\bavailable\b/)
    await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Apply purchases', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
    await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  })
}
