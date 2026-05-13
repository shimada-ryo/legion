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
      for (const e of ctx.log.history(id)) ws.send(JSON.stringify(e))
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
