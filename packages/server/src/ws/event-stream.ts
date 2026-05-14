import type { ServerWebSocket } from 'bun'
import type { BlackboardMessage } from '@legion/core'
import type { AppRuntime } from '../app'

export interface WsData {
  workflowInstanceId: string
  stop: (() => void) | null
}

function sendBlackboard(ws: ServerWebSocket<WsData>, msg: BlackboardMessage): void {
  ws.send(JSON.stringify({ type: 'blackboard.message', message: msg }))
}

export function wsHandlers(ctx: AppRuntime) {
  return {
    open(ws: ServerWebSocket<WsData>) {
      const id = ws.data.workflowInstanceId

      // === EventLog: subscribe-first to defend against the history fetch race. ===
      const eventBuffer: { seq: number; raw: string }[] = []
      const stopEventBuffering = ctx.log.tail(id, (evt, seq) => {
        eventBuffer.push({ seq, raw: JSON.stringify(evt) })
      })
      const past = ctx.log.historyWithSeq(id)
      const lastHistorySeq = past.length === 0 ? 0 : past[past.length - 1]!.seq
      for (const p of past) ws.send(JSON.stringify(p.event))
      for (const b of eventBuffer) {
        if (b.seq > lastHistorySeq) ws.send(b.raw)
      }
      stopEventBuffering()

      // === Blackboard: subscribe-first, then history, then drain buffered with id dedupe. ===
      const bbBuffer: BlackboardMessage[] = []
      const stopBbBuffering = ctx.blackboardStore.tail(id, (m) => bbBuffer.push(m))
      const bbHistory = ctx.blackboardStore.listByWorkflow(id)
      const seenBbIds = new Set<string>()
      for (const m of bbHistory) {
        seenBbIds.add(m.id)
        sendBlackboard(ws, m)
      }
      for (const m of bbBuffer) {
        if (!seenBbIds.has(m.id)) {
          seenBbIds.add(m.id)
          sendBlackboard(ws, m)
        }
      }
      stopBbBuffering()

      // === Live tails for both channels. ===
      const stopEventTail = ctx.log.tail(id, (evt) => ws.send(JSON.stringify(evt)))
      const stopBbTail = ctx.blackboardStore.tail(id, (m) => sendBlackboard(ws, m))
      ws.data.stop = () => {
        stopEventTail()
        stopBbTail()
      }
    },
    message() {
      // ignore inbound for Phase 1
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.stop) ws.data.stop()
    },
  }
}
