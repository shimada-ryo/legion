import type { AgentEvent } from '@legion/core'
import type { ApprovalOrchestrator } from './approval'

export function makeWaker(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolveFn = r
  })
  return { promise, resolve: resolveFn }
}

export class EventInjector {
  readonly queue: AgentEvent[] = []
  private waker: { promise: Promise<void>; resolve: () => void } = makeWaker()

  push(evt: AgentEvent): void {
    this.queue.push(evt)
    const w = this.waker
    this.waker = makeWaker()
    w.resolve()
  }

  /** Resolves when the next event arrives (or immediately if queue is non-empty). */
  wait(): Promise<void> {
    if (this.queue.length > 0) return Promise.resolve()
    return this.waker.promise
  }

  shift(): AgentEvent | undefined {
    return this.queue.shift()
  }
}

export interface SessionState {
  sessionId: string
  iter: AsyncIterable<unknown>
  approval: ApprovalOrchestrator
  workdir: string
  role: string
  /** Synthesized events to inject into stream() (e.g. permission_request). */
  injector: EventInjector
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
