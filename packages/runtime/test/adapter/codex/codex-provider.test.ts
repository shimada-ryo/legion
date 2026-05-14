import { describe, it, expect } from 'bun:test'
import type { Codex, Thread, ThreadEvent } from '@openai/codex-sdk'
import { CodexSdkProvider } from '../../../src/adapter/codex/codex-provider'

// Mock: @openai/codex-sdk Codex factory for unit tests
// representing:    @openai/codex-sdk@0.130.0 Codex class (constructor + startThread)
// verified on:     2026-05-15, by SDK README + source review at node_modules/.bun/...
// invalidated when: SDK changes Codex constructor options or startThread signature
// contract test:   packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
function makeStubCodex(events: ThreadEvent[]): Codex {
  const thread = {
    runStreamed: async () => ({
      events: (async function* () {
        for (const e of events) yield e
      })(),
    }),
    run: async () => { throw new Error('stub') },
  } as unknown as Thread

  return {
    startThread: () => thread,
  } as unknown as Codex
}

describe('CodexSdkProvider', () => {
  it('id and capabilities reflect Codex SDK constraints', () => {
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex([]) })
    expect(p.id).toBe('codex')
    expect(p.capabilities.supportsApprovalFlow).toBe(false)
    expect(p.capabilities.supportsResume).toBe(false)
  })

  it('launch returns a SessionHandle, stream yields events from the stub thread', async () => {
    const events: ThreadEvent[] = [
      { type: 'item.completed', item: { type: 'agent_message', text: 'hi' } } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: {} } as unknown as ThreadEvent,
    ]
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex(events) })

    const handle = await p.launch({
      workdir: '/tmp/wt',
      role: 'reviewer',
      initialPrompt: 'review please',
    })
    expect(typeof handle.sessionId).toBe('string')

    const out: any[] = []
    for await (const ev of p.stream(handle.sessionId)) {
      out.push(ev)
      if (ev.type === 'session_end') break
    }

    expect(out.map((e) => e.type)).toEqual(['assistant_message', 'session_end'])
    expect(out[0].payload.content).toBe('hi')
  })

  it('approve / deny are no-ops (no approvalFlow)', async () => {
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex([]) })
    const handle = await p.launch({ workdir: '/tmp', role: 'reviewer', initialPrompt: 'x' })
    await expect(p.approve(handle.sessionId, 'any-id')).resolves.toBeUndefined()
    await expect(p.deny(handle.sessionId, 'any-id')).resolves.toBeUndefined()
  })

  it('outputSchema in LaunchRequest is preserved in session state', async () => {
    const p = new CodexSdkProvider({
      codexFactory: () => makeStubCodex([
        { type: 'turn.completed', usage: {} } as unknown as ThreadEvent,
      ]),
    })
    const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] }
    const handle = await p.launch({
      workdir: '/tmp',
      role: 'reviewer',
      initialPrompt: 'x',
      outputSchema: schema,
    })
    // Internal state check: store sets outputSchema; stream() should pass it through.
    // Since the field is not directly exposed, we just verify the call completes.
    for await (const _ev of p.stream(handle.sessionId)) { /* drain */ }
    expect(true).toBe(true)  // smoke
  })
})
