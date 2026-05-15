import { describe, test, expect, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import OverviewTab from '../../src/components/sidebar-tabs/OverviewTab'
import type { WorkflowTemplate } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../../src/types'

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

const REVIEW_TEMPLATE: WorkflowTemplate = {
  id: 'r',
  name: 'R',
  nodes: [
    { type: 'role', id: 'implementer', role: 'implementer', provider: 'claude-code', lifetime: 'per-task' },
    { type: 'role', id: 'reviewer', role: 'reviewer', provider: 'codex', lifetime: 'per-task' },
  ],
  edges: [{ from: 'implementer', to: 'reviewer', type: 'reviews' }],
}

const REVIEWER_AGENT: AgentInstanceView = {
  id: 'rev-1',
  roleNodeId: 'reviewer',
  workflowInstanceId: 'wf',
  sessionId: 'sess-r',
  status: 'completed',
  parentAgentInstanceId: 'impl-1',
  spawnEdgeId: 'implementer→reviewer',
  workspace: { kind: 'owned', path: '/r' },
  startedAt: '',
  endedAt: '',
}

const IMPL_AGENT: AgentInstanceView = {
  id: 'impl-1',
  roleNodeId: 'implementer',
  workflowInstanceId: 'wf',
  sessionId: 'sess-i',
  status: 'completed',
  workspace: { kind: 'owned', path: '/i' },
  branchName: 'legion/x/impl-1',
  startedAt: '',
  endedAt: '',
}

describe('OverviewTab retry surfacing (#N of M + decision chip)', () => {
  const makeRev = (id: string, startedAt: string, status = 'completed'): AgentInstanceView => ({
    id,
    roleNodeId: 'reviewer',
    workflowInstanceId: 'wf',
    sessionId: `sess-${id}`,
    status,
    parentAgentInstanceId: 'impl-1',
    spawnEdgeId: 'implementer→reviewer',
    workspace: { kind: 'owned', path: '/r' },
    startedAt,
    endedAt: '',
  })

  test('renders Run #1 of 2 / Run #2 of 2 with the matching decision chips', () => {
    const messages: BlackboardMessage[] = [
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
    const { container } = render(
      <OverviewTab
        template={REVIEW_TEMPLATE}
        selectedNodeId="reviewer"
        agentInstances={[makeRev('rev-2', '2026-05-15T00:00:02Z'), makeRev('rev-1', '2026-05-15T00:00:01Z')]}
        blackboardMessages={messages}
      />,
    )
    expect(container.textContent).toContain('Run #1 of 2')
    expect(container.textContent).toContain('Run #2 of 2')
    // Each Run renders the decision twice (header chip + detail row), so the
    // four data-decision elements appear in the order
    // [run1 chip, run1 detail, run2 chip, run2 detail].
    const decoratedDecisions = Array.from(container.querySelectorAll('[data-decision]'))
      .map((el) => el.getAttribute('data-decision'))
      .filter((d): d is string => Boolean(d))
    expect(decoratedDecisions).toEqual([
      'request-changes', 'request-changes',
      'approve', 'approve',
    ])
  })

  test('shows Run #1 of 1 (no chip) for a non-reviewer role with one instance', () => {
    const { container } = render(
      <OverviewTab
        template={REVIEW_TEMPLATE}
        selectedNodeId="implementer"
        agentInstances={[IMPL_AGENT]}
        blackboardMessages={[]}
      />,
    )
    expect(container.textContent).toContain('Run #1 of 1')
    expect(container.querySelector('[data-decision]')).toBeNull()
  })
})

describe('OverviewTab Reviewer decision (Phase 3)', () => {
  test('shows Reviewer decision and feedback for a reviewer node', () => {
    const messages: BlackboardMessage[] = [
      {
        id: 'm1',
        workflowInstanceId: 'wf',
        topic: 'system.review.decision',
        publisherAgentId: null,
        payload: { agentInstanceId: 'rev-1', decision: 'request-changes', feedback: 'rename foo' },
        publishedAt: 100,
      },
    ]
    const { container } = render(
      <OverviewTab
        template={REVIEW_TEMPLATE}
        selectedNodeId="reviewer"
        agentInstances={[REVIEWER_AGENT, IMPL_AGENT]}
        blackboardMessages={messages}
      />,
    )
    expect(container.textContent).toMatch(/Decision/i)
    expect(container.textContent).toContain('request-changes')
    expect(container.textContent).toContain('rename foo')
  })

  test('omits Decision section for non-reviewer roles', () => {
    const messages: BlackboardMessage[] = [
      {
        id: 'm1',
        workflowInstanceId: 'wf',
        topic: 'system.review.decision',
        publisherAgentId: null,
        payload: { agentInstanceId: 'rev-1', decision: 'approve' },
        publishedAt: 100,
      },
    ]
    const { container } = render(
      <OverviewTab
        template={REVIEW_TEMPLATE}
        selectedNodeId="implementer"
        agentInstances={[REVIEWER_AGENT, IMPL_AGENT]}
        blackboardMessages={messages}
      />,
    )
    expect(container.textContent).not.toMatch(/Decision/i)
  })

  test('uses the latest decision when multiple are published for the same reviewer', () => {
    const messages: BlackboardMessage[] = [
      {
        id: 'm1',
        workflowInstanceId: 'wf',
        topic: 'system.review.decision',
        publisherAgentId: null,
        payload: { agentInstanceId: 'rev-1', decision: 'request-changes', feedback: 'first round' },
        publishedAt: 100,
      },
      {
        id: 'm2',
        workflowInstanceId: 'wf',
        topic: 'system.review.decision',
        publisherAgentId: null,
        payload: { agentInstanceId: 'rev-1', decision: 'approve' },
        publishedAt: 200,
      },
    ]
    const { container } = render(
      <OverviewTab
        template={REVIEW_TEMPLATE}
        selectedNodeId="reviewer"
        agentInstances={[REVIEWER_AGENT, IMPL_AGENT]}
        blackboardMessages={messages}
      />,
    )
    expect(container.textContent).toContain('approve')
    expect(container.textContent).not.toContain('first round')
  })
})
