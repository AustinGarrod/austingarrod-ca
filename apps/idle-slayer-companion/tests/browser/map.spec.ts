import { noPageOverflow, selectedNodeIsUsable } from './helpers/geometry'
import { exposeMapAction, openProgress, showSpoilers, selectUpgrade, chooseLayout, undoProgress } from './helpers/app'
import { expect, test } from './fixtures'
import { readFileSync } from 'node:fs'
import type { Catalog } from '../../src/domain/types'
import { emptyProfile } from '../../src/domain/types'
import { planPurchase, visibility } from '../../src/domain/rules'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const initial = emptyProfile(catalog.revision)
const initialVisibility = visibility(catalog, initial)
const start = catalog.upgrades.find((node) => node.id === catalog.startId)!
const hidden = catalog.upgrades.find((node) => !initialVisibility.ids.has(node.id))!

test('search centers the native node, purchase persists, and undo works', async ({ page }) => {
  await page.goto('./ascension/')
  await expect(page.getByRole('heading', { name: 'Ascension Map', exact: true })).toBeVisible()
  await page.getByRole('searchbox').fill(start.title)
  await page.locator('.search-result').filter({ hasText: start.title }).first().click()
  await expect(page.getByRole('complementary', { name: 'Upgrade details' })).toBeVisible()
  const node = page.locator(`.react-flow__node[data-id="${start.id}"]`)
  await expect(node).toBeInViewport()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  await page.reload()
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  await page.getByRole('button', { name: 'Remove purchase…' }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  await exposeMapAction(page, undo)
  await undo.click()
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
})

test('spoilers share one boundary across nodes, search, details and totals', async ({ page }) => {
  await page.goto('./ascension/')
  await expect(page.locator('.map-summary')).toContainText(`0 / ${initialVisibility.total}`)
  await expect(page.locator(`.react-flow__node[data-id="${hidden.id}"]`)).toHaveCount(0)
  await page.getByRole('searchbox').fill(hidden.title)
  await expect(page.locator('.search-result').filter({ hasText: hidden.title })).toHaveCount(0)
  await showSpoilers(page, true)
  await expect(page.locator('.map-summary')).toContainText(`0 / ${catalog.upgrades.length}`)
  await page.getByRole('searchbox').focus()
  await page.locator('.search-result').filter({ hasText: hidden.title }).first().click()
  await expect(page.locator('.details h2')).toHaveText(hidden.title)
  await showSpoilers(page, false)
  await expect(page.getByRole('complementary', { name: 'Upgrade details' })).toHaveCount(0)
  await expect(page.locator(`.react-flow__node[data-id="${hidden.id}"]`)).toHaveCount(0)
})

test('backup restore is previewed and malformed input leaves current progress intact', async ({ page }) => {
  await page.goto('./ascension/')
  await openProgress(page)
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') })
  await expect(page.getByRole('status', { name: 'Map action feedback', exact: true })).toContainText('not valid JSON')
  const profile = { ...initial, purchases: { [start.id]: { epoch: 0, active: true }, 'unknown-future-id': { epoch: 0, active: true } } }
  await page.getByLabel('Map progress JSON backup', { exact: true }).setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) })
  await expect(page.getByRole('dialog')).toContainText('Restore progress?')
  await expect(page.locator('.map-summary')).toContainText('0 /')
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await openProgress(page)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click()
  const download = await downloadPromise
  const backup = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(backup.purchases['unknown-future-id']).toEqual({ epoch: 0, active: true })
})

test('storage failures retain usable progress and export', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError') } })
  await page.goto('./ascension/')
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Record purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Current progress remains available')
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeEnabled()
})

test('manual Astral activation retains ownership through prerequisite removal and remains undoable', async ({ page }) => {
  const astral = catalog.upgrades.find((node) => node.title === 'Land Lord')!
  const choices: Record<string, number> = {}
  let purchase = planPurchase(catalog, { ...initial, epoch: 3 }, astral.id, choices)
  for (let count = 0; purchase.kind === 'choice' && count < catalog.upgrades.length; count++) {
    choices[purchase.key] = 0 // Explicit synthetic fixture choices, never player progress.
    purchase = planPurchase(catalog, { ...initial, epoch: 3 }, astral.id, choices)
  }
  if (purchase.kind !== 'ready') throw new Error('Land Lord fixture could not fill its reviewed prerequisites')
  await page.addInitScript((profile) => {
    const key = 'idle-slayer-ascension-map.profile.v1'
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(profile))
  }, purchase.profile)
  const recordedAstral = () => page.evaluate((id) => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!).purchases[id], astral.id)
  const activate = async () => {
    await selectUpgrade(page, astral.title)
    await page.getByRole('button', { name: 'Already activated…', exact: true }).click()
    await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  }
  await page.goto('./ascension/')
  await selectUpgrade(page, astral.title)
  await page.getByRole('button', { name: 'Already activated…', exact: true }).click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await recordedAstral()).toEqual({ epoch: 3, active: false })
  await activate()
  await expect.poll(recordedAstral).toEqual({ epoch: 2, active: true })
  await undoProgress(page)
  await expect.poll(recordedAstral).toEqual({ epoch: 3, active: false })
  await activate()
  await expect.poll(recordedAstral).toEqual({ epoch: 2, active: true })
  await page.reload()
  await selectUpgrade(page, astral.title)
  await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
  expect(await recordedAstral()).toEqual({ epoch: 2, active: true })
  await selectUpgrade(page, start.title)
  await page.getByRole('button', { name: 'Remove purchase…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Remove purchase?', exact: true })).not.toContainText(astral.title)
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(recordedAstral).toEqual({ epoch: 2, active: true })
  await undoProgress(page)
  await selectUpgrade(page, astral.title)
  await page.getByRole('button', { name: 'Remove purchase…', exact: true }).click()
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(recordedAstral).toBeUndefined()
  await undoProgress(page)
  await expect.poll(recordedAstral).toEqual({ epoch: 2, active: true })
})

test('manual Astral activation requires previous Ultra Ascension history', async ({ page }) => {
  const astral = catalog.upgrades.find((node) => node.title === 'Land Lord')!
  const profile = { ...initial, showSpoilers: true, purchases: { [astral.id]: { epoch: 0, active: false } } }
  await page.addInitScript((seed) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(seed)), profile)
  await page.goto('./ascension/')
  await selectUpgrade(page, astral.title)
  await page.getByRole('button', { name: 'Already activated…', exact: true }).click()
  await expect(page.getByRole('status', { name: 'Map action feedback', exact: true })).toContainText('Record at least one previous Ultra Ascension')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!))).toEqual(profile)
})

test('corrupt stored data cannot be overwritten by ordinary edits', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('idle-slayer-ascension-map.profile.v1', '{corrupt'))
  await page.goto('./ascension/')
  await expect(page.getByRole('alert')).toContainText('not valid JSON')
  await showSpoilers(page, true)
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))).toBe('{corrupt')
  await expect(page.getByRole('alert')).toContainText('Changes stay in memory')
})

test('entering history keeps repeat purchases current and removal still cascades', async ({ page }) => {
  const child = catalog.upgrades.find((node) => node.title === 'Reinvest')!
  const seed = { ...initial, purchases: { [start.id]: { epoch: 0, active: true }, [child.id]: { epoch: 0, active: true } } }
  await page.addInitScript((profile) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(profile)), seed)
  await page.goto('./ascension/')
  await openProgress(page)
  await page.getByRole('spinbutton', { name: 'Previous Ultra Ascensions' }).fill('1')
  await page.getByRole('button', { name: 'Review history…', exact: true }).click()
  await page.getByRole('button', { name: 'Record history', exact: true }).click()
  await page.getByRole('button', { name: 'Return to start', exact: true }).click()
  await page.getByRole('button', { name: 'Remove purchase…', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(child.title)
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!))).toEqual({ ...initial, epoch: 1 })
  const saved = await page.evaluate(() => JSON.parse(window.__readMapProfileText('idle-slayer-ascension-map.profile.v1')!))
  expect(saved.epoch).toBe(1)
  expect(saved.purchases[child.id]).toBeUndefined()
})

test('fixed map and responsive controls support keyboard details without overflow', async ({ page }) => {
  await page.goto('./ascension/')
  await chooseLayout(page, 'Game Layout')
  const node = page.locator(`.react-flow__node[data-id="${start.id}"]`)
  await expect(page.getByRole('complementary', { name: 'Upgrade details' })).toHaveCount(0)
  await node.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Upgrade details' })).toBeVisible()
  const original = await node.getAttribute('style')
  await node.focus()
  await page.keyboard.press('ArrowRight')
  expect(await node.getAttribute('style')).toBe(original)
  await page.getByRole('button', { name: 'Close upgrade details' }).click()
  await node.focus(); await page.keyboard.press('Enter')
  await expect(page.getByRole('complementary', { name: 'Upgrade details' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close upgrade details' })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect.poll(() => page.locator('.upgrade-icon').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  // Native Unity local Y is positive-up. Check the actual projected node
  // coordinates, independently of camera pan/zoom and the stored catalog.
  const higher = catalog.upgrades.find((upgrade) => upgrade.title === 'Reinvest')!
  const projection = await page.locator(`.react-flow__node[data-id="${higher.id}"]`).evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e + element.clientWidth / 2, y: matrix.f + element.clientHeight / 2 }
  })
  expect(projection).toEqual({ x: higher.position.x, y: -higher.position.y })
  await page.screenshot({ path: `test-results/atlas-${test.info().project.name}.png`, fullPage: true })
})

test('Web and Game layouts preserve selection, ownership and the spoiler boundary', async ({ page }) => {
  const branch = catalog.upgrades.find((upgrade) => upgrade.title === 'Reinvest')!
  const seed = { ...initial, purchases: { [start.id]: { epoch: 0, active: true } } }
  await page.addInitScript((profile) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(profile)), seed)
  await page.goto('./ascension/')
  const layout = page.getByRole('group', { name: 'Map layout', exact: true })
  await chooseLayout(page, 'Detailed Layout')
  await expect(layout.getByRole('button', { name: 'Detailed Layout', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await selectUpgrade(page, branch.title)
  const selectedNode = page.locator(`.react-flow__node[data-id="${branch.id}"]`)
  await expect(selectedNode).toHaveClass(/selected/)
  const webPosition = await selectedNode.getAttribute('style')
  const overlaps = await page.locator('.react-flow__node').evaluateAll((elements) => {
    const rectangles = elements.map((element) => {
      const matrix = new DOMMatrix(getComputedStyle(element).transform)
      return { id: element.getAttribute('data-id'), x: matrix.e, y: matrix.f, width: element.clientWidth, height: element.clientHeight }
    })
    const collisions: string[] = []
    for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j]
      if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y) collisions.push(`${a.id}:${b.id}`)
    }
    return collisions
  })
  expect(overlaps).toEqual([])
  const progress = await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))
  await chooseLayout(page, 'Game Layout')
  await expect(selectedNode).toHaveClass(/selected/)
  await expect(page.locator('.details h2')).toHaveText(branch.title)
  await expect.poll(() => selectedNode.getAttribute('style')).not.toBe(webPosition)
  await selectedNodeIsUsable(page, branch.id)
  await chooseLayout(page, 'Detailed Layout')
  await expect(selectedNode).toHaveClass(/selected/)
  await expect.poll(() => selectedNode.getAttribute('style')).toBe(webPosition)
  await selectedNodeIsUsable(page, branch.id)
  expect(await page.evaluate(() => window.__readMapProfileText('idle-slayer-ascension-map.profile.v1'))).toBe(progress)
  await expect(page.locator('.map-summary')).toContainText('1 /')
  await expect(page.locator(`.react-flow__node[data-id="${hidden.id}"]`)).toHaveCount(0)
  await page.getByRole('searchbox').fill(hidden.title)
  await expect(page.locator('.search-result').filter({ hasText: hidden.title })).toHaveCount(0)
})

test('selected connections show direction and navigate directly to visible neighbors', async ({ page }) => {
  const branch = catalog.upgrades.find((upgrade) => upgrade.title === 'Reinvest')!
  const incoming = catalog.connections.find((edge) => edge.to === branch.id && initialVisibility.ids.has(edge.from))!
  const outgoing = catalog.connections.find((edge) => edge.from === branch.id && initialVisibility.ids.has(edge.to))!
  const prerequisite = catalog.upgrades.find((upgrade) => upgrade.id === incoming.from)!
  const next = catalog.upgrades.find((upgrade) => upgrade.id === outgoing.to)!
  await page.goto('./ascension/')
  await chooseLayout(page, 'Detailed Layout')
  await selectUpgrade(page, branch.title)
  const fromEdge = page.locator(`.react-flow__edge[data-id="${incoming.from}:${incoming.to}"]`)
  const toEdge = page.locator(`.react-flow__edge[data-id="${outgoing.from}:${outgoing.to}"]`)
  await expect(fromEdge).toHaveClass(/connection-incoming/)
  await expect(toEdge).toHaveClass(/connection-outgoing/)
  await expect(fromEdge.locator('.react-flow__edge-path')).toHaveAttribute('marker-end', /.+/)
  await expect(toEdge.locator('.react-flow__edge-path')).toHaveAttribute('marker-end', /.+/)
  const muted = page.locator('.react-flow__edge.connection-muted').first()
  await expect(muted).toBeAttached()
  const incomingStyle = await fromEdge.locator('.react-flow__edge-path').evaluate((element) => ({ stroke: getComputedStyle(element).stroke, width: Number.parseFloat(getComputedStyle(element).strokeWidth) }))
  const outgoingStyle = await toEdge.locator('.react-flow__edge-path').evaluate((element) => ({ stroke: getComputedStyle(element).stroke, width: Number.parseFloat(getComputedStyle(element).strokeWidth) }))
  const backgroundWidth = await muted.locator('.react-flow__edge-path').evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth))
  expect(incomingStyle.stroke).not.toBe(outgoingStyle.stroke)
  expect(incomingStyle.width).toBeGreaterThan(backgroundWidth)
  expect(outgoingStyle.width).toBeGreaterThan(backgroundWidth)
  await expect(page.locator('.react-flow__node.node-muted').first()).toBeAttached()
  await expect(page.locator(`.react-flow__node[data-id="${prerequisite.id}"]`)).toHaveClass(/node-related/)
  await expect(page.locator(`.react-flow__node[data-id="${next.id}"]`)).toHaveClass(/node-related/)
  const expand = page.getByRole('button', { name: 'Show details', exact: true })
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('region', { name: 'Connected from', exact: true }).getByRole('button', { name: prerequisite.title, exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(prerequisite.title)
  await expect(page.locator(`.react-flow__node[data-id="${prerequisite.id}"]`)).toHaveClass(/selected/)
  await selectedNodeIsUsable(page, prerequisite.id)
  await selectUpgrade(page, branch.title)
  if (await expand.isVisible()) await expand.click()
  await page.getByRole('region', { name: 'Leads to', exact: true }).getByRole('button', { name: next.title, exact: true }).click()
  await expect(page.locator('.details h2')).toHaveText(next.title)
  await expect(page.locator(`.react-flow__node[data-id="${next.id}"]`)).toHaveClass(/selected/)
  await selectedNodeIsUsable(page, next.id)
})

test('connection navigation keeps native AND and OR purchase requirements explicit', async ({ page }) => {
  await page.addInitScript((profile) => localStorage.setItem('idle-slayer-ascension-map.profile.v1', JSON.stringify(profile)), { ...initial, showSpoilers: true })
  await page.goto('./ascension/')
  for (const kind of ['all', 'any'] as const) {
    const upgrade = catalog.upgrades.find((node) => node.purchase.kind === kind && node.purchase.requirements.length > 1 && node.purchase.requirements.every((requirement) => requirement.kind === 'active'))!
    if (upgrade.purchase.kind !== kind) throw new Error(`Missing native ${kind} fixture`)
    const expected = upgrade.purchase.requirements.map((requirement) => {
      if (requirement.kind !== 'active') throw new Error('Expected active prerequisite')
      return `${catalog.upgrades.find((node) => node.id === requirement.id)!.title} (active)`
    }).join(kind === 'all' ? ' AND ' : ' OR ')
    await selectUpgrade(page, upgrade.title)
    const expand = page.getByRole('button', { name: 'Show details', exact: true })
    if (await expand.isVisible()) await expand.click()
    const requirement = page.locator('.detail-content dt').filter({ hasText: /^Purchase requirements$/ }).locator('xpath=following-sibling::dd[1]')
    expect(await requirement.locator('.requirement-expression').evaluate((element) => { const text = element.cloneNode(true) as HTMLElement; text.querySelectorAll('.requirement-status').forEach((status) => status.remove()); return text.textContent })).toBe(expected)
    await expect(page.getByRole('region', { name: 'Connected from', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Leads to', exact: true })).toBeVisible()
  }
})

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`map and details stay usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./ascension/')
    await noPageOverflow(page)
    const map = page.getByRole('region', { name: 'Ascension tree', exact: true })
    const mapBox = (await map.boundingBox())!
    expect(mapBox.width).toBeGreaterThanOrEqual(viewport.width === 320 ? 280 : 400)
    expect(mapBox.height).toBeGreaterThanOrEqual(180)
    await page.getByRole('button', { name: 'Return to start', exact: true }).click()
    const details = page.getByRole('complementary', { name: 'Upgrade details', exact: true })
    await expect(details).toBeVisible()
    await expect(details.getByRole('button', { name: 'Record purchase…', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Show details', exact: true })).toBeVisible()
    await expect(page.locator('.detail-content')).not.toBeVisible()
    await selectedNodeIsUsable(page, start.id)
    await noPageOverflow(page)
    await page.getByRole('button', { name: 'Show details', exact: true }).click()
    await expect(page.locator('.detail-content')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hide details', exact: true })).toBeInViewport()
    await expect(page.getByRole('button', { name: 'Close upgrade details', exact: true })).toBeInViewport()
    await selectedNodeIsUsable(page, start.id)
    await details.getByRole('button', { name: 'Record purchase…', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Record purchase?')
    await page.getByRole('button', { name: 'Apply purchases', exact: true }).click()
    await expect(page.locator('.state-label')).toHaveText('✓ Purchased and active')
    await noPageOverflow(page)
    await page.getByRole('button', { name: 'Hide details', exact: true }).click()
    await expect(page.locator('.detail-content')).not.toBeVisible()
    await page.getByRole('button', { name: 'Close upgrade details', exact: true }).click()
    await expect(details).toHaveCount(0)
    await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Pan map right', exact: true })).toBeInViewport()
    await page.getByRole('button', { name: 'Pan map right', exact: true }).click()
    await page.getByRole('button', { name: 'Map navigation', exact: true }).click()
    await selectUpgrade(page, start.title)
    await noPageOverflow(page)
    await page.screenshot({ path: `test-results/atlas-${viewport.width}x${viewport.height}-${test.info().project.name}.png` })
  })
}
