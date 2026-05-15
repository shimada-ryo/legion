import type { ReactNode } from 'react'
import { describe, test, expect, afterEach, beforeEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import CanvasOverlay from '../../src/components/CanvasOverlay'
import { ThemeProvider } from '../../src/theme/ThemeProvider'
import type { WorkflowTemplate } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../../src/types'

beforeEach(() => {
  ;(window as any).matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })
})

afterEach(() => {
  cleanup()
})

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

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
    const { container } = renderWithTheme(
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
    const { container } = renderWithTheme(
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
    const { container } = renderWithTheme(
      <CanvasOverlay template={TEMPLATE} agentInstances={instances} onSelectNode={() => {}} />,
    )
    const node = container.querySelector('[data-id="implementer"]') as HTMLElement | null
    expect(node?.getAttribute('data-status') ?? node?.querySelector('[data-status]')?.getAttribute('data-status')).toBe('completed')
  })
})

describe('CanvasOverlay reviewer retry overlay', () => {
  const reviewers: AgentInstanceView[] = [
    {
      id: 'rev-1', roleNodeId: 'reviewer', workflowInstanceId: 'wf', sessionId: 's-r1',
      status: 'completed', workspace: { kind: 'owned', path: '/r1' },
      startedAt: '2026-05-15T00:00:01Z', endedAt: '2026-05-15T00:00:02Z',
    },
    {
      id: 'rev-2', roleNodeId: 'reviewer', workflowInstanceId: 'wf', sessionId: 's-r2',
      status: 'completed', workspace: { kind: 'owned', path: '/r2' },
      startedAt: '2026-05-15T00:00:03Z', endedAt: '2026-05-15T00:00:04Z',
    },
  ]
  const decisions: BlackboardMessage[] = [
    {
      id: 'm1', workflowInstanceId: 'wf', topic: 'system.review.decision',
      publisherAgentId: null, publishedAt: 100,
      payload: { agentInstanceId: 'rev-1', decision: 'request-changes' },
    },
    {
      id: 'm2', workflowInstanceId: 'wf', topic: 'system.review.decision',
      publisherAgentId: null, publishedAt: 200,
      payload: { agentInstanceId: 'rev-2', decision: 'approve' },
    },
  ]

  test('reviewer node shows ×N runs and the latest decision chip', () => {
    const { container } = renderWithTheme(
      <CanvasOverlay
        template={TEMPLATE}
        agentInstances={reviewers}
        blackboardMessages={decisions}
        onSelectNode={() => {}}
      />,
    )
    const node = container.querySelector('[data-id="reviewer"]') as HTMLElement | null
    expect(node).not.toBeNull()
    expect(node!.getAttribute('data-runs') ?? node!.querySelector('[data-runs]')?.getAttribute('data-runs')).toBe('2')
    expect(node!.querySelector('[data-last-decision]')?.getAttribute('data-last-decision')).toBe('approve')
  })

  test('non-reviewer roles never get a decision chip even with one instance', () => {
    const oneImpl: AgentInstanceView = {
      id: 'i1', roleNodeId: 'implementer', workflowInstanceId: 'wf', sessionId: 's-i',
      status: 'completed', workspace: { kind: 'owned', path: '/i' },
      startedAt: '', endedAt: '',
    }
    const { container } = renderWithTheme(
      <CanvasOverlay
        template={TEMPLATE}
        agentInstances={[oneImpl]}
        blackboardMessages={decisions}
        onSelectNode={() => {}}
      />,
    )
    const impl = container.querySelector('[data-id="implementer"]') as HTMLElement | null
    expect(impl).not.toBeNull()
    expect(impl!.querySelector('[data-last-decision]')).toBeNull()
    // ×N runs only renders when count > 1
    expect(impl!.querySelector('[data-runs]')).toBeNull()
  })
})
