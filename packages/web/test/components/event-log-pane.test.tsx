import { describe, test, expect, afterEach } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import EventLogPane from '../../src/components/EventLogPane'
import type { AgentEvent } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../../src/types'

const EVENTS: AgentEvent[] = [
  { id: 'e1', sessionId: 'sess-dir', type: 'message', payload: { text: 'D' }, timestamp: new Date() },
  { id: 'e2', sessionId: 'sess-impl', type: 'message', payload: { text: 'I' }, timestamp: new Date() },
]

const AGENTS: AgentInstanceView[] = [
  { id: 'a1', roleNodeId: 'director', workflowInstanceId: 'wf', sessionId: 'sess-dir', status: 'completed', workspace: { kind: 'owned', path: '/x' }, startedAt: '', endedAt: '' },
  { id: 'a2', roleNodeId: 'implementer', workflowInstanceId: 'wf', sessionId: 'sess-impl', status: 'completed', workspace: { kind: 'owned', path: '/y' }, startedAt: '', endedAt: '' },
]

afterEach(() => cleanup())

describe('EventLogPane agent filter', () => {
  test('renders all events by default', () => {
    const { container } = render(
      <EventLogPane events={EVENTS} agentInstances={AGENTS} />,
    )
    expect(container.textContent).toContain('D')
    expect(container.textContent).toContain('I')
  })

  test('clicking the Director filter hides Implementer events', () => {
    const { container, getByRole } = render(
      <EventLogPane events={EVENTS} agentInstances={AGENTS} />,
    )
    fireEvent.click(getByRole('button', { name: /director/i }))
    expect(container.textContent).toContain('D')
    expect(container.textContent).not.toContain('I')
  })
})

describe('EventLogPane Blackboard overlay (Phase 3)', () => {
  const BB: BlackboardMessage[] = [
    {
      id: 'b1',
      workflowInstanceId: 'wf',
      topic: 'system.review.decision',
      publisherAgentId: null,
      payload: { decision: 'approve' },
      publishedAt: Date.now(),
    },
  ]

  test('hides blackboard messages by default', () => {
    const { container } = render(
      <EventLogPane events={EVENTS} agentInstances={AGENTS} blackboardMessages={BB} />,
    )
    expect(container.textContent).not.toContain('system.review.decision')
  })

  test('toggling Blackboard chip surfaces blackboard messages', () => {
    const { container, getByRole } = render(
      <EventLogPane events={EVENTS} agentInstances={AGENTS} blackboardMessages={BB} />,
    )
    fireEvent.click(getByRole('button', { name: /blackboard/i }))
    expect(container.textContent).toContain('system.review.decision')
  })

  test('omits the blackboard chip when no messages are present', () => {
    const { queryByRole } = render(
      <EventLogPane events={EVENTS} agentInstances={AGENTS} blackboardMessages={[]} />,
    )
    expect(queryByRole('button', { name: /blackboard/i })).toBeNull()
  })
})
