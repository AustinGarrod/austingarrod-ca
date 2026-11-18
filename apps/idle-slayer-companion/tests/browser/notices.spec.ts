import { expect, test } from './fixtures'
import { openAction } from './helpers/app'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { NoticeManifest } from '../../scripts/runtime-notices'

const manifest = JSON.parse(readFileSync('public/licenses/notices.json', 'utf8')) as NoticeManifest
test('About opens the deployed index and all complete runtime notices', async ({ page, request }) => {
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await openAction(page, 'About & sources')
  const link = page.getByRole('link', { name: 'Bundled software licenses', exact: true })
  const [index] = await Promise.all([page.waitForEvent('popup'), link.click()])
  await expect(index.getByRole('heading', { name: 'Bundled software licenses', exact: true })).toBeVisible()
  for (const item of manifest.packages) {
    const section = index.locator('section').filter({ has: index.getByRole('heading', { name: item.name + ' ' + item.version, exact: true }) })
    await expect(section).toHaveAttribute('data-version', item.version)
    for (const notice of item.notices) {
      const href = await section.getByRole('link', { name: notice.file, exact: true }).getAttribute('href')
      const response = await request.get(new URL(href!, index.url()).toString())
      expect(response.ok()).toBe(true)
      expect(createHash('sha256').update(await response.body()).digest('hex'), notice.file).toBe(notice.sha256)
    }
  }
})
