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

describe('ClaudeCodeAgentSDKProvider approval flow', () => {
  test('PreToolUse hook approves in-profile tools immediately without emitting permission_request', async () => {
    let capturedHook: ((input: unknown) => Promise<unknown>) | null = null
    const queryMock = (input: any) => {
      capturedHook = input.options.hooks.PreToolUse[0]
      return (async function* () {})()
    }
    const provider = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const h = await provider.launch({
      workdir: '/tmp/x',
      role: 'implementer',
      initialPrompt: '',
    })
    const res = await capturedHook!({ tool_name: 'Edit', tool_input: { path: '/y' } })
    expect((res as { continue: boolean }).continue).toBe(true)

    // Confirm no permission_request bubbles through stream()
    const events: { type: string }[] = []
    for await (const e of provider.stream(h.sessionId)) events.push(e)
    expect(events.filter((e) => e.type === 'permission_request')).toEqual([])
  })

  test('PreToolUse hook for out-of-profile tool emits permission_request event and is resolved by approve()', async () => {
    let capturedHook: ((input: unknown) => Promise<unknown>) | null = null
    // Use a deferred-resolve to keep the SDK iter alive until we drive the hook
    let finishSdk: () => void = () => {}
    const sdkDone = new Promise<void>((r) => { finishSdk = r })

    const queryMock = (input: any) => {
      capturedHook = input.options.hooks.PreToolUse[0]
      return (async function* () {
        await sdkDone
      })()
    }
    const provider = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const h = await provider.launch({
      workdir: '/tmp/x',
      role: 'director', // director cannot use Edit
      initialPrompt: '',
    })

    // Drive the hook in parallel with consuming the stream
    const hookResultPromise = capturedHook!({ tool_name: 'Edit', tool_input: { path: '/y' } })

    const events: AgentEvent[] = []
    const streamPromise = (async () => {
      for await (const e of provider.stream(h.sessionId)) {
        events.push(e)
        if (e.type === 'permission_request') {
          // Approve via provider API, then finish the SDK iter
          const payload = e.payload as { approvalId: string; tool: string }
          await provider.approve(h.sessionId, payload.approvalId)
          finishSdk()
        }
      }
    })()

    const hookResult = await hookResultPromise
    expect((hookResult as { continue: boolean }).continue).toBe(true)
    await streamPromise

    expect(events.some((e) => e.type === 'permission_request')).toBe(true)
    const permEvt = events.find((e) => e.type === 'permission_request')!
    const payload = permEvt.payload as { approvalId: string; tool: string; input: unknown }
    expect(payload.tool).toBe('Edit')
  })
})

// Type alias used in the second test block
type AgentEvent = { type: string; payload: unknown }
