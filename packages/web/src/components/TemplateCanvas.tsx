import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate, NodePosition } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import {
  layoutTemplate,
  applyPositionChanges,
} from './template-canvas/layout'
import { useTheme } from '../theme/ThemeProvider'

export interface TemplateCanvasProps {
  template: WorkflowTemplate
  onDirtyChange: (dirty: boolean) => void
  onPositionsChange: (overrides: Record<string, NodePosition>) => void
  /** Parent increments this to ask the canvas to drop in-flight overrides. */
  saveSignal: number
}

export default function TemplateCanvas({
  template,
  onDirtyChange,
  onPositionsChange,
  saveSignal,
}: TemplateCanvasProps) {
  const baseLayout = useMemo(() => layoutTemplate(template), [template])
  const [overrides, setOverrides] = useState<Record<string, NodePosition>>({})
  const { resolved } = useTheme()

  useEffect(() => { setOverrides({}) }, [template.id])
  useEffect(() => { setOverrides({}) }, [saveSignal])
  useEffect(() => { onDirtyChange(Object.keys(overrides).length > 0) }, [overrides, onDirtyChange])
  useEffect(() => { onPositionsChange(overrides) }, [overrides, onPositionsChange])

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n) => {
        const style = nodeStyleFor(n)
        const pos = overrides[n.id] ?? baseLayout[n.id] ?? { x: 0, y: 0 }
        return {
          id: n.id,
          position: pos,
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
      }),
    [template, baseLayout, overrides],
  )

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

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setOverrides((prev) => applyPositionChanges(prev, changes, baseLayout))
    },
    [baseLayout],
  )

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
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
