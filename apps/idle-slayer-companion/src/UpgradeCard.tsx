import { Handle, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import type { Upgrade } from './domain/types'
import { DependencyEdge } from './DependencyEdge'
import { NativeEdge } from './NativeEdge'

export type UpgradeNode = Node<{ upgrade: Upgrade; state: string }, 'upgrade'>

export function Icon({ node }: { node: Upgrade }) {
  return <img className="upgrade-icon" src={`${import.meta.env.BASE_URL}${node.icon}`} alt="" />
}

export function UpgradeCard({ data }: NodeProps<UpgradeNode>) {
  return <div className={`upgrade-node nopan ${data.state}`}>
    <Handle type="target" position={Position.Top} id="top-in" />
    <Handle type="target" position={Position.Bottom} id="bottom-in" />
    <Handle type="target" position={Position.Left} id="left-in" />
    <Handle type="target" position={Position.Right} id="right-in" />
    <Icon node={data.upgrade} />
    <span className="node-symbol" aria-hidden="true">{data.state === 'purchased' ? '✓' : data.state === 'pending' ? '◷' : data.state === 'available' ? '+' : '◇'}</span>
    <span className="node-title">{data.upgrade.title}</span>
    <Handle type="source" position={Position.Top} id="top-out" />
    <Handle type="source" position={Position.Bottom} id="bottom-out" />
    <Handle type="source" position={Position.Left} id="left-out" />
    <Handle type="source" position={Position.Right} id="right-out" />
  </div>
}
export const nodeTypes = { upgrade: UpgradeCard }
export const edgeTypes = { dependency: DependencyEdge, native: NativeEdge }
