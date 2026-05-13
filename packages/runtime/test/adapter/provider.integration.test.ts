import { describe, test, expect } from 'bun:test'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'

const HAS_KEY = !!process.env['ANTHROPIC_API_KEY']

describe.skipIf(!HAS_KEY)('ClaudeCodeAgentSDKProvider integration', () => {
  test(
    'launch + stream yields at least one event when given a tiny prompt',
    async () => {
      const provider = new ClaudeCodeAgentSDKProvider({ query: query as any })
      const h = await provider.launch({
        workdir: process.cwd(),
        role: 'implementer',
        initialPrompt: 'Reply with the single word "ok" and stop.',
        model: 'claude-haiku-4-5-20251001', // cheapest for CI
      })
      let count = 0
      for await (const _e of provider.stream(h.sessionId)) {
        count++
        if (count > 20) break // guard against runaway
      }
      expect(count).toBeGreaterThan(0)
    },
    { timeout: 60_000 }, // network calls
  )
})
