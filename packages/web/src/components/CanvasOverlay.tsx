import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, TemplateNode } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../types'
import { useTheme } from '../theme/ThemeProvider'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  agentInstances: AgentInstanceView[]
  onSelectNode: (id: string | null) => void
  blackboardMessages?: BlackboardMessage[]
}

const NODE_BORDER: Record<TemplateNode['type'], string> = {
  trigger: '#888',
  role: '#0066cc',
  blackboard: '#aa00aa',
  'human-gate': '#cc8800',
  sink: '#444',
}

const STATUS_BG: Record<string, string> = {
  starting: 'var(--node-bg-running)',
  running: 'var(--node-bg-running)',
  completed: 'var(--node-bg-success)',
  failed: 'var(--node-bg-error)',
}

function mergeStatus(a: string | undefined, b: string): string {
  // running beats everything; failed beats completed; completed beats nothing.
  if (a === 'running' || b === 'running' || a === 'starting' || b === 'starting') return 'running'
  if (a === 'failed' || b === 'failed') return 'failed'
  if (a === 'completed' || b === 'completed') return 'completed'
  return b
}

function deriveRoleStatus(instances: AgentInstanceView[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const ai of instances) {
    m.set(ai.roleNodeId, mergeStatus(m.get(ai.roleNodeId), ai.status))
  }
  return m
}

function deriveRoleCount(instances: AgentInstanceView[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const ai of instances) {
    m.set(ai.roleNodeId, (m.get(ai.roleNodeId) ?? 0) + 1)
  }
  return m
}

/**
 * For each reviewer role node, find the latest `system.review.decision`
 * Blackboard message that targets one of its agent_instances. Used as an
 * at-a-glance retry indicator on the canvas.
 */
function deriveReviewerLastDecision(
  template: WorkflowTemplate,
  instances: AgentInstanceView[],
  messages: BlackboardMessage[],
): Map<string, string> {
  const m = new Map<string, string>()
  for (const node of template.nodes) {
    if (node.type !== 'role' || node.role !== 'reviewer') continue
    const myIds = new Set(instances.filter((a) => a.roleNodeId === node.id).map((a) => a.id))
    if (myIds.size === 0) continue
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      if (msg.topic !== 'system.review.decision') continue
      const p = msg.payload as { agentInstanceId?: unknown; decision?: unknown }
      if (typeof p.decision !== 'string') continue
      if (typeof p.agentInstanceId === 'string' && myIds.has(p.agentInstanceId)) {
        m.set(node.id, p.decision)
        break
      }
    }
  }
  return m
}

function decisionChipColors(decision: string): { bg: string; fg: string } {
  if (decision === 'approve') return { bg: 'var(--status-success)', fg: '#fff' }
  if (decision === 'request-changes') return { bg: 'var(--status-warning)', fg: '#000' }
  if (decision === 'reject') return { bg: 'var(--status-error)', fg: '#fff' }
  return { bg: 'var(--fg-subtle)', fg: '#fff' }
}

interface StatusNodeData extends Record<string, unknown> {
  label: string
  status: string | null
  borderColor: string
  count: number
  lastDecision: string | null
}

/**
 * Custom node renderer that exposes data-status on the wrapper div so tests
 * (and future automation) can assert role coloring without parsing inline styles.
 */
function StatusNode({ data }: NodeProps<Node<StatusNodeData>>) {
  const bg = data.status ? (STATUS_BG[data.status] ?? 'var(--node-bg)') : 'var(--node-bg)'
  const chip = data.lastDecision ? decisionChipColors(data.lastDecision) : null
  return (
    <div
      data-status={data.status ?? undefined}
      style={{
        padding: 8,
        background: bg,
        color: 'var(--fg-primary)',
        border: `2px solid ${data.borderColor}`,
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'pre-line',
      }}
    >
      <Handle type="target" position={Position.Top} />
      {data.label}
      {data.count > 1 && (
        <div
          data-runs={data.count}
          style={{ marginTop: 4, fontSize: 11, color: 'var(--fg-muted)' }}
        >
          ×{data.count} runs
        </div>
      )}
      {chip && data.lastDecision && (
        <div style={{ marginTop: 4 }}>
          <span
            data-last-decision={data.lastDecision}
            style={{
              display: 'inline-block',
              padding: '1px 8px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 600,
              background: chip.bg,
              color: chip.fg,
            }}
          >
            {data.lastDecision}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const NODE_TYPES = { statusNode: StatusNode }

export default function CanvasOverlay({
  template,
  agentInstances,
  onSelectNode,
  blackboardMessages = [],
}: CanvasOverlayProps) {
  const roleStatus = useMemo(() => deriveRoleStatus(agentInstances), [agentInstances])
  const roleCount = useMemo(() => deriveRoleCount(agentInstances), [agentInstances])
  const reviewerLastDecision = useMemo(
    () => deriveReviewerLastDecision(template, agentInstances, blackboardMessages),
    [template, agentInstances, blackboardMessages],
  )
  const { resolved } = useTheme()

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n, i) => {
        const status = n.type === 'role' ? roleStatus.get(n.id) : undefined
        return {
          id: n.id,
          type: 'statusNode',
          position: { x: (i % 4) * 180, y: Math.floor(i / 4) * 100 },
          data: {
            label: `${n.id}\n(${n.type})`,
            status: status ?? null,
            borderColor: NODE_BORDER[n.type] ?? '#888',
            count: roleCount.get(n.id) ?? 0,
            lastDecision: reviewerLastDecision.get(n.id) ?? null,
          },
        }
      }),
    [template, roleStatus, roleCount, reviewerLastDecision],
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
        nodeTypes={NODE_TYPES}
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
      >
        <Background color={dotColor} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
