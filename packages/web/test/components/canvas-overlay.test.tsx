import { describe, test, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import CanvasOverlay from '../../src/components/CanvasOverlay'
import type { WorkflowTemplate } from '@legion/core'
import type { AgentInstanceView } from '../../src/types'

afterEach(() => {
  cleanup()
})

const TEMPLATE: WorkflowTemplate = {
  id: 't',
  name: 'T',
  nodes: [
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
    { type: 'role', id: 'reviewer', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
  ],
  edges: [],
}

describe('CanvasOverlay status coloring', () => {
  test('renders a node for every template node', () => {
    const instances: AgentInstanceView[] = []
    const { container } = render(
      <CanvasOverlay template={TEMPLATE} agentInstances={instances} onSelectNode={() => {}} />,
    )
    expect(container.querySelectorAll('[data-id="director"]').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('[data-id="implementer"]').length).toBeGreaterThan(0)
  })

  test('role with a running agent gets the running color marker', () => {
    const instances: AgentInstanceView[] = [
      {
        id: 'a1', roleNodeId: 'director', workflowInstanceId: 'wf', sessionId: 's1',
        status: 'running', workspace: { kind: 'owned', path: '/x' },
        startedAt: '', endedAt: null,
      },
    ]
    const { container } = render(
      <CanvasOverlay template={TEMPLATE} agentInstances={instances} onSelectNode={() => {}} />,
    )
    const node = container.querySelector('[data-id="director"]') as HTMLElement | null
    expect(node?.getAttribute('data-status') ?? node?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('running')
  })

  test('role with a completed agent gets the completed marker', () => {
    const instances: AgentInstanceView[] = [
      {
        id: 'a1', roleNodeId: 'implementer', workflowInstanceId: 'wf', sessionId: 's1',
        status: 'completed', workspace: { kind: 'owned', path: '/x' },
        startedAt: '', endedAt: '',
      },
    ]
    const { container } = render(
      <CanvasOverlay template={TEMPLATE} agentInstances={instances} onSelectNode={() => {}} />,
    )
    const node = container.querySelector('[data-id="implementer"]') as HTMLElement | null
    expect(node?.getAttribute('data-status') ?? node?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('completed')
  })
})
