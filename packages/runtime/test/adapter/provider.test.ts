import { describe, test, expect } from 'bun:test'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'

function makeQueryMock(messages: unknown[]) {
  return function mockQuery(_input: unknown): AsyncIterable<unknown> {
    return (async function* () {
      for (const m of messages) yield m
    })()
  }
}

describe('ClaudeCodeAgentSDKProvider.launch', () => {
  test('returns a SessionHandle with a fresh sessionId (ULID shape)', async () => {
    const provider = new ClaudeCodeAgentSDKProvider({ query: makeQueryMock([]) })
    const h = await provider.launch({
      workdir: '/tmp/x',
      role: 'implementer',
      initialPrompt: 'do thing',
    })
    expect(h.sessionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
  })

  test('stream yields converted AgentEvents from the SDK iter', async () => {
    const provider = new ClaudeCodeAgentSDKProvider({
      query: makeQueryMock([
        { type: 'system', subtype: 'init', session_id: 'x', model: 'm' },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
        { type: 'result', subtype: 'success' },
      ]),
    })
    const h = await provider.launch({
      workdir: '/tmp/x',
      role: 'implementer',
      initialPrompt: 'do thing',
    })
    const events: { type: string }[] = []
    for await (const e of provider.stream(h.sessionId)) events.push(e)
    expect(events.map((e) => e.type)).toEqual([
      'status_change',
      'message',
      'status_change',
    ])
  })

  test('capabilities reports supportsApprovalFlow=true and supportsAttach=false', () => {
    const provider = new ClaudeCodeAgentSDKProvider({ query: makeQueryMock([]) })
    expect(provider.capabilities.supportsApprovalFlow).toBe(true)
    expect(provider.capabilities.supportsAttach).toBe(false)
    expect(provider.capabilities.supportsResume).toBe(true)
  })
})
