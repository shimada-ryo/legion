import { ulid } from 'ulid'
import type { AgentEvent } from '@legion/core'
import type { CodexSessionStore } from './codex-session-store'

export async function* streamCodexSession(
  store: CodexSessionStore,
  sessionId: string,
): AsyncIterable<AgentEvent> {
  const session = store.get(sessionId)
  const turnOpts: { outputSchema?: unknown; signal?: AbortSignal } = {
    signal: session.abort.signal,
  }
  if (session.outputSchema !== undefined) turnOpts.outputSchema = session.outputSchema

  const { events } = await session.thread.runStreamed(session.prompt, turnOpts)

  for await (const ev of events) {
    const translated = translateEvent(ev as RawEvent, sessionId)
    if (translated) yield translated
    const t = (ev as RawEvent).type
    if (t === 'turn.completed' || t === 'turn.failed' || t === 'error') {
      break
    }
  }
}

interface RawEvent {
  type: string
  item?: { type: string; text?: string; command?: string; tool?: string; arguments?: unknown }
  error?: { message?: string } | string
  usage?: unknown
}

function translateEvent(ev: RawEvent, sessionId: string): AgentEvent | undefined {
  switch (ev.type) {
    case 'item.completed': {
      const item = ev.item
      if (!item) return undefined
      if (item.type === 'agent_message') {
        return makeEvent(sessionId, 'assistant_message', { content: item.text ?? '' })
      }
      if (item.type === 'command_execution') {
        return makeEvent(sessionId, 'tool_call', { tool: 'shell', input: item.command ?? null })
      }
      if (item.type === 'mcp_tool_call') {
        return makeEvent(sessionId, 'tool_call', {
          tool: item.tool ?? 'mcp',
          input: item.arguments ?? null,
        })
      }
      // reasoning / file_change / web_search / todo_list are dropped in Phase 3
      return undefined
    }
    case 'turn.completed':
      return makeEvent(sessionId, 'session_end', { status: 'completed', usage: ev.usage ?? null })
    case 'turn.failed':
    case 'error':
      return makeEvent(sessionId, 'session_end', {
        status: 'failed',
        error: extractErrorMessage(ev.error),
      })
    default:
      return undefined
  }
}

function makeEvent(sessionId: string, type: AgentEvent['type'], payload: unknown): AgentEvent {
  return { id: ulid(), sessionId, type, payload, timestamp: new Date() }
}

function extractErrorMessage(err: RawEvent['error']): string {
  if (!err) return 'unknown'
  if (typeof err === 'string') return err
  return err.message ?? 'unknown'
}
