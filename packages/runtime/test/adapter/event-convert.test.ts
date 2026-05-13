import { describe, test, expect } from 'bun:test'
import { toAgentEvent } from '@legion/runtime/adapter/event-convert'

describe('toAgentEvent', () => {
  const sessionId = 'sess-1'

  test('converts an assistant message to a message event', () => {
    const evt = toAgentEvent(sessionId, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    })
    expect(evt?.type).toBe('message')
    expect((evt?.payload as { text: string }).text).toBe('hello')
    expect(evt?.sessionId).toBe(sessionId)
  })

  test('converts a tool_use to a tool_call event', () => {
    const evt = toAgentEvent(sessionId, {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'Read', input: { path: '/x' } },
        ],
      },
    })
    expect(evt?.type).toBe('tool_call')
    expect((evt?.payload as { name: string; callId: string }).name).toBe('Read')
  })

  test('converts a tool_result to a tool_call (kind=result) event', () => {
    const evt = toAgentEvent(sessionId, {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }],
      },
    })
    expect(evt?.type).toBe('tool_call')
    expect((evt?.payload as { callId: string; kind: string }).callId).toBe('call_1')
    expect((evt?.payload as { kind: string }).kind).toBe('result')
  })

  test('converts a system init to a status_change event', () => {
    const evt = toAgentEvent(sessionId, {
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
      model: 'claude-opus-4-7',
    })
    expect(evt?.type).toBe('status_change')
  })

  test('converts a result message to a completed status_change event', () => {
    const evt = toAgentEvent(sessionId, {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.001,
    })
    expect(evt?.type).toBe('status_change')
    expect((evt?.payload as { status: string }).status).toBe('completed')
  })

  test('returns null for unrecognized message types (forward compat)', () => {
    const evt = toAgentEvent(sessionId, { type: 'unknown-future-type' })
    expect(evt).toBeNull()
  })

  test('each event has a unique id', () => {
    const a = toAgentEvent(sessionId, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'a' }] },
    })
    const b = toAgentEvent(sessionId, {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'b' }] },
    })
    expect(a?.id).toBeDefined()
    expect(a?.id).not.toBe(b?.id)
  })
})
