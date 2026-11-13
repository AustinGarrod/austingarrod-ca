import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel } from '@dagrejs/dagre'
import type { Upgrade } from './types'

export type MapLayoutMode = 'native' | 'web'

export interface MapCenter {
  readonly x: number
  readonly y: number
}

export interface MapLayoutOptions {
  mode: MapLayoutMode
  /** Supply only upgrades exposed by the shared visibility calculation. */
  upgrades: readonly Pick<Upgrade, 'id' | 'position'>[]
  connections: readonly { from: string; to: string }[]
  nodeWidth?: number
  nodeHeight?: number
}

export interface MapLayout {
  /** Centers match React Flow's nodeOrigin={[0.5, 0.5]}. */
  centers: ReadonlyMap<string, MapCenter>
  /** Routes keyed by `${from}:${to}`; native lines retain the center-to-center angle. */
  edgePaths: ReadonlyMap<string, readonly MapCenter[]>
  /** Card-inclusive bounds; hidden nodes cannot contribute to these bounds. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  width: number
  height: number
}

export const MAP_NODE_WIDTH = 132
export const MAP_NODE_HEIGHT = 122
// Ascension Skill / Container RectTransforms in the reviewed native prefab.
export const GAME_NODE_SIZE = 100
export const WEB_RANK_GAP = 100
export const WEB_NODE_GAP = 48

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function dimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Map card dimensions must be finite and positive')
  return value
}

/**
 * Places the visible graph only. Native coordinates remain untouched; web
 * positions depend only on visible stable IDs, edges and card dimensions.
 * Dagre uses layered ranking and crossing minimization, with left-to-right
 * ranks. Sorted insertion makes placement independent of source array order.
 */
export function createMapLayout({ mode, upgrades, connections, nodeWidth, nodeHeight }: MapLayoutOptions): MapLayout {
  const width = dimension(nodeWidth ?? (mode === 'native' ? GAME_NODE_SIZE : MAP_NODE_WIDTH))
  const height = dimension(nodeHeight ?? (mode === 'native' ? GAME_NODE_SIZE : MAP_NODE_HEIGHT))
  const centers = new Map<string, MapCenter>()
  const edgePaths = new Map<string, readonly MapCenter[]>()
  const nodes = [...upgrades].sort((left, right) => compareIds(left.id, right.id))
  const visibleIds = new Set(nodes.map((node) => node.id))
  if (visibleIds.size !== nodes.length) throw new Error('Map layout requires unique visible upgrade IDs')
  if (nodes.length === 0) return { centers, edgePaths, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, width: 0, height: 0 }

  if (mode === 'native') {
    for (const node of nodes) {
      if (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) throw new Error('Native map coordinates must be finite')
      centers.set(node.id, Object.freeze({ x: node.position.x, y: -node.position.y }))
    }
    for (const edge of connections) {
      const source = centers.get(edge.from), target = centers.get(edge.to)
      if (!source || !target) continue
      const dx = target.x - source.x, dy = target.y - source.y
      // Native lines run between circular frame centers, behind the icons.
      // Trim along that same ray so selected arrowheads end at the frame.
      const distance = Math.hypot(dx / (width / 2), dy / (height / 2))
      const inset = distance > 0 ? Math.min(1 / distance, 0.5) : 0
      edgePaths.set(`${edge.from}:${edge.to}`, Object.freeze([
        Object.freeze({ x: source.x + dx * inset, y: source.y + dy * inset }),
        Object.freeze({ x: target.x - dx * inset, y: target.y - dy * inset }),
      ]))
    }
  } else {
    const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ directed: true })
    graph.setGraph({ rankdir: 'LR', ranker: 'network-simplex', ranksep: WEB_RANK_GAP, nodesep: WEB_NODE_GAP, edgesep: 24 })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const node of nodes) graph.setNode(node.id, { width, height })

    // A dangling edge must not let Graph.setEdge implicitly create a hidden
    // node. Deduplication also keeps duplicate connections from changing ranks.
    const edges = new Map<string, { from: string; to: string }>()
    for (const edge of connections) {
      if (visibleIds.has(edge.from) && visibleIds.has(edge.to)) edges.set(JSON.stringify([edge.from, edge.to]), edge)
    }
    const orderedEdges = [...edges.values()].sort((left, right) => compareIds(left.from, right.from) || compareIds(left.to, right.to))
    for (const edge of orderedEdges) {
      graph.setEdge(edge.from, edge.to)
    }
    layout(graph)
    for (const node of nodes) {
      const placed = graph.node(node.id)
      if (!placed || !Number.isFinite(placed.x) || !Number.isFinite(placed.y)) throw new Error('Web map layout could not place a visible upgrade')
      centers.set(node.id, Object.freeze({ x: placed.x!, y: placed.y! }))
    }
    for (const edge of orderedEdges) {
      const routed = graph.edge(edge.from, edge.to)?.points
      if (!routed || routed.length < 2 || routed.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Web map layout could not route a visible connection')
      const source = centers.get(edge.from)!, target = centers.get(edge.to)!
      // Dagre's rectangle intersections can leave through a top/bottom corner
      // on steep branches. Match the renderer's right-out/left-in handles while
      // preserving its intermediate corridors around other ranks' cards.
      edgePaths.set(`${edge.from}:${edge.to}`, Object.freeze([
        Object.freeze({ x: source.x + width / 2, y: source.y }),
        ...routed.slice(1, -1).map((point) => Object.freeze({ x: point.x, y: point.y })),
        Object.freeze({ x: target.x - width / 2, y: target.y }),
      ]))
    }
  }

  const points = [...centers.values()]
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)) - width / 2,
    minY: Math.min(...points.map((point) => point.y)) - height / 2,
    maxX: Math.max(...points.map((point) => point.x)) + width / 2,
    maxY: Math.max(...points.map((point) => point.y)) + height / 2,
  }
  return { centers, edgePaths, bounds, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }
}
