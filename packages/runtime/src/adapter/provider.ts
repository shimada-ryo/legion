import type {
  AgentProvider,
  AgentEvent,
  LaunchRequest,
  SessionHandle,
  SendOptions,
  AuthStatus,
  ProviderDetection,
  Checkpoint,
  Transcript,
  AgentCapabilities,
} from '@legion/core'
import { SessionStore } from './session-store'
import { toAgentEvent } from './event-convert'
import { launchSession, type QueryFn } from './provider/launch'

export type { QueryFn } from './provider/launch'

export interface ClaudeCodeAgentSDKProviderOptions {
  /** Inject the SDK query function. In tests, pass a mock. */
  query: QueryFn
}

export class ClaudeCodeAgentSDKProvider implements AgentProvider {
  id = 'claude-code'
  displayName = 'Claude Code (Agent SDK)'
  capabilities: AgentCapabilities = {
    supportsCheckpoint: false,
    supportsResume: true,
    supportsAttach: false,
    supportsApprovalFlow: true,
  }

  private store = new SessionStore()

  constructor(private readonly opts: ClaudeCodeAgentSDKProviderOptions) {}

  async detect(): Promise<ProviderDetection> {
    return { installed: true, version: 'sdk' }
  }

  async authenticate(): Promise<AuthStatus> {
    const ok = !!process.env['ANTHROPIC_API_KEY']
    return { authenticated: ok }
  }

  async launch(req: LaunchRequest): Promise<SessionHandle> {
    const s = launchSession(req, this.opts.query)
    this.store.set(s)
    return { sessionId: s.sessionId }
  }

  async *stream(sessionId: string): AsyncIterable<AgentEvent> {
    const s = this.store.get(sessionId)
    const sdkIter = s.iter[Symbol.asyncIterator]()
    let sdkPromise = sdkIter.next()
    let sdkDone = false

    while (true) {
      // Drain any queued injected events first
      let injected: AgentEvent | undefined
      while ((injected = s.injector.shift()) !== undefined) {
        yield injected
      }

      if (sdkDone) return

      // Wait for next SDK message OR next injection
      const injectPromise = s.injector.wait().then(() => 'inject' as const)
      const sdkP = sdkPromise.then((r) => ({ kind: 'sdk' as const, r }))
      const winner = await Promise.race([sdkP, injectPromise])

      if (winner === 'inject') {
        // Loop back to drain queue
        continue
      }

      const { r } = winner
      if (r.done) {
        sdkDone = true
        // Loop once more to drain any final injected events
        continue
      }

      sdkPromise = sdkIter.next()
      const evt = toAgentEvent(sessionId, r.value)
      if (evt) yield evt
    }
  }

  async send(_sessionId: string, _message: string, _opts?: SendOptions): Promise<void> {
    throw new Error('send: bidirectional input is not supported in Phase 1')
  }

  async interrupt(_sessionId: string): Promise<void> {
    throw new Error('interrupt: not implemented in Phase 1')
  }

  async approve(sessionId: string, approvalId: string): Promise<void> {
    const s = this.store.get(sessionId)
    s.approval.resolve(approvalId, { allow: true })
  }

  async deny(sessionId: string, approvalId: string, reason?: string): Promise<void> {
    const s = this.store.get(sessionId)
    s.approval.resolve(
      approvalId,
      reason !== undefined ? { allow: false, reason } : { allow: false },
    )
  }

  async status(sessionId: string): Promise<unknown> {
    const s = this.store.get(sessionId)
    return { sessionId: s.sessionId, role: s.role }
  }

  async checkpoint(sessionId: string): Promise<Checkpoint> {
    return { id: sessionId, createdAt: new Date(), metadata: {} }
  }

  async resume(_sessionId: string, _checkpoint?: string): Promise<SessionHandle> {
    throw new Error('resume: implement when needed (Phase 2)')
  }

  async shutdown(sessionId: string): Promise<void> {
    this.store.delete(sessionId)
  }

  async exportTranscript(sessionId: string): Promise<Transcript> {
    return { sessionId, events: [] }
  }
}
