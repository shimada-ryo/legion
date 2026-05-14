import type { Thread } from '@openai/codex-sdk'

export interface CodexSession {
  sessionId: string
  thread: Thread
  prompt: string
  outputSchema?: unknown
  role: string
  abort: AbortController
}

export class CodexSessionStore {
  private map = new Map<string, CodexSession>()

  set(s: CodexSession): void {
    this.map.set(s.sessionId, s)
  }

  get(sessionId: string): CodexSession {
    const s = this.map.get(sessionId)
    if (!s) throw new Error(`CodexSessionStore: no session for ${sessionId}`)
    return s
  }

  delete(sessionId: string): void {
    this.map.delete(sessionId)
  }
}
