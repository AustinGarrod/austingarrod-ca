import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react'
import type { MapCenter } from './domain/map-layout'

export type DependencyEdgeData = { points?: readonly MapCenter[] }
export type DependencyEdgeProps = EdgeProps<Edge<DependencyEdgeData, 'dependency'>>

/** Keep every rank corridor while rounding only a small distance at its bends. */
export function dependencyPath(points: readonly MapCenter[], radius = 8): string {
  if (points.length === 0) return ''
  const distinct = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y)
  let path = `M ${distinct[0].x} ${distinct[0].y}`
  for (let index = 1; index < distinct.length - 1; index += 1) {
    const previous = distinct[index - 1], corner = distinct[index], next = distinct[index + 1]
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    const bend = Math.min(radius, incoming / 2, outgoing / 2)
    const cross = (corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x)
    if (bend <= 0 || Math.abs(cross) < 0.001) {
      path += ` L ${corner.x} ${corner.y}`
      continue
    }
    const before = { x: corner.x + (previous.x - corner.x) * bend / incoming, y: corner.y + (previous.y - corner.y) * bend / incoming }
    const after = { x: corner.x + (next.x - corner.x) * bend / outgoing, y: corner.y + (next.y - corner.y) * bend / outgoing }
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`
  }
  if (distinct.length > 1) path += ` L ${distinct.at(-1)!.x} ${distinct.at(-1)!.y}`
  return path
}

export function DependencyEdge({ id, data, sourceX, sourceY, targetX, targetY, style, markerStart, markerEnd, interactionWidth }: DependencyEdgeProps) {
  const points = data?.points
  const routed = [
    { x: sourceX, y: sourceY },
    ...(points?.slice(1, -1) ?? []),
    { x: targetX, y: targetY },
  ]
  return <BaseEdge id={id} path={dependencyPath(routed)} style={style} markerStart={markerStart} markerEnd={markerEnd} interactionWidth={interactionWidth} />
}

export default DependencyEdge
