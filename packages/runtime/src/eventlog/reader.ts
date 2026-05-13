import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'

export interface HistoryOptions {
  afterSeq?: number
  limit?: number
}

interface Row {
  seq: number
  event_id: string
  workflow_instance_id: string
  session_id: string
  type: string
  payload_json: string
  timestamp_iso: string
}

export class EventLogReader {
  private subscribers = new Map<
    string,
    Map<symbol, (e: AgentEvent, seq: number) => void>
  >()

  constructor(private readonly db: Database) {}

  history(workflowInstanceId: string, opts: HistoryOptions = {}): AgentEvent[] {
    const afterSeq = opts.afterSeq ?? 0
    const limit = opts.limit ?? 1000
    const rows = this.db
      .query<Row, [string, number, number]>(
        `SELECT seq, event_id, workflow_instance_id, session_id, type, payload_json, timestamp_iso
         FROM events
         WHERE workflow_instance_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(workflowInstanceId, afterSeq, limit)
    return rows.map(rowToEvent)
  }

  /** Subscribe to live events. Returns a stop function. */
  tail(
    workflowInstanceId: string,
    handler: (e: AgentEvent, seq: number) => void,
  ): () => void {
    const key = Symbol()
    let inner = this.subscribers.get(workflowInstanceId)
    if (!inner) {
      inner = new Map()
      this.subscribers.set(workflowInstanceId, inner)
    }
    inner.set(key, handler)
    return () => inner!.delete(key)
  }

  /** Called by EventLogWriter (or its wrapper) after a successful append. */
  notify(workflowInstanceId: string, evt: AgentEvent, seq: number): void {
    const inner = this.subscribers.get(workflowInstanceId)
    if (!inner) return
    for (const h of inner.values()) h(evt, seq)
  }
}

function rowToEvent(row: Row): AgentEvent {
  return {
    id: row.event_id,
    sessionId: row.session_id,
    type: row.type as AgentEvent['type'],
    payload: JSON.parse(row.payload_json),
    timestamp: new Date(row.timestamp_iso),
  }
}
