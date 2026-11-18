import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

type Viewport = { x: number; y: number; zoom: number }
type MotionProof = { before: Viewport; frames: Viewport[]; after: Viewport }
async function captureMotion(page: Page, action: () => Promise<unknown>): Promise<MotionProof> {
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')!
    const read = () => {
      // Inspect JavaScript camera targets; reduced-motion CSS permits a .01 ms transition.
      const matrix = new DOMMatrix(viewport.style.transform)
      return { x: matrix.e, y: matrix.f, zoom: matrix.a }
    }
    const proof = { before: read(), frames: [] as { x: number; y: number; zoom: number }[] }
    const observer = new MutationObserver(() => proof.frames.push(read()))
    observer.observe(viewport, { attributes: true, attributeFilter: ['style'] })
    Object.assign(window, { stopMotionProof: () => { observer.disconnect(); return { ...proof, after: read() } } })
  })
  await action()
  await page.waitForTimeout(350)
  return page.evaluate(() => (window as unknown as { stopMotionProof: () => MotionProof }).stopMotionProof())
}
const same = (a: Viewport, b: Viewport) => Math.abs(a.x - b.x) < 0.00001 && Math.abs(a.y - b.y) < 0.00001 && Math.abs(a.zoom - b.zoom) < 0.00001
function expectInstant(proof: MotionProof) {
  const movement = proof.frames.filter((frame) => !same(frame, proof.before))
  expect(movement.length, JSON.stringify(proof)).toBeGreaterThan(0)
  expect(movement.every((frame) => same(frame, proof.after)), 'A reduced-motion navigation interpolated before reaching its destination').toBe(true)
}
function expectAnimated(proof: MotionProof) {
  expect(proof.frames.some((frame) => !same(frame, proof.before) && !same(frame, proof.after)), 'Normal-motion navigation should retain its interpolation').toBe(true)
}
async function preference(page: Page, value: 'reduce' | 'no-preference') {
  await page.emulateMedia({ reducedMotion: value })
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(value === 'reduce')
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
})

test('live reduced-motion changes govern subsequent zoom, search and return navigation', async ({ page }) => {
  await preference(page, 'no-preference')
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.waitForTimeout(350)
  await preference(page, 'reduce')
  expectInstant(await captureMotion(page, () => page.getByRole('button', { name: 'Zoom in', exact: true }).click()))
  await page.getByRole('searchbox').fill('Reinvest')
  expectInstant(await captureMotion(page, () => page.locator('.search-result').filter({ hasText: 'Reinvest' }).first().click()))
  await expect(page.locator('.details h2')).toHaveText('Reinvest')
  expectInstant(await captureMotion(page, () => page.getByRole('button', { name: 'Return to start', exact: true }).click()))
  await expect(page.locator('.details h2')).toHaveText('Permanent Slayer')
  await preference(page, 'no-preference')
  expectAnimated(await captureMotion(page, () => page.getByRole('button', { name: 'Zoom out', exact: true }).click()))
})

test('initial reduced motion stays instant and later preference changes work in both directions', async ({ page }) => {
  await preference(page, 'reduce')
  await page.goto('./ascension/')
  await expect(page.locator('.toolbar')).toBeVisible()
  await page.waitForTimeout(350)
  expectInstant(await captureMotion(page, () => page.getByRole('button', { name: 'Zoom in', exact: true }).click()))
  await preference(page, 'no-preference')
  expectAnimated(await captureMotion(page, () => page.getByRole('button', { name: 'Zoom out', exact: true }).click()))
  await preference(page, 'reduce')
  expectInstant(await captureMotion(page, () => page.getByRole('button', { name: 'Zoom in', exact: true }).click()))
})
