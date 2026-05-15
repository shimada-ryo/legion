import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, TemplateNode, NodePosition } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../types'
import { useTheme } from '../theme/ThemeProvider'
import { layoutTemplate } from './template-canvas/layout'

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

// Stable default so the prop's identity doesn't flip on every parent render.
// Without this, `useMemo(..., [blackboardMessages])` would invalidate on each
// render and the data-patch effect below would loop via setNodes.
const EMPTY_MESSAGES: BlackboardMessage[] = []

function buildInitialNodes(
  template: WorkflowTemplate,
  baseLayout: Record<string, NodePosition>,
): Node[] {
  return template.nodes.map((n) => ({
    id: n.id,
    type: 'statusNode',
    position: baseLayout[n.id] ?? { x: 0, y: 0 },
    data: {
      label: `${n.id}\n(${n.type})`,
      status: null,
      borderColor: NODE_BORDER[n.type] ?? '#888',
      count: 0,
      lastDecision: null,
    } satisfies StatusNodeData,
  }))
}

export default function CanvasOverlay({
  template,
  agentInstances,
  onSelectNode,
  blackboardMessages = EMPTY_MESSAGES,
}: CanvasOverlayProps) {
  const roleStatus = useMemo(() => deriveRoleStatus(agentInstances), [agentInstances])
  const roleCount = useMemo(() => deriveRoleCount(agentInstances), [agentInstances])
  const reviewerLastDecision = useMemo(
    () => deriveReviewerLastDecision(template, agentInstances, blackboardMessages),
    [template, agentInstances, blackboardMessages],
  )
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  // initialNodes depends on template/baseLayout only. Live data (status, count,
  // lastDecision) is patched in a separate effect so drag positions are not
  // reset when agent state changes.
  const initialNodes = useMemo(
    () => buildInitialNodes(template, baseLayout),
    [template, baseLayout],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const { resolved } = useTheme()

  // Reset positions on template switch.
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  // Patch live data (status / count / lastDecision) without disturbing
  // positions or object refs for unchanged nodes.
  useEffect(() => {
    setNodes((current) =>
      current.map((cn) => {
        const tn = template.nodes.find((t) => t.id === cn.id)
        if (!tn) return cn
        const newStatus = tn.type === 'role' ? roleStatus.get(cn.id) ?? null : null
        const newCount = roleCount.get(cn.id) ?? 0
        const newLastDecision = reviewerLastDecision.get(cn.id) ?? null
        const oldData = cn.data as StatusNodeData
        if (
          oldData.status === newStatus &&
          oldData.count === newCount &&
          oldData.lastDecision === newLastDecision
        ) {
          return cn
        }
        return {
          ...cn,
          data: {
            ...oldData,
            status: newStatus,
            count: newCount,
            lastDecision: newLastDecision,
          },
        }
      }),
    )
  }, [roleStatus, roleCount, reviewerLastDecision, template, setNodes])

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

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
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        nodesDraggable={true}
        nodesConnectable={false}
        fitView
      >
        <Background color={dotColor} />
        <Controls />
      </ReactFlow>
    </div>
  )
}
