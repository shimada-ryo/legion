import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface CanvasOverlayProps {
  template: WorkflowTemplate
  events: AgentEvent[]
  onSelectNode: (id: string | null) => void
}

export default function CanvasOverlay(props: CanvasOverlayProps) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontSize: 12, color: '#666' }}>
        Canvas (Task 6 で React Flow に置換)
      </div>
      <ul>
        {props.template.nodes.map((n) => (
          <li key={n.id}>
            <button onClick={() => props.onSelectNode(n.id)}>
              {n.id} ({n.type})
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
