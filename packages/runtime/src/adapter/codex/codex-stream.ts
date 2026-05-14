import { ulid } from 'ulid'
import type { AgentEvent } from '@legion/core'
import type { CodexSessionStore } from './codex-session-store'
import { debugLog } from '../../util/logger'

export async function* streamCodexSession(
  store: CodexSessionStore,
  sessionId: string,
): AsyncIterable<AgentEvent> {
  const session = store.get(sessionId)
  const turnOpts: { outputSchema?: unknown; signal?: AbortSignal } = {
    signal: session.abort.signal,
  }
  if (session.outputSchema !== undefined) turnOpts.outputSchema = session.outputSchema

  debugLog('codex.stream.start', { sessionId, role: session.role })
  const { events } = await session.thread.runStreamed(session.prompt, turnOpts)

  let rawCount = 0
  let yielded = 0
  for await (const ev of events) {
    rawCount++
    const raw = ev as RawEvent
    const t = raw.type
    const errPreview =
      t === 'error' || t === 'turn.failed'
        ? typeof raw.error === 'string'
          ? raw.error
          : raw.error?.message ?? raw.message
        : undefined
    debugLog('codex.stream.event', { sessionId, rawCount, type: t, ...(errPreview !== undefined ? { error: errPreview } : {}) })
    const translated = translateEvent(raw, sessionId)
    if (translated) {
      yielded++
      yield translated
    }
    if (t === 'turn.completed' || t === 'turn.failed' || t === 'error') {
      break
    }
  }
  debugLog('codex.stream.done', { sessionId, rawCount, yielded })
}

interface RawEvent {
  type: string
  item?: { type: string; text?: string; command?: string; tool?: string; arguments?: unknown }
  error?: { message?: string } | string
  message?: string
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
      // Drop everything else: item.started / item.updated, plus item.completed items of
      // type reasoning / file_change / web_search / todo_list. These are emitted by
      // the SDK but not meaningful for Phase 3 reviewer flows.
      return undefined
    }
    case 'turn.completed':
      return makeEvent(sessionId, 'session_end', { status: 'completed', usage: ev.usage ?? null })
    case 'turn.failed':
      return makeEvent(sessionId, 'session_end', {
        status: 'failed',
        error: extractErrorMessage(ev.error),
      })
    case 'error':
      return makeEvent(sessionId, 'session_end', {
        status: 'failed',
        error: ev.message ?? 'unknown',
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
