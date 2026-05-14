import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../styles/react-flow.css'
import type { WorkflowTemplate } from '@legion/core'
import { nodeStyleFor, edgeStyleFor } from './template-canvas/styling'
import { layoutTemplate } from './template-canvas/layout'
import { useTheme } from '../theme/ThemeProvider'

export default function TemplateCanvas({ template }: { template: WorkflowTemplate }) {
  const positions = useMemo(() => layoutTemplate(template), [template])
  const { resolved } = useTheme()

  const [dotColor, setDotColor] = useState('')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    setDotColor(cs.getPropertyValue('--canvas-grid').trim())
  }, [resolved])

  const nodes = useMemo<Node[]>(
    () =>
      template.nodes.map((n) => {
        const style = nodeStyleFor(n)
        const pos = positions[n.id] ?? { x: 0, y: 0 }
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
    [template, positions],
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

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color={dotColor} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
