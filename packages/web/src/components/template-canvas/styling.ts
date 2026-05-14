import type { TemplateNode, EdgeType } from '@legion/core'

export interface NodeStyle {
  border: string
  label: string
  shape?: 'rect' | 'diamond' | 'parallelogram'
}

const TYPE_BORDER: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#666',
}

export function nodeStyleFor(node: TemplateNode): NodeStyle {
  const border = TYPE_BORDER[node.type]
  let label = `${node.id}`
  if (node.type === 'role') label = `${node.role}\n(${node.lifetime})`
  if (node.type === 'trigger') label = `${node.id} (${node.kind})`
  if (node.type === 'blackboard') label = `📋 ${node.id}`
  if (node.type === 'human-gate') label = `🙋 ${node.label}`
  if (node.type === 'sink') label = `${node.id} (${node.kind})`
  return { border, label }
}

export interface EdgeStyle {
  stroke: string
  animated: boolean
  label: string
}

const EDGE_COLOR: Record<EdgeType, string> = {
  triggers: '#0066cc',
  delegates: '#00aa66',
  publishes: '#aa00aa',
  subscribes: '#7700aa',
  reviews: '#cc6600',
  synthesizes: '#cc0066',
}

export function edgeStyleFor(type: EdgeType): EdgeStyle {
  return {
    stroke: EDGE_COLOR[type] ?? '#999',
    animated: type === 'triggers',
    label: type,
  }
}
