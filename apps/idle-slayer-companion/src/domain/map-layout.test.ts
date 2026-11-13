import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dependencyPath } from '../DependencyEdge'
import { createMapLayout, GAME_NODE_SIZE, MAP_NODE_HEIGHT, MAP_NODE_WIDTH, WEB_NODE_GAP, WEB_RANK_GAP, type MapCenter, type MapLayout } from './map-layout'
import { visibility } from './rules'
import { emptyProfile, type Catalog } from './types'

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog
const start = visibility(catalog, emptyProfile(catalog.revision))
const graph = {
  upgrades: [
    { id: 'a', position: { x: 500, y: -200 } },
    { id: 'b', position: { x: -600, y: 300 } },
    { id: 'c', position: { x: 200, y: 700 } },
    { id: 'd', position: { x: 0, y: 0 } },
  ],
  connections: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }],
}

function expectNoOverlaps(result: MapLayout, width = MAP_NODE_WIDTH, height = MAP_NODE_HEIGHT) {
  const entries = [...result.centers.entries()]
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      const [leftId, a] = entries[left]
      const [rightId, b] = entries[right]
      expect(Math.abs(a.x - b.x) >= width || Math.abs(a.y - b.y) >= height, `${leftId} overlaps ${rightId}`).toBe(true)
    }
  }
}

/** Liang–Barsky clipping: test the whole segment, not only its route vertices. */
function interceptsCard(start: MapCenter, end: MapCenter, center: MapCenter, padding: number) {
  let enter = 0, exit = 1
  const dx = end.x - start.x, dy = end.y - start.y
  const halfWidth = MAP_NODE_WIDTH / 2 + padding, halfHeight = MAP_NODE_HEIGHT / 2 + padding
  for (const [direction, distance] of [
    [-dx, start.x - center.x + halfWidth], [dx, center.x + halfWidth - start.x],
    [-dy, start.y - center.y + halfHeight], [dy, center.y + halfHeight - start.y],
  ]) {
    if (direction === 0) { if (distance < 0) return false }
    else {
      const ratio = distance / direction
      if (direction < 0) enter = Math.max(enter, ratio)
      else exit = Math.min(exit, ratio)
      if (enter > exit) return false
    }
  }
  return true
}

describe('visible map layout', () => {
  it('preserves exact native centers with only the Unity-to-screen Y conversion', () => {
    const before = structuredClone(catalog)
    const result = createMapLayout({ mode: 'native', upgrades: catalog.upgrades, connections: catalog.connections })
    for (const upgrade of catalog.upgrades) expect(result.centers.get(upgrade.id)).toEqual({ x: upgrade.position.x, y: -upgrade.position.y })
    expect(result.centers.size).toBe(288)
    expect(result.width).toBe(3700)
    expect(result.height).toBe(3200)
    expect(result.edgePaths.size).toBe(318)
    expectNoOverlaps(result, GAME_NODE_SIZE, GAME_NODE_SIZE)
    expect(catalog).toEqual(before)
  })

  it('uses only visible nodes for native bounds', () => {
    const visible = graph.upgrades.slice(0, 2)
    const result = createMapLayout({ mode: 'native', upgrades: visible, connections: graph.connections })
    expect([...result.centers.keys()]).toEqual(['a', 'b'])
    expect(result.bounds).toEqual({ minX: -650, minY: -350, maxX: 550, maxY: 250 })
    expect([...result.edgePaths.keys()]).toEqual(['a:b'])
  })

  it('clips native straight lines at circular frames without changing the centers angle', () => {
    const result = createMapLayout({ mode: 'native', upgrades: catalog.upgrades, connections: catalog.connections })
    for (const edge of catalog.connections) {
      const source = result.centers.get(edge.from)!, target = result.centers.get(edge.to)!
      const points = result.edgePaths.get(`${edge.from}:${edge.to}`)!
      expect(points).toHaveLength(2)
      const [from, to] = points
      expect(Math.hypot(from.x - source.x, from.y - source.y)).toBeCloseTo(50)
      expect(Math.hypot(to.x - target.x, to.y - target.y)).toBeCloseTo(50)
      const dx = target.x - source.x, dy = target.y - source.y
      for (const point of points) expect((point.x - source.x) * dy - (point.y - source.y) * dx).toBeCloseTo(0)
      expect((to.x - from.x) * dx + (to.y - from.y) * dy).toBeGreaterThan(0)
    }
  })

  it('keeps native routes finite for coincident or overlapping custom nodes', () => {
    const upgrades = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 0, y: 0 } }]
    const result = createMapLayout({ mode: 'native', upgrades, connections: [{ from: 'a', to: 'b' }] })
    for (const point of result.edgePaths.get('a:b')!) expect(Math.hypot(point.x, point.y)).toBe(0)
    upgrades[1].position.x = 20
    for (const point of createMapLayout({ mode: 'native', upgrades, connections: [{ from: 'a', to: 'b' }] }).edgePaths.get('a:b')!) {
      expect(point.x).toBe(10)
      expect(Math.abs(point.y)).toBe(0)
    }
  })

  it.each([
    ['initial visible graph', start.upgrades, start.connections],
    ['complete spoiler graph', catalog.upgrades, catalog.connections],
  ] as const)('places every stable ID once without overlaps or backward DAG edges in the %s', (_label, upgrades, connections) => {
    const result = createMapLayout({ mode: 'web', upgrades, connections })
    expect([...result.centers.keys()].sort()).toEqual(upgrades.map((node) => node.id).sort())
    expectNoOverlaps(result)
    expect([...result.edgePaths.keys()].sort()).toEqual(connections.map((edge) => `${edge.from}:${edge.to}`).sort())
    for (const edge of connections) {
      const from = result.centers.get(edge.from)!
      const to = result.centers.get(edge.to)!
      expect(to.x - from.x, `${edge.from} -> ${edge.to}`).toBeGreaterThanOrEqual(MAP_NODE_WIDTH + WEB_RANK_GAP)
      const points = result.edgePaths.get(`${edge.from}:${edge.to}`)!
      expect(points.length).toBeGreaterThanOrEqual(3)
      expect(points[0]).toEqual({ x: from.x + MAP_NODE_WIDTH / 2, y: from.y })
      expect(points.at(-1)).toEqual({ x: to.x - MAP_NODE_WIDTH / 2, y: to.y })
      expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true)
    }
  })

  it('is deterministic across calls and source node/edge ordering', () => {
    const result = createMapLayout({ mode: 'web', ...graph })
    expect(createMapLayout({ mode: 'web', ...graph })).toEqual(result)
    expect(createMapLayout({ mode: 'web', upgrades: [...graph.upgrades].reverse(), connections: [...graph.connections].reverse() })).toEqual(result)
    const before = structuredClone(graph)
    createMapLayout({ mode: 'web', ...graph })
    expect(graph).toEqual(before)
  })

  it('keeps the full catalog deterministic independently of prior layout calls', () => {
    const result = createMapLayout({ mode: 'web', upgrades: catalog.upgrades, connections: catalog.connections })
    createMapLayout({ mode: 'web', ...graph })
    expect(createMapLayout({ mode: 'web', upgrades: [...catalog.upgrades].reverse(), connections: [...catalog.connections].reverse() })).toEqual(result)
  })

  it('orders parallel dependency paths to avoid an unnecessary two-layer crossing', () => {
    const result = createMapLayout({ mode: 'web', upgrades: graph.upgrades, connections: [{ from: 'a', to: 'd' }, { from: 'b', to: 'c' }] })
    const a = result.centers.get('a')!, b = result.centers.get('b')!, c = result.centers.get('c')!, d = result.centers.get('d')!
    expect((a.y - b.y) * (d.y - c.y)).toBeGreaterThan(0)
  })

  it('ignores native coordinate changes, hidden nodes and dangling hidden connections in web mode', () => {
    const visible = graph.upgrades.slice(0, 3)
    const edges = graph.connections.slice(0, 2)
    const result = createMapLayout({ mode: 'web', upgrades: visible, connections: edges })
    const moved = visible.map((node) => ({ ...node, position: { x: 999999, y: -999999 } }))
    expect(createMapLayout({ mode: 'web', upgrades: moved, connections: graph.connections })).toEqual(result)
    const hidden = { id: 'hidden', position: { x: 1e9, y: 1e9 } }
    const catalogWithHidden = [...moved, hidden]
    expect(createMapLayout({ mode: 'web', upgrades: catalogWithHidden.filter((node) => node.id !== hidden.id), connections: [...edges, { from: hidden.id, to: 'a' }, { from: 'b', to: hidden.id }] })).toEqual(result)
    expect([...result.centers.keys()]).not.toContain(hidden.id)
  })

  it('separates disconnected roots and isolated nodes with enough vertical card space', () => {
    const result = createMapLayout({ mode: 'web', upgrades: graph.upgrades, connections: [{ from: 'a', to: 'b' }] })
    expect(result.centers.size).toBe(4)
    expectNoOverlaps(result)
    const roots = ['a', 'c', 'd'].map((id) => result.centers.get(id)!).sort((left, right) => left.y - right.y)
    expect(new Set(roots.map((point) => point.x)).size).toBe(1)
    for (let index = 1; index < roots.length; index += 1) expect(roots[index].y - roots[index - 1].y).toBeGreaterThanOrEqual(MAP_NODE_HEIGHT + WEB_NODE_GAP)
  })

  it('accounts for larger cards and ignores duplicate visible connections', () => {
    const result = createMapLayout({ mode: 'web', ...graph, nodeWidth: 260, nodeHeight: 180 })
    expectNoOverlaps(result, 260, 180)
    expect(createMapLayout({ mode: 'web', ...graph, nodeWidth: 260, nodeHeight: 180, connections: [...graph.connections, graph.connections[0]] })).toEqual(result)
  })

  it('routes the full visible graph around unrelated cards with room for rounded corners', () => {
    const result = createMapLayout({ mode: 'web', upgrades: catalog.upgrades, connections: catalog.connections })
    const interceptions: string[] = []
    for (const edge of catalog.connections) {
      const points = result.edgePaths.get(`${edge.from}:${edge.to}`)!
      for (const [id, center] of result.centers) {
        if (id === edge.from || id === edge.to) continue
        // Eight pixels cover the edge component's maximum corner radius.
        if (points.slice(1).some((point, index) => interceptsCard(points[index], point, center, 8))) interceptions.push(`${edge.from}:${edge.to} intercepts ${id}`)
      }
    }
    expect(interceptions).toEqual([])
  })

  it('preserves route endpoints and corridors while rounding bends and handling repeated points', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]
    const before = structuredClone(points)
    expect(dependencyPath(points)).toBe('M 0 0 L 92 0 Q 100 0 100 8 L 100 92 Q 100 100 108 100 L 200 100')
    expect(dependencyPath([points[0], points[0], ...points.slice(1)])).toBe(dependencyPath(points))
    expect(dependencyPath([{ x: 10, y: 20 }, { x: 12, y: 20 }, { x: 12, y: 22 }])).toBe('M 10 20 L 11 20 Q 12 20 12 21 L 12 22')
    expect(dependencyPath([])).toBe('')
    expect(points).toEqual(before)
  })

  it.each(['native', 'web'] as const)('returns finite zero bounds for an empty %s graph', (mode) => {
    expect(createMapLayout({ mode, upgrades: [], connections: graph.connections })).toEqual({ centers: new Map(), edgePaths: new Map(), bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, width: 0, height: 0 })
  })

  it('rejects duplicate IDs and invalid dimensions rather than producing an ambiguous layout', () => {
    expect(() => createMapLayout({ mode: 'web', upgrades: [graph.upgrades[0], graph.upgrades[0]], connections: [] })).toThrow('unique')
    expect(() => createMapLayout({ mode: 'web', ...graph, nodeWidth: 0 })).toThrow('positive')
  })
})
