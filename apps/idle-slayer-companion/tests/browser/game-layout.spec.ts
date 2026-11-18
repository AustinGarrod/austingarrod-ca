import { noPageOverflow, selectedNodeIsUsable } from './helpers/geometry'
import { chooseLayout, selectUpgrade } from './helpers/app'
import { expect, test } from './fixtures'
import type { Locator, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { Catalog, Profile } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const visible = visibility(catalog, initial)
const start = catalog.upgrades.find((upgrade) => upgrade.id === catalog.startId)!
const branch = catalog.upgrades.find((upgrade) => upgrade.title === 'Reinvest')!
const hidden = catalog.upgrades.find((upgrade) => !visible.ids.has(upgrade.id))!
const profileKey = 'idle-slayer-ascension-map.profile.v1'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.analytics.v1', 'disabled'))
  await page.route('https://analytics.garrod.house/**', (route) => route.abort())
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

function upgradeNode(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id="${id}"]`)
}

async function titleIsPainted(title: Locator): Promise<boolean> {
  return title.evaluate((element) => {
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility === 'visible' && Number.parseFloat(style.opacity) > 0
  })
}

async function webPresentation(page: Page, sampleCounts?: number[]) {
  return page.evaluate((sampleCounts) => ({
    nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map((node) => {
      const matrix = new DOMMatrix(getComputedStyle(node).transform)
      const tile = node.querySelector<HTMLElement>('.upgrade-node')!
      return { id: node.dataset.id, x: matrix.e, y: matrix.f, width: tile.offsetWidth, height: tile.offsetHeight }
    }),
    paths: [...document.querySelectorAll('.react-flow__edge')].map((edge, index) => {
      const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')!
      const style = getComputedStyle(path)
      const d = path.getAttribute('d')
      const length = path.getTotalLength(), count = sampleCounts?.[index] ?? Math.max(2, Math.ceil(length / 8) + 1)
      const samples = Array.from({ length: count }, (_, position) => {
        const point = path.getPointAtLength(length * position / (count - 1))
        return { x: point.x, y: point.y }
      })
      return { id: edge.getAttribute('data-id'), d, length, samples, stroke: style.stroke, width: style.strokeWidth, dash: style.strokeDasharray }
    }),
  }), sampleCounts)
}

test('Game uses site-style square tiles without changing any visible center', async ({ page }) => {
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  await expect(page.locator('.map-game')).toBeVisible()
  await expect(page.locator('.react-flow__node')).toHaveCount(visible.upgrades.length)
  // Node dimensions change with the layout. Wait for RF's ResizeObserver to
  // update node-origin offsets before checking their actual displayed centers.
  await expect.poll(() => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => {
    const matrix = new DOMMatrix(getComputedStyle(node).transform)
    return { id: node.getAttribute('data-id'), x: matrix.e + (node as HTMLElement).offsetWidth / 2, y: matrix.f + (node as HTMLElement).offsetHeight / 2 }
  }))).toEqual(visible.upgrades.map((upgrade) => ({ id: upgrade.id, x: upgrade.position.x, y: -upgrade.position.y })))
  const tiles = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => {
    const matrix = new DOMMatrix(getComputedStyle(node).transform)
    const tile = node.querySelector<HTMLElement>('.upgrade-node')!
    const icon = tile.querySelector<HTMLElement>('.upgrade-icon')!
    return {
      id: node.getAttribute('data-id'),
      x: matrix.e + (node as HTMLElement).offsetWidth / 2,
      y: matrix.f + (node as HTMLElement).offsetHeight / 2,
      width: tile.offsetWidth, height: tile.offsetHeight,
      iconWidth: icon.offsetWidth, iconHeight: icon.offsetHeight,
      radius: getComputedStyle(tile).borderRadius,
      name: node.getAttribute('aria-label'),
    }
  }))
  for (const upgrade of visible.upgrades) {
    const tile = tiles.find((node) => node.id === upgrade.id)!
    expect(tile.x, upgrade.title).toBe(upgrade.position.x)
    expect(tile.y, upgrade.title).toBe(-upgrade.position.y)
    // Preserve the independently reviewed 100×100 bounds and 64×64 icon.
    // The site reskin changes the visible frame to square without moving centers.
    expect({ width: tile.width, height: tile.height, iconWidth: tile.iconWidth, iconHeight: tile.iconHeight }).toEqual({ width: 100, height: 100, iconWidth: 64, iconHeight: 64 })
    expect(tile.radius).toBe('0px')
    expect(tile.name).toContain(`${upgrade.title},`)
    expect(tile.name).toContain('Slayer Points')
  }
  await expect(upgradeNode(page, hidden.id)).toHaveCount(0)
})

test('Game connections retain their native center vector behind the square surfaces', async ({ page }) => {
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  await expect(page.locator('.native-connection-outline')).toHaveCount(visible.connections.length)
  const connections = await page.locator('.react-flow__edge').evaluateAll((edges) => edges.map((edge) => {
    const path = edge.querySelector<SVGPathElement>('.react-flow__edge-path')!
    const outline = edge.querySelector<SVGPathElement>('.native-connection-outline')!
    const length = path.getTotalLength()
    const first = path.getPointAtLength(0)
    const last = path.getPointAtLength(length)
    return {
      id: edge.getAttribute('data-id'), d: path.getAttribute('d'), outlineD: outline.getAttribute('d'),
      length, first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y },
      width: Number.parseFloat(getComputedStyle(path).strokeWidth),
      outlineWidth: Number.parseFloat(getComputedStyle(outline).strokeWidth),
      marker: path.getAttribute('marker-end'),
    }
  }))
  const byId = new Map(catalog.upgrades.map((upgrade) => [upgrade.id, upgrade]))
  expect(visible.connections.some((connection) => {
    const from = byId.get(connection.from)!, to = byId.get(connection.to)!
    return from.position.x !== to.position.x && from.position.y !== to.position.y
  })).toBe(true)
  for (const connection of visible.connections) {
    const from = byId.get(connection.from)!.position, to = byId.get(connection.to)!.position
    const line = connections.find((edge) => edge.id === `${connection.from}:${connection.to}`)!
    const dx = to.x - from.x, dy = from.y - to.y
    // Retain the reviewed native endpoints inside the opaque square surfaces.
    // The visible line continues along the same center vector to each frame.
    const borderFraction = 50 / Math.hypot(dx, dy)
    expect(line.first.x, line.id!).toBeCloseTo(from.x + dx * borderFraction, 3)
    expect(line.first.y, line.id!).toBeCloseTo(-from.y + dy * borderFraction, 3)
    expect(line.last.x, line.id!).toBeCloseTo(to.x - dx * borderFraction, 3)
    expect(line.last.y, line.id!).toBeCloseTo(-to.y - dy * borderFraction, 3)
    expect(line.length, line.id!).toBeCloseTo(Math.hypot(line.last.x - line.first.x, line.last.y - line.first.y), 3)
    expect(line.outlineD).toBe(line.d)
    expect(line.width).toBe(12)
    expect(line.outlineWidth).toBeGreaterThan(line.width)
    expect(line.marker).toBeNull()
  }
})

test('Game titles appear on hover and keyboard focus while details retain the full name', async ({ page }) => {
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  const node = upgradeNode(page, start.id)
  const title = node.locator('.node-title')
  await expect(node).toBeInViewport()
  await expect(title).toHaveText(start.title)
  await expect.poll(() => titleIsPainted(title)).toBe(false)
  await node.hover()
  await expect.poll(() => titleIsPainted(title)).toBe(true)
  await page.getByRole('button', { name: 'Game Layout', exact: true }).hover()
  await expect.poll(() => titleIsPainted(title)).toBe(false)
  await page.keyboard.press('Tab')
  await node.focus()
  await expect.poll(() => titleIsPainted(title)).toBe(true)
  await node.press('Enter')
  await expect(page.locator('.details h2')).toHaveText(start.title)
  await expect(node).toHaveClass(/selected/)
})

test('selected Game paths expose incoming and outgoing direction with stronger strokes', async ({ page }) => {
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  await selectUpgrade(page, branch.title)
  const incoming = visible.connections.find((edge) => edge.to === branch.id)!
  const outgoing = visible.connections.find((edge) => edge.from === branch.id)!
  const fromEdge = page.locator(`.react-flow__edge[data-id="${incoming.from}:${incoming.to}"]`)
  const toEdge = page.locator(`.react-flow__edge[data-id="${outgoing.from}:${outgoing.to}"]`)
  await expect(fromEdge).toHaveClass(/connection-incoming/)
  await expect(toEdge).toHaveClass(/connection-outgoing/)
  const pathStyle = (edge: Locator) => edge.locator('.react-flow__edge-path').evaluate((element) => {
    const style = getComputedStyle(element)
    const markerId = element.getAttribute('marker-end')?.match(/url\(["']?#([^"')]+)["']?\)/)?.[1]
    return { stroke: style.stroke, width: Number.parseFloat(style.strokeWidth), dash: style.strokeDasharray, marker: markerId ? document.getElementById(markerId)?.getAttribute('orient') : null, markerStart: element.getAttribute('marker-start') }
  })
  const incomingStyle = await pathStyle(fromEdge), outgoingStyle = await pathStyle(toEdge)
  expect(incomingStyle.width).toBe(14)
  expect(outgoingStyle.width).toBe(14)
  expect(incomingStyle.stroke).not.toBe(outgoingStyle.stroke)
  expect(incomingStyle.dash).not.toBe('none')
  expect(outgoingStyle.dash).toBe('none')
  for (const style of [incomingStyle, outgoingStyle]) {
    expect(style.marker).toMatch(/^auto(?:-start-reverse)?$/)
    expect(style.markerStart).toBeNull()
  }
  const muted = page.locator('.react-flow__edge.connection-muted').first()
  await expect(muted).toBeAttached()
  expect((await pathStyle(muted)).width).toBeLessThan(incomingStyle.width)
  await expect(muted.locator('.react-flow__edge-path')).not.toHaveAttribute('marker-end', /.+/)
  await expect(upgradeNode(page, incoming.from)).toHaveClass(/node-related/)
  await expect(upgradeNode(page, outgoing.to)).toHaveClass(/node-related/)
})

test('Game switch preserves progress and spoilers and restores Web geometry and routing', async ({ page }) => {
  const seed: Profile = { ...initial, purchases: { [start.id]: { epoch: 0, active: true } } }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: profileKey, profile: seed })
  await page.goto('./ascension/')
  await chooseLayout(page, 'Detailed Layout')
  await selectUpgrade(page, branch.title)
  const before = await webPresentation(page)
  expect(before.nodes.every((node) => node.width === 132 && node.height === 122)).toBe(true)
  const saved = await page.evaluate((key) => window.__readMapProfileText(key), profileKey)
  await chooseLayout(page, 'Game Layout')
  await expect(upgradeNode(page, branch.id)).toHaveClass(/selected/)
  await expect(page.locator('.details h2')).toHaveText(branch.title)
  await expect(upgradeNode(page, start.id).locator('.upgrade-node')).toHaveClass(/purchased/)
  await expect(upgradeNode(page, start.id).locator('.node-symbol')).toHaveText('✓')
  await expect(upgradeNode(page, start.id)).toHaveAttribute('aria-label', /purchased/)
  await selectedNodeIsUsable(page, branch.id)
  await expect(upgradeNode(page, hidden.id)).toHaveCount(0)
  await page.getByRole('searchbox').fill(hidden.title)
  await expect(page.locator('.search-result').filter({ hasText: hidden.title })).toHaveCount(0)
  await page.getByRole('searchbox').fill('')
  await chooseLayout(page, 'Detailed Layout')
  await expect(upgradeNode(page, branch.id)).toHaveClass(/selected/)
  await expect(page.locator('.native-connection-outline')).toHaveCount(0)
  const sampleCounts = before.paths.map((path) => path.samples.length)
  const structure = (value: typeof before) => ({ nodes: value.nodes, paths: value.paths.map(({ id, stroke, width, dash }) => ({ id, stroke, width, dash })) })
  await expect.poll(async () => {
    const after = await webPresentation(page, sampleCounts)
    // RF reads transformed handle rectangles. Tiny collinearity differences
    // can produce equivalent Q/L syntax, so compare the actual rendered routes.
    // Nodes, identities and styles remain exact. At most 8 units separate the
    // reference samples; lengths and point distances must stay within 0.05
    // world units (at most one eighth of a pixel at the maximum map zoom).
    const coordinatesRestored = after.paths.length === before.paths.length && after.paths.every((path, index) => {
      const expected = before.paths[index]
      return path.d !== null && expected.d !== null && path.length > 0 && expected.length > 0
        && Math.abs(path.length - expected.length) <= 0.05 && path.samples.length === expected.samples.length
        && path.samples.every((point, position) => Math.hypot(point.x - expected.samples[position].x, point.y - expected.samples[position].y) <= 0.05)
    })
    return { ...structure(after), coordinatesRestored }
  }).toEqual({ ...structure(before), coordinatesRestored: true })
  expect(await page.evaluate((key) => window.__readMapProfileText(key), profileKey)).toBe(saved)
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await expect(upgradeNode(page, hidden.id)).toHaveCount(0)
})

test('compact Game tiles preserve all four progress symbols and accessible states', async ({ page }) => {
  const pending = catalog.upgrades.find((upgrade) => upgrade.title === 'Ancient Awakening')!
  const locked = catalog.upgrades.find((upgrade) => upgrade.title === 'Ancient Treasures')!
  const available = catalog.upgrades.find((upgrade) => upgrade.title === 'Soul Gatherer Bundle')!
  const seed: Profile = { ...initial, showSpoilers: true, purchases: {
    [start.id]: { epoch: 0, active: true },
    [pending.id]: { epoch: 0, active: false },
  } }
  await page.addInitScript(({ key, profile }) => localStorage.setItem(key, JSON.stringify(profile)), { key: profileKey, profile: seed })
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  for (const fixture of [
    { upgrade: start, state: 'purchased', symbol: '✓' },
    { upgrade: available, state: 'available', symbol: '+' },
    { upgrade: pending, state: 'pending', symbol: '◷' },
    { upgrade: locked, state: 'locked', symbol: '◇' },
  ]) {
    const node = upgradeNode(page, fixture.upgrade.id)
    await expect(node.locator('.upgrade-node')).toHaveClass(new RegExp(`\\b${fixture.state}\\b`))
    await expect(node.locator('.node-symbol')).toHaveText(fixture.symbol)
    await expect(node).toHaveAttribute('aria-label', `${fixture.upgrade.title}, ${fixture.state}, ${BigInt(fixture.upgrade.cost).toLocaleString('en')} Slayer Points`)
  }
  const saved = await page.evaluate((key) => JSON.parse(window.__readMapProfileText(key)!) as Profile, profileKey)
  expect(saved.purchases[pending.id].active).toBe(false)
})

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`compact Game selection supports hit testing and keyboard at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await chooseLayout(page, 'Game Layout')
    await page.getByRole('button', { name: 'Return to start', exact: true }).click()
    await selectedNodeIsUsable(page, start.id)
    await noPageOverflow(page)
    await page.getByRole('button', { name: 'Show details', exact: true }).click()
    await expect(page.locator('.detail-content')).toBeVisible()
    await selectedNodeIsUsable(page, start.id)
    await noPageOverflow(page)
    await page.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
    const node = upgradeNode(page, start.id)
    await node.focus()
    await node.press('Enter')
    await expect(page.locator('.details h2')).toHaveText(start.title)
    await expect(node).toHaveClass(/selected/)
    await selectedNodeIsUsable(page, start.id)
    await noPageOverflow(page)
  })
}
