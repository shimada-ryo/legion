import { describe, it, expect } from 'bun:test'
import { ulid } from 'ulid'
import type { Thread, ThreadEvent } from '@openai/codex-sdk'
import { streamCodexSession } from '../../../src/adapter/codex/codex-stream'
import { CodexSessionStore } from '../../../src/adapter/codex/codex-session-store'

// Mock: minimal Thread stub for codex-stream tests
// representing:    @openai/codex-sdk Thread interface (runStreamed return shape)
// verified on:     2026-05-15, by SDK source review (node_modules/.bun/@openai+codex-sdk@0.130.0/.../index.d.ts)
// invalidated when: SDK changes runStreamed return type (currently Promise<{ events: AsyncGenerator<ThreadEvent> }>)
// contract test:   packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
function makeStubThread(events: ThreadEvent[]): Thread {
  return {
    runStreamed: async () => ({
      events: (async function* () {
        for (const e of events) yield e
      })(),
    }),
    run: async () => { throw new Error('stub: run not implemented') },
  } as unknown as Thread
}

function setupSession(
  events: ThreadEvent[],
  role = 'reviewer',
): { store: CodexSessionStore; sessionId: string } {
  const store = new CodexSessionStore()
  const sessionId = ulid()
  store.set({
    sessionId,
    thread: makeStubThread(events),
    prompt: 'test prompt',
    role,
    abort: new AbortController(),
  })
  return { store, sessionId }
}

describe('streamCodexSession', () => {
  it('emits assistant_message for item.completed of type agent_message', async () => {
    // ThreadItem uses `type` field per SDK (AgentMessageItem: { id, type: "agent_message", text })
    const events: ThreadEvent[] = [
      {
        type: 'item.completed',
        item: { id: 'i1', type: 'agent_message', text: 'hello world' },
      } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0 } } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: AgentEventLike[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev as AgentEventLike)
      if (ev.type === 'session_end') break
    }

    const am = out.find((e) => e.type === 'assistant_message')
    expect(am).toBeDefined()
    expect((am!.payload as { content: string }).content).toBe('hello world')

    const end = out.find((e) => e.type === 'session_end')
    expect(end).toBeDefined()
    expect((end!.payload as { status: string }).status).toBe('completed')
  })

  it('emits session_end with status=failed for turn.failed', async () => {
    const events: ThreadEvent[] = [
      {
        type: 'turn.failed',
        error: { message: 'boom' },
      } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: AgentEventLike[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev as AgentEventLike)
    }

    const end = out.find((e) => e.type === 'session_end')
    expect(end).toBeDefined()
    expect((end!.payload as { status: string; error: string }).status).toBe('failed')
    expect((end!.payload as { status: string; error: string }).error).toContain('boom')
  })

  it('drops thread.started / turn.started / reasoning items (internal events)', async () => {
    const events: ThreadEvent[] = [
      { type: 'thread.started', thread_id: 't1' } as unknown as ThreadEvent,
      { type: 'turn.started' } as unknown as ThreadEvent,
      { type: 'item.started', item: { id: 'r1', type: 'reasoning', text: 'thinking' } } as unknown as ThreadEvent,
      {
        type: 'item.completed',
        item: { id: 'i2', type: 'agent_message', text: 'output' },
      } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: AgentEventLike[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev as AgentEventLike)
    }

    // Only assistant_message and session_end should flow
    const types = out.map((e) => e.type)
    expect(types).toEqual(['assistant_message', 'session_end'])
  })
})

interface AgentEventLike {
  type: string
  payload: unknown
}
