import { describe, expect, it } from 'vitest'
import { visibleOverviewViewport } from './map-overview'
import { createMapLayout } from './map-layout'

const centers = new Map([['a', { x: -400, y: 100 }], ['b', { x: 500, y: -200 }]])
const options = { centers, visibleIds: new Set(['a', 'b']), nodeWidth: 100, nodeHeight: 100,
  area: { x: 100, y: 80, width: 800, height: 600 } }

describe('visible-only map overview', () => {
  it('fits complete frame dimensions inside asymmetric responsive insets', () => {
    const before = structuredClone(options)
    const viewport = visibleOverviewViewport(options)!
    expect(viewport).toEqual({ x: 460, y: 420, zoom: 0.8 })
    for (const center of centers.values()) {
      expect(viewport.x + (center.x - 50) * viewport.zoom).toBeGreaterThanOrEqual(options.area.x)
      expect(viewport.x + (center.x + 50) * viewport.zoom).toBeLessThanOrEqual(options.area.x + options.area.width)
      expect(viewport.y + (center.y - 50) * viewport.zoom).toBeGreaterThanOrEqual(options.area.y)
      expect(viewport.y + (center.y + 50) * viewport.zoom).toBeLessThanOrEqual(options.area.y + options.area.height)
    }
    expect(options).toEqual(before)
  })

  it('ignores hidden extremes and their existence entirely, while fitting newly visible frames', () => {
    const withHidden = new Map([...centers, ['secret', { x: 1e9, y: -1e9 }] as const])
    expect(visibleOverviewViewport({ ...options, centers: withHidden })).toEqual(visibleOverviewViewport(options))
    const visibleExtreme = new Map([...centers, ['revealed', { x: 2000, y: 1000 }] as const])
    expect(visibleOverviewViewport({ ...options, centers: visibleExtreme, visibleIds: new Set(['a', 'b', 'revealed']) })?.zoom).toBeLessThan(0.8)
  })

  it.each(['native', 'web'] as const)('depends only on the shared visible %s layout, never dangling hidden topology', (mode) => {
    const upgrades = [{ id: 'a', position: { x: -100, y: 100 } }, { id: 'b', position: { x: 100, y: -100 } }]
    const plain = createMapLayout({ mode, upgrades, connections: [{ from: 'a', to: 'b' }] })
    const hiddenEdges = createMapLayout({ mode, upgrades, connections: [{ from: 'a', to: 'b' }, { from: 'secret', to: 'a' }, { from: 'b', to: 'secret' }] })
    expect(visibleOverviewViewport({ ...options, centers: hiddenEdges.centers })).toEqual(visibleOverviewViewport({ ...options, centers: plain.centers }))
  })

  it('allows a useful cap for a single frame and a complete small-screen fit below inspection zoom', () => {
    expect(visibleOverviewViewport({ ...options, centers: new Map([['a', { x: 20, y: 40 }]]), visibleIds: new Set(['a']) })).toEqual({ x: 480, y: 340, zoom: 1 })
    const small = visibleOverviewViewport({ ...options, area: { x: 12, y: 60, width: 296, height: 100 } })!
    expect(small.zoom).toBe(0.25)
    const tall = visibleOverviewViewport({ ...options, centers: new Map([['a', { x: 0, y: -2000 }], ['b', { x: 0, y: 2000 }]]), area: { x: 12, y: 60, width: 296, height: 100 } })!
    expect(tall.zoom).toBeLessThan(0.15)
  })

  it('refuses empty, missing, invalid or unusable inputs rather than fitting partial or nonfinite bounds', () => {
    expect(visibleOverviewViewport({ ...options, visibleIds: new Set() })).toBeNull()
    expect(visibleOverviewViewport({ ...options, visibleIds: new Set(['missing']) })).toBeNull()
    expect(visibleOverviewViewport({ ...options, centers: new Map([['a', { x: NaN, y: 0 }]]) })).toBeNull()
    expect(visibleOverviewViewport({ ...options, nodeWidth: 0 })).toBeNull()
    expect(visibleOverviewViewport({ ...options, area: { ...options.area, height: 0 } })).toBeNull()
    expect(visibleOverviewViewport({ ...options, area: { ...options.area, x: Infinity } })).toBeNull()
    expect(visibleOverviewViewport({ ...options, centers: new Map([['a', { x: 1e308, y: 0 }]]), visibleIds: new Set(['a']) })).toBeNull()
    expect(visibleOverviewViewport({ ...options, centers: new Map([['a', { x: -1e308, y: 0 }], ['b', { x: 1e308, y: 0 }]]) })).toBeNull()
  })
})
