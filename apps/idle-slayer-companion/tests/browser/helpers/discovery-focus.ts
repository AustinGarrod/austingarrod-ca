import { expect, type Page } from '@playwright/test'
import { openSearchResults } from './app'

/** A focused row can intersect the viewport while its title is covered by the header. */
export async function focusedDiscoveryTitleIsReadable(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const button = document.activeElement
    const panel = button?.closest('.upgrade-discovery')
    const title = button?.querySelector('.discovery-title')
    const heading = panel?.querySelector('.results-heading')
    if (!(button instanceof HTMLElement) || !button.matches('.search-result') || !panel || !title || !heading) return { titleClear: false, hit: false, target: false }
    const box = button.getBoundingClientRect(), text = title.getBoundingClientRect(), bounds = panel.getBoundingClientRect()
    const top = Math.max(bounds.top, heading.getBoundingClientRect().bottom, 0), bottom = Math.min(bounds.bottom, innerHeight)
    const points = [[text.left + 1, text.top + 1], [text.left + text.width / 2, text.top + text.height / 2], [text.right - 1, text.bottom - 1]]
    return {
      titleClear: text.top >= top + 1 && text.bottom <= bottom - 1,
      hit: points.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.search-result') === button),
      target: box.width >= 44 && box.height >= 44,
    }
  })).toEqual({ titleClear: true, hit: true, target: true })
}

/** Native Tab reaches the results as one stop; arrows then visit every result and Shift+Tab leaves them. */
export async function tabThroughDiscovery(page: Page, ids: string[]) {
  await openSearchResults(page)
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Close search results' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('combobox', { name: 'Progress state' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.locator(`.search-result[data-upgrade-id="${ids[0]}"]`)).toBeFocused()
  await focusedDiscoveryTitleIsReadable(page)
  for (const id of ids.slice(1)) {
    await page.keyboard.press('ArrowDown')
    await expect(page.locator(`.search-result[data-upgrade-id="${id}"]`)).toBeFocused()
    await focusedDiscoveryTitleIsReadable(page)
  }
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('combobox', { name: 'Progress state' })).toBeFocused()
}
