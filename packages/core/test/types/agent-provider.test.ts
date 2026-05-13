import { describe, test } from 'bun:test'
import type { AgentProvider, AgentCapabilities } from '@legion/core'

// Type-level assertions only. Tests pass iff the file type-checks.
// Run `bun run --filter @legion/core typecheck` to verify.

describe('AgentProvider contract', () => {
  test('a provider that omits attach() compiles', () => {
    // Verify that attach() is optional: a no-attach object must satisfy AgentProvider.
    const _provider = {
      id: 'test',
      displayName: 'Test',
      capabilities: {
        supportsCheckpoint: false,
        supportsResume: false,
        supportsAttach: false,
        supportsApprovalFlow: false,
      },
      detect: async () => ({ installed: true }),
      authenticate: async () => ({ authenticated: false }),
      launch: async () => ({ sessionId: 's' }),
      send: async () => {},
      interrupt: async () => {},
      approve: async () => {},
      deny: async () => {},
      status: async () => ({}),
      stream: async function* () {},
      checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
      resume: async () => ({ sessionId: '' }),
      shutdown: async () => {},
      exportTranscript: async () => ({ sessionId: '', events: [] }),
    } satisfies AgentProvider
    void _provider
  })

  test('capabilities shape is required', () => {
    const _caps: AgentCapabilities = {
      supportsCheckpoint: false,
      supportsResume: false,
      supportsAttach: false,
      supportsApprovalFlow: false,
    }
    void _caps
  })
})
