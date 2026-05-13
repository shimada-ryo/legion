import type { Database } from 'bun:sqlite'
import type { AgentEvent } from '@legion/core'

export class EventLogWriter {
  private stmt
  constructor(private readonly db: Database) {
    this.stmt = db.query<
      { seq: number },
      [string, string, string, string, string, string]
    >(`
      INSERT INTO events (event_id, workflow_instance_id, session_id, type, payload_json, timestamp_iso)
      VALUES (?, ?, ?, ?, ?, ?)
      RETURNING seq
    `)
  }

  append(workflowInstanceId: string, evt: AgentEvent): number {
    const row = this.stmt.get(
      evt.id,
      workflowInstanceId,
      evt.sessionId,
      evt.type,
      JSON.stringify(evt.payload),
      evt.timestamp.toISOString(),
    )
    if (!row) throw new Error('event insert returned no row')
    return row.seq
  }
}
