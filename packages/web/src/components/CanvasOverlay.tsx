import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { WorkflowTemplate, AgentEvent, TemplateNode } from '@legion/core'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  events: AgentEvent[]
  onSelectNode: (id: string | null) => void
}

const NODE_COLORS: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#444',
}

export default function CanvasOverlay({
  template,
  events,
  onSelectNode,
}: CanvasOverlayProps) {
  const activeRoleIds = useMemo(
    () => deriveActiveRoles(template, events),
    [template, events],
  )
  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n, i) => ({
        id: n.id,
        position: { x: (i % 4) * 180, y: Math.floor(i / 4) * 100 },
        data: { label: `${n.id}\n(${n.type})` },
        style: {
          padding: 8,
          background: activeRoleIds.has(n.id) ? '#e8f0ff' : 'white',
          border: `2px solid ${NODE_COLORS[n.type] ?? '#888'}`,
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: 'pre-line',
        },
      })),
    [template, activeRoleIds],
  )
  const edges = useMemo<Edge[]>(
    () =>
      template.edges.map((e, i) => ({
        id: `${e.from}-${e.to}-${i}`,
        source: e.from,
        target: e.to,
        label: e.type,
        labelStyle: { fontSize: 10 },
      })),
    [template],
  )
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

function deriveActiveRoles(
  template: WorkflowTemplate,
  _events: AgentEvent[],
): Set<string> {
  // Phase 1: highlight all role nodes once any event has arrived.
  // Future (Phase 2): map sessionId → roleNodeId via AgentInstance table.
  return new Set(template.nodes.filter((n) => n.type === 'role').map((n) => n.id))
}
