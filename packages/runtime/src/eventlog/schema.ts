import type { Database } from 'bun:sqlite'

// Append-only log. seq is the global monotonic ordering (AUTOINCREMENT).
// event_id is the AgentEvent.id (ULID) — also unique.
export function initEventLogSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      workflow_instance_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_wf ON events(workflow_instance_id, seq);
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);
  `)
}
