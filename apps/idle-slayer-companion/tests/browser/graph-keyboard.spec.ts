import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { visibility } from '../../src/domain/rules'
import { emptyProfile, type Catalog } from '../../src/domain/types'
import { openAction as openCompanionAction } from './helpers/app'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const key = 'idle-slayer-ascension-map.profile.v1'
const hidden = catalog.upgrades.find((upgrade) => upgrade.title === 'Astral Slayer')!
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`)
async function expectGraphFocus(page: Page, id: string) {
  await expect.poll(() => page.evaluate(() => {
    const focused = document.activeElement as HTMLElement | null
    return { id: focused?.dataset.id, tabIndex: focused?.getAttribute('tabindex'), tabStops: document.querySelectorAll('.react-flow__node[tabindex="0"]').length }
  })).toEqual({ id, tabIndex: '0', tabStops: 1 })
}
async function cameraPosition(page: Page) {
  return page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f }
  })
}
async function settledCameraPosition(page: Page) {
  let position = { x: 0, y: 0 }
  await expect.poll(async () => {
    const proof = await page.locator('.react-flow__viewport').evaluate(async (element) => {
      const read = () => {
        const target = new DOMMatrix((element as HTMLElement).style.transform)
        const rendered = new DOMMatrix(getComputedStyle(element).transform)
        const map = element.closest('.map')!.getBoundingClientRect()
        return { x: rendered.e, y: rendered.f, zoom: rendered.a, width: map.width, height: map.height,
          targetMatches: Math.abs(rendered.e - target.e) < .01 && Math.abs(rendered.f - target.f) < .01 && Math.abs(rendered.a - target.a) < .00001 }
      }
      const before = read()
      let after = before
      let stable = before.targetMatches
      // ResizeObserver camera work takes two frames. A CSS transform can still
      // render its old value after the inline target changes, even with reduced
      // motion. Require convergence and stability, rather than counting frames
      // once and assuming that the resulting viewport is the pan baseline.
      for (let frame = 0; frame < 4; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        after = read()
        stable &&= after.targetMatches && after.x === before.x && after.y === before.y
          && after.zoom === before.zoom && after.width === before.width && after.height === before.height
      }
      return { stable, position: { x: after.x, y: after.y } }
    })
    position = proof.position
    return proof.stable
  }).toBe(true)
  return position
}
async function showSpoilers(page: Page, enabled: boolean) {
  const checkbox = page.getByRole('checkbox', { name: 'Show spoilers', exact: true })
  if (!await checkbox.isVisible()) await page.getByRole('button', { name: 'Map options', exact: true }).click()
  await checkbox.setChecked(enabled)
  const options = page.getByRole('dialog', { name: 'Map options', exact: true })
  if (await options.isVisible()) await options.getByRole('button', { name: 'Close dialog', exact: true }).click()
}
async function frameVisible(page: Page, id: string) {
  await expect.poll(() => node(page, id).evaluate((element) => {
    const box = element.getBoundingClientRect(), map = element.closest('.map')!.getBoundingClientRect()
    const centerX = (box.left + box.right) / 2, centerY = (box.top + box.bottom) / 2
    return box.left >= map.left - 1 && box.right <= map.right + 1 && box.top >= map.top - 1 && box.bottom <= map.bottom + 1
      && Boolean(document.elementFromPoint(centerX, centerY)?.closest('.react-flow__node') === element)
  })).toBe(true)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
})

for (const layout of ['Game Layout', 'Detailed Layout'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    test(`${layout} enters, explores and leaves the graph efficiently at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport); await page.goto('./ascension/')
      await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: layout, exact: true }).click()
      const nodes = page.locator('.react-flow__node')
      await expect(nodes).toHaveCount(121)
      await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
      await page.locator('.toolbar button:visible').last().focus()
      await page.keyboard.press('Tab')
      const shortcut = page.getByRole('button', { name: 'Skip upgrades to camera controls', exact: true })
      await expect(shortcut).toBeFocused(); await expect(shortcut).toBeInViewport()
      await expect(shortcut).toHaveAccessibleDescription(/Tab: leave upgrades for camera controls/)
      await page.keyboard.press('Enter')
      await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeFocused()
      const zoomBefore = await page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)
      await page.keyboard.press('Enter')
      await expect.poll(() => page.locator('.react-flow__viewport').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)).toBeGreaterThan(zoomBefore)
      await shortcut.focus(); await page.keyboard.press('Tab')
      await expect(node(page, catalog.startId)).toBeFocused()
      await expect(node(page, catalog.startId)).toHaveCSS('outline-style', 'solid')
      await expect(node(page, catalog.startId)).toHaveCSS('outline-color', 'rgb(0, 106, 97)')
      await expect(node(page, catalog.startId)).toHaveAccessibleName(/Permanent Slayer, available, .*Slayer Points/)
      await expect(node(page, catalog.startId)).toHaveAccessibleDescription(/catalog order; tree positions stay fixed/)
      await page.keyboard.press('End')
      const last = visibility(catalog, emptyProfile(catalog.revision)).upgrades.at(-1)!
      await expect(node(page, last.id)).toBeFocused(); await frameVisible(page, last.id)
      if (viewport.width === 320) {
        await page.setViewportSize({ width: 844, height: 390 })
        await expect(node(page, last.id)).toBeFocused(); await frameVisible(page, last.id)
        await page.setViewportSize(viewport)
        await expect(node(page, last.id)).toBeFocused(); await frameVisible(page, last.id)
      }
      await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight')
      const second = visibility(catalog, emptyProfile(catalog.revision)).upgrades[1]
      await expect(node(page, second.id)).toBeFocused()
      await page.keyboard.press('ArrowUp')
      const first = visibility(catalog, emptyProfile(catalog.revision)).upgrades[0]
      await expect(node(page, first.id)).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('.details h2')).toHaveText(first.title)
      await expect(node(page, first.id)).toHaveAttribute('aria-current', 'true')
      await expect(node(page, first.id)).toHaveClass(/selected/)
      await frameVisible(page, first.id)
      await page.keyboard.press('Escape')
      await expect(page.locator('.details')).toHaveCount(0)
      await expect(node(page, first.id)).toBeFocused()
      await page.keyboard.press('Space')
      await expect(page.locator('.details h2')).toHaveText(first.title)
      await page.keyboard.press('Escape')
      await expect(page.locator('.details')).toHaveCount(0)
      await expect(node(page, first.id)).toBeFocused()
      await page.keyboard.press('Shift+Tab'); await expect(shortcut).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.toolbar')))).toBe(true)
      await shortcut.focus(); await page.keyboard.press('Tab')
      let tabs = 0
      do { await page.keyboard.press('Tab'); tabs++ } while (tabs < 4 && !await page.getByRole('button', { name: 'Zoom out', exact: true }).evaluate((element) => element === document.activeElement))
      await expect(page.getByRole('button', { name: 'Zoom out', exact: true })).toBeFocused()
      expect(tabs).toBeLessThanOrEqual(2)
      expect(await page.evaluate((key) => window.__readMapProfileText(key), key)).toBeNull()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  for (const spoilers of [false, true]) {
    const visible = visibility(catalog, { ...emptyProfile(catalog.revision), showSpoilers: spoilers })
    // Four bounded ranges cover the reviewed 288-node tree. Each also enters
    // from its predecessor and exits to its successor using real arrow keys.
    const chunkSize = 72
    for (let start = 0; start < visible.upgrades.length; start += chunkSize) {
      const end = Math.min(start + chunkSize, visible.upgrades.length)
      test(`${layout} keyboard traverses every ${spoilers ? 'spoiler-visible' : 'default-visible'} upgrade ${start + 1}-${end} of ${visible.upgrades.length}`, async ({ page }) => {
        test.setTimeout(90_000)
        await page.goto('./ascension/')
        await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: layout, exact: true }).click()
        if (spoilers) await showSpoilers(page, true)
        await expect(page.locator('.react-flow__node')).toHaveCount(visible.upgrades.length)
        await page.getByRole('button', { name: 'Skip upgrades to camera controls', exact: true }).focus()
        await page.keyboard.press('Tab'); await page.keyboard.press('Home')
        await expectGraphFocus(page, visible.upgrades[0].id)
        if (start === 0) {
          await page.keyboard.press('ArrowLeft')
          await expectGraphFocus(page, visible.upgrades.at(-1)!.id)
          await page.keyboard.press('ArrowRight')
        } else {
          await node(page, visible.upgrades[start - 1].id).focus()
          await expectGraphFocus(page, visible.upgrades[start - 1].id)
          await page.keyboard.press('ArrowRight')
        }
        for (const upgrade of visible.upgrades.slice(start, end)) {
          await expectGraphFocus(page, upgrade.id)
          await page.keyboard.press('ArrowRight')
        }
        await expectGraphFocus(page, visible.upgrades[end % visible.upgrades.length].id)
      })
    }
  }

  test(`${layout} restores the visible focus universe after hiding a focused spoiler`, async ({ page }) => {
    await page.goto('./ascension/')
    await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: layout, exact: true }).click()
    await expect(node(page, hidden.id)).toHaveCount(0)
    await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
    await showSpoilers(page, true)
    await expect(page.locator('.react-flow__node')).toHaveCount(catalog.upgrades.length)
    await node(page, hidden.id).focus()
    await expectGraphFocus(page, hidden.id)
    await showSpoilers(page, false)
    await expect(node(page, hidden.id)).toHaveCount(0)
    const visible = visibility(catalog, emptyProfile(catalog.revision))
    await expect(page.locator('.react-flow__node')).toHaveCount(visible.upgrades.length)
    await expect(page.locator('.react-flow__node[tabindex="0"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Skip upgrades to camera controls', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expectGraphFocus(page, visible.upgrades[0].id)
    await expect(page.locator('.map')).not.toContainText(hidden.title)
  })

  for (const motion of ['reduce', 'no-preference'] as const) for (const viewport of [{ width: 375, height: 350 }, { width: 320, height: 350 }, { width: 320, height: 568 }]) {
    test(`${layout} keeps keyboard upgrades and directional controls usable with expanded details at ${viewport.width}x${viewport.height} (${motion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion })
      await page.setViewportSize(viewport); await page.goto('./ascension/')
      await page.getByRole('group', { name: 'Map layout' }).getByRole('button', { name: layout, exact: true }).click()
      await page.getByRole('button', { name: 'Return to start', exact: true }).click()
      await page.getByRole('button', { name: 'Show details', exact: true }).click()
      const navigation = page.getByRole('button', { name: 'Map navigation', exact: true })
      await navigation.click()
      await expect(page.locator('.pan-controls')).toBeVisible()
      await page.keyboard.press('Tab')
      const panLeft = page.getByRole('button', { name: 'Pan map left', exact: true })
      await expect(panLeft).toBeFocused()
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Skip upgrades to camera controls', exact: true }).focus()
      await page.keyboard.press('Tab'); await page.keyboard.press('End')
      const last = visibility(catalog, emptyProfile(catalog.revision)).upgrades.at(-1)!
      await expect(node(page, last.id)).toBeFocused()
      await expect(navigation).toHaveAttribute('aria-expanded', 'false')
      await expect(page.locator('.pan-controls')).toHaveCount(0)
      await frameVisible(page, last.id)
      await expect.poll(() => node(page, last.id).evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.width >= 44 && box.height >= 44 && ![...document.querySelectorAll('.camera-controls, .pan-controls, .react-flow__attribution')].some((control) => {
          const overlay = control.getBoundingClientRect()
          return box.left < overlay.right && box.right > overlay.left && box.top < overlay.bottom && box.bottom > overlay.top
        })
      })).toBe(true)
      let tabs = 0
      do { await page.keyboard.press('Tab'); tabs++ } while (tabs < 6 && !await navigation.evaluate((element) => element === document.activeElement))
      await expect(navigation).toBeFocused(); expect(tabs).toBeLessThanOrEqual(5)
      await page.keyboard.press('Enter')
      await expect(page.locator('.pan-controls')).toBeVisible()
      await page.keyboard.press('Tab'); await expect(panLeft).toBeFocused()
      for (const direction of ['left', 'right', 'up', 'down']) {
        const control = page.getByRole('button', { name: `Pan map ${direction}`, exact: true })
        await expect(control).toBeFocused()
        await expect(control).toBeInViewport()
        expect(await control.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return box.width >= 44 && box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        }), `Pan map ${direction} retains a 44px target and an unobstructed center`).toBe(true)
        const before = await settledCameraPosition(page)
        await page.keyboard.press('Enter')
        const expected = { x: before.x + (direction === 'left' ? 180 : direction === 'right' ? -180 : 0), y: before.y + (direction === 'up' ? 180 : direction === 'down' ? -180 : 0) }
        await expect.poll(async () => {
          const after = await cameraPosition(page)
          return Math.abs(after.x - expected.x) < .1 && Math.abs(after.y - expected.y) < .1
        }).toBe(true)
        const settled = await settledCameraPosition(page)
        expect(Math.abs(settled.x - expected.x)).toBeLessThan(.1)
        expect(Math.abs(settled.y - expected.y)).toBeLessThan(.1)
        await page.keyboard.press('Tab')
      }
      for (const name of ['Hide details', 'Close upgrade details', 'Record purchase…']) {
        const control = page.getByRole('button', { name, exact: true })
        await control.scrollIntoViewIfNeeded()
        await expect(control).toBeInViewport()
        expect(await control.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return box.width >= 44 && box.height >= 44 && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        }), `${name} retains a 44px target and an unobstructed center`).toBe(true)
      }
    })
  }
}

test('keyboard help is discoverable in responsive menus and restores its trigger focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('./ascension/')
  await openCompanionAction(page, 'Map help…')
  const help = page.getByRole('dialog', { name: 'Map help', exact: true })
  await expect(help).toContainText('one Tab stop')
  await expect(help).toContainText('catalog order')
  await expect(help).toContainText('interaction mode')
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeFocused()
  await openCompanionAction(page, 'About & sources')
  await page.getByRole('button', { name: 'Map help…', exact: true }).click()
  await expect(help).toBeVisible()
})
