import type { AgentEvent } from '@legion/core'
import { toAgentEvent } from '../event-convert'
import type { SessionStore } from '../session-store'

export async function* streamSession(
  store: SessionStore,
  sessionId: string,
): AsyncIterable<AgentEvent> {
  const s = store.get(sessionId)
  const sdkIter = s.iter[Symbol.asyncIterator]()
  let sdkPromise = sdkIter.next()
  let sdkDone = false

  while (true) {
    let injected: AgentEvent | undefined
    while ((injected = s.injector.shift()) !== undefined) {
      yield injected
    }
    if (sdkDone) return

    const injectPromise = s.injector.wait().then(() => 'inject' as const)
    const sdkP = sdkPromise.then((r) => ({ kind: 'sdk' as const, r }))
    const winner = await Promise.race([sdkP, injectPromise])

    if (winner === 'inject') continue

    const { r } = winner
    if (r.done) {
      sdkDone = true
      continue
    }

    sdkPromise = sdkIter.next()
    const evt = toAgentEvent(sessionId, r.value)
    if (evt) yield evt
  }
}
