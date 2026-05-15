import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import { layoutTemplate } from './template-canvas/layout'
import { useTheme } from '../theme/ThemeProvider'

export interface TemplateCanvasProps {
  template: WorkflowTemplate
  onDirtyChange: (dirty: boolean) => void
  onPositionsChange: (overrides: Record<string, NodePosition>) => void
  /** Parent increments this to ask the canvas to drop in-flight overrides. */
  saveSignal: number
}

function buildInitialNodes(
  template: WorkflowTemplate,
  baseLayout: Record<string, NodePosition>,
): Node[] {
  return template.nodes.map((n) => {
    const style = nodeStyleFor(n)
    return {
      id: n.id,
      position: baseLayout[n.id] ?? { x: 0, y: 0 },
      data: { label: style.label },
      style: {
        padding: 8,
        border: `2px solid ${style.border}`,
        borderRadius: 6,
        fontSize: 12,
        whiteSpace: 'pre-line',
        minWidth: 120,
        textAlign: 'center',
      },
    }
  })
}

export function diffPositions(
  nodes: Node[],
  base: Record<string, NodePosition>,
): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {}
  for (const n of nodes) {
    const b = base[n.id]
    if (!b) continue
    if (n.position.x !== b.x || n.position.y !== b.y) {
      out[n.id] = { x: n.position.x, y: n.position.y }
    }
  }
  return out
}

export default function TemplateCanvas({
  template,
  onDirtyChange,
  onPositionsChange,
  saveSignal,
}: TemplateCanvasProps) {
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const initialNodes = useMemo(
    () => buildInitialNodes(template, baseLayout),
    [template, baseLayout],
  )
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const { resolved } = useTheme()

  // template switch / Save / Reset all reset nodes to initial
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, saveSignal, setNodes])

  const edges = useMemo<Edge[]>(
    () =>
      template.edges.map((e, i) => {
        const style = edgeStyleFor(e.type)
        return {
          id: `${e.from}-${e.to}-${i}`,
          source: e.from,
          target: e.to,
          label: style.label,
          animated: style.animated,
          style: { stroke: style.stroke, strokeWidth: 2 },
          labelStyle: { fontSize: 10, fill: style.stroke },
        }
      }),
    [template],
  )

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const onNodeDragStop = useCallback(() => {
    const overrides = diffPositions(nodes, baseLayout)
    onPositionsChange(overrides)
    onDirtyChange(Object.keys(overrides).length > 0)
  }, [nodes, baseLayout, onPositionsChange, onDirtyChange])

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        fitView
        nodesDraggable={true}
        nodesConnectable={false}
      >
        <Background color={dotColor} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
