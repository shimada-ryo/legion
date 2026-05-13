import { ulid } from 'ulid'
import type { AgentEvent } from '@legion/core'

/**
 * Convert an SDK Message to an AgentEvent. Returns null for unrecognized
 * subtypes so callers can skip them (forward compatibility).
 *
 * Typed as `unknown` to avoid coupling to a single SDK version's shape.
 */
export function toAgentEvent(sessionId: string, msg: unknown): AgentEvent | null {
  if (!isObject(msg)) return null
  const type = msg['type']
  if (type === 'assistant' && isObject(msg['message'])) {
    const content = (msg['message'] as { content?: unknown }).content
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0]
      if (isObject(first) && first['type'] === 'text') {
        return event(sessionId, 'message', { text: first['text'] })
      }
      if (isObject(first) && first['type'] === 'tool_use') {
        return event(sessionId, 'tool_call', {
          callId: first['id'],
          name: first['name'],
          input: first['input'],
        })
      }
    }
  }
  if (type === 'user' && isObject(msg['message'])) {
    const content = (msg['message'] as { content?: unknown }).content
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0]
      if (isObject(first) && first['type'] === 'tool_result') {
        return event(sessionId, 'tool_call', {
          callId: first['tool_use_id'],
          kind: 'result',
          result: first['content'],
        })
      }
    }
  }
  if (type === 'system' && msg['subtype'] === 'init') {
    return event(sessionId, 'status_change', { status: 'starting', model: msg['model'] })
  }
  if (type === 'result') {
    const status = msg['subtype'] === 'success' ? 'completed' : 'failed'
    return event(sessionId, 'status_change', { status })
  }
  return null
}

function event(sessionId: string, type: AgentEvent['type'], payload: unknown): AgentEvent {
  return { id: ulid(), sessionId, type, payload, timestamp: new Date() }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
