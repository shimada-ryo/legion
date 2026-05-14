import type { ServerWebSocket } from 'bun'
import type { AppRuntime } from '../app'

export interface WsData {
  workflowInstanceId: string
  stop: (() => void) | null
}

export function wsHandlers(ctx: AppRuntime) {
  return {
    open(ws: ServerWebSocket<WsData>) {
      const id = ws.data.workflowInstanceId

      // Subscribe FIRST so events landing during the history fetch are buffered.
      const buffered: { seq: number; raw: string }[] = []
      const stopBuffering = ctx.log.tail(id, (evt, seq) => {
        buffered.push({ seq, raw: JSON.stringify(evt) })
      })

      const past = ctx.log.historyWithSeq(id)
      const lastHistorySeq = past.length === 0 ? 0 : past[past.length - 1]!.seq

      for (const p of past) ws.send(JSON.stringify(p.event))

      // Replay buffered events that arrived after the history snapshot.
      for (const b of buffered) {
        if (b.seq > lastHistorySeq) ws.send(b.raw)
      }

      stopBuffering()
      ws.data.stop = ctx.log.tail(id, (evt) => ws.send(JSON.stringify(evt)))
    },
    message() {
      // ignore inbound for Phase 1
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.stop) ws.data.stop()
    },
  }
}
