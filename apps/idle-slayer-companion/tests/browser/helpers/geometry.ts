import { expect, type Page } from '@playwright/test'

export async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    width: document.documentElement.scrollWidth - window.innerWidth,
    height: document.documentElement.scrollHeight - window.innerHeight,
    x: window.scrollX,
    y: window.scrollY,
  }))).toEqual({ width: 0, height: 0, x: 0, y: 0 })
}

export async function selectedNodeIsUsable(page: Page, id: string) {
  const node = page.locator(`.react-flow__node[data-id="${id}"]`)
  await expect(node).toBeInViewport()
  await expect.poll(() => node.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const map = element.closest('.map')!.getBoundingClientRect()
    const controls = [...document.querySelectorAll('.camera-controls, .pan-controls, .map-summary')]
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return {
      touchTarget: rect.width >= 44 && rect.height >= 44,
      fullyInsideCanvas: rect.left >= map.left - 1 && rect.right <= map.right + 1 && rect.top >= map.top - 1 && rect.bottom <= map.bottom + 1,
      overlapsControls: controls.filter((control) => {
        const box = control.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top
      }).map((control) => control.className),
      hit: hit?.closest('.react-flow__node')?.getAttribute('data-id'),
    }
  })).toEqual({ touchTarget: true, fullyInsideCanvas: true, overlapsControls: [], hit: id })
}
