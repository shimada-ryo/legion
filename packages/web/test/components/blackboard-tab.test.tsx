import { describe, test, expect, afterEach } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import BlackboardTab from '../../src/components/sidebar-tabs/BlackboardTab'
import type { AgentInstanceView, BlackboardMessage } from '../../src/types'

const SAMPLE: BlackboardMessage[] = [
  {
    id: '1',
    workflowInstanceId: 'wf',
    topic: 'system.delegate.start',
    publisherAgentId: null,
    payload: { role: 'implementer' },
    publishedAt: 1000,
  },
  {
    id: '2',
    workflowInstanceId: 'wf',
    topic: 'system.review.decision',
    publisherAgentId: null,
    payload: { decision: 'approve' },
    publishedAt: 2000,
  },
  {
    id: '3',
    workflowInstanceId: 'wf',
    topic: 'user.summary',
    publisherAgentId: 'agent-1',
    payload: { value: 42 },
    publishedAt: 3000,
  },
]

const AGENTS: AgentInstanceView[] = [
  {
    id: 'agent-1',
    roleNodeId: 'reviewer',
    workflowInstanceId: 'wf',
    sessionId: 's',
    status: 'completed',
    workspace: { kind: 'owned', path: '/x' },
    startedAt: '',
    endedAt: '',
  },
]

afterEach(() => cleanup())

describe('BlackboardTab', () => {
  test('renders all messages with topic by default', () => {
    const { container } = render(
      <BlackboardTab blackboardMessages={SAMPLE} agentInstances={AGENTS} />,
    )
    expect(container.textContent).toContain('system.delegate.start')
    expect(container.textContent).toContain('system.review.decision')
    expect(container.textContent).toContain('user.summary')
  })

  test('filtering by system.* hides user-topic messages', () => {
    const { container, getByLabelText } = render(
      <BlackboardTab blackboardMessages={SAMPLE} agentInstances={AGENTS} />,
    )
    fireEvent.click(getByLabelText('filter: system'))
    expect(container.textContent).toContain('system.delegate.start')
    expect(container.textContent).toContain('system.review.decision')
    expect(container.textContent).not.toContain('user.summary')
  })

  test('shows empty state when no messages', () => {
    const { container } = render(
      <BlackboardTab blackboardMessages={[]} agentInstances={AGENTS} />,
    )
    expect(container.textContent).toMatch(/no blackboard messages/i)
  })

  test('clicking a message expands the payload JSON', () => {
    const { container, getByText } = render(
      <BlackboardTab blackboardMessages={SAMPLE} agentInstances={AGENTS} />,
    )
    expect(container.textContent).not.toContain('"decision"')
    fireEvent.click(getByText('system.review.decision'))
    expect(container.textContent).toContain('"decision"')
    expect(container.textContent).toContain('approve')
  })
})
