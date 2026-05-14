import { describe, test, expect, afterEach } from 'bun:test'
import { render, fireEvent, cleanup } from '@testing-library/react'
import EventLogPane from '../../src/components/EventLogPane'
import type { AgentEvent } from '@legion/core'
import type { AgentInstanceView } from '../../src/types'

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
