import { Codex } from '@openai/codex-sdk'
import type {
  AgentProvider,
  LaunchRequest,
  SessionHandle,
  AgentEvent,
  AgentCapabilities,
  ProviderDetection,
  AuthStatus,
  SendOptions,
  Checkpoint,
  Transcript,
} from '@legion/core'
import { CodexSessionStore } from './codex-session-store'
import { launchCodexSession } from './codex-launch'
import { streamCodexSession } from './codex-stream'

export interface CodexSdkProviderOptions {
  /** Inject Codex constructor. In tests, pass a factory that returns a stub Codex. */
  codexFactory?: () => Codex
}

export class CodexSdkProvider implements AgentProvider {
  id = 'codex'
  displayName = 'OpenAI Codex (codex-sdk)'
  capabilities: AgentCapabilities = {
    supportsCheckpoint: false,
    supportsResume: false,
    supportsAttach: false,
    supportsApprovalFlow: false,
  }

  private store = new CodexSessionStore()
  private codex: Codex

  constructor(opts: CodexSdkProviderOptions = {}) {
    const factory = opts.codexFactory ?? (() => new Codex())
    this.codex = factory()
  }

  async detect(): Promise<ProviderDetection> {
    return { installed: true, version: 'codex-sdk' }
  }

  async authenticate(): Promise<AuthStatus> {
    return { authenticated: true }
  }

  async launch(req: LaunchRequest): Promise<SessionHandle> {
    const s = launchCodexSession(this.codex, req)
    this.store.set(s)
    return { sessionId: s.sessionId }
  }

  stream(sessionId: string): AsyncIterable<AgentEvent> {
    return streamCodexSession(this.store, sessionId)
  }

  async send(_sessionId: string, _message: string, _opts?: SendOptions): Promise<void> {
    throw new Error('send: bidirectional input is not supported by Codex provider')
  }

  async interrupt(sessionId: string): Promise<void> {
    this.store.get(sessionId).abort.abort()
  }

  async approve(_sessionId: string, _approvalId: string): Promise<void> {
    /* no-op: Codex SDK has no approvalFlow (runs with approvalPolicy=never) */
  }

  async deny(_sessionId: string, _approvalId: string, _reason?: string): Promise<void> {
    /* no-op */
  }

  async status(sessionId: string): Promise<unknown> {
    const s = this.store.get(sessionId)
    return { sessionId: s.sessionId, role: s.role }
  }

  async checkpoint(sessionId: string): Promise<Checkpoint> {
    return { id: sessionId, createdAt: new Date(), metadata: {} }
  }

  async resume(_sessionId: string, _checkpoint?: string): Promise<SessionHandle> {
    throw new Error('resume: not supported by Codex provider in Phase 3')
  }

  async shutdown(sessionId: string): Promise<void> {
    this.store.delete(sessionId)
  }

  async exportTranscript(sessionId: string): Promise<Transcript> {
    return { sessionId, events: [] }
  }
}
