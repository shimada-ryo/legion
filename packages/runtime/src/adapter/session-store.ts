import type { ApprovalOrchestrator } from './approval'

export interface SessionState {
  sessionId: string
  iter: AsyncIterable<unknown>
  approval: ApprovalOrchestrator
  workdir: string
  role: string
}

export class SessionStore {
  private map = new Map<string, SessionState>()

  set(state: SessionState): void {
    this.map.set(state.sessionId, state)
  }

  get(sessionId: string): SessionState {
    const s = this.map.get(sessionId)
    if (!s) throw new Error(`Unknown session: ${sessionId}`)
    return s
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId)
  }

  delete(sessionId: string): void {
    this.map.delete(sessionId)
  }

  list(): SessionState[] {
    return [...this.map.values()]
  }
}
