import { describe, test, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import OverviewTab from '../../src/components/sidebar-tabs/OverviewTab'
import type { WorkflowTemplate } from '@legion/core'
import type { AgentInstanceView } from '../../src/types'

const TEMPLATE: WorkflowTemplate = {
  id: 't',
  name: 'T',
  nodes: [
    { type: 'role', id: 'director', role: 'director', provider: 'claude-code', lifetime: 'per-workflow' },
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
  ],
  edges: [{ from: 'director', to: 'implementer', type: 'delegates' }],
}

const AGENTS: AgentInstanceView[] = [
  { id: 'dir-1', roleNodeId: 'director', workflowInstanceId: 'wf', sessionId: 'sess-d', status: 'completed', workspace: { kind: 'owned', path: '/d' }, startedAt: '', endedAt: '' },
  { id: 'impl-1', roleNodeId: 'implementer', workflowInstanceId: 'wf', sessionId: 'sess-i', status: 'completed', parentAgentInstanceId: 'dir-1', spawnEdgeId: 'director→implementer', workspace: { kind: 'owned', path: '/i' }, branchName: 'legion/x/impl-1', startedAt: '', endedAt: '' },
]

afterEach(() => cleanup())

describe('OverviewTab parent/children section', () => {
  test('shows "Spawned by Director" for an Implementer selection', () => {
    const { container } = render(
      <OverviewTab template={TEMPLATE} selectedNodeId="implementer" agentInstances={AGENTS} />,
    )
    expect(container.textContent).toMatch(/Spawned by/i)
    expect(container.textContent).toContain('director')
  })

  test('shows "Spawned" listing for the Director selection', () => {
    const { container } = render(
      <OverviewTab template={TEMPLATE} selectedNodeId="director" agentInstances={AGENTS} />,
    )
    expect(container.textContent).toMatch(/Spawned/i)
    expect(container.textContent).toContain('impl-1')
  })

  test('renders without parent/children section when no agent_instance matches', () => {
    const { container } = render(
      <OverviewTab template={TEMPLATE} selectedNodeId="implementer" agentInstances={[]} />,
    )
    expect(container.textContent).not.toMatch(/Spawned/i)
  })
})
