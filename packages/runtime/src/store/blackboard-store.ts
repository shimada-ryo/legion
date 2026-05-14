import type { Database } from 'bun:sqlite'
import type { BlackboardMessage } from '@legion/core'

interface DbRow {
  id: string
  workflow_instance_id: string
  topic: string
  publisher_agent_id: string | null
  payload: string
  published_at: number
}

export class BlackboardStore {
  private subscribers = new Map<string, Map<symbol, (m: BlackboardMessage) => void>>()

  constructor(private readonly db: Database) {}

  initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blackboard_messages (
        id                   TEXT PRIMARY KEY,
        workflow_instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
        topic                TEXT NOT NULL,
        publisher_agent_id   TEXT,
        payload              TEXT NOT NULL,
        published_at         INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_blackboard_workflow ON blackboard_messages(workflow_instance_id);
      CREATE INDEX IF NOT EXISTS idx_blackboard_topic    ON blackboard_messages(workflow_instance_id, topic);
    `)
  }

  insert(msg: BlackboardMessage): void {
    this.db.run(
      `INSERT INTO blackboard_messages
       (id, workflow_instance_id, topic, publisher_agent_id, payload, published_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        msg.id,
        msg.workflowInstanceId,
        msg.topic,
        msg.publisherAgentId,
        JSON.stringify(msg.payload),
        msg.publishedAt,
      ],
    )
    this.notify(msg)
  }

  /** Subscribe to inserts for a given workflow. Returns an unsubscribe fn. */
  tail(
    workflowInstanceId: string,
    handler: (m: BlackboardMessage) => void,
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

  private notify(msg: BlackboardMessage): void {
    const inner = this.subscribers.get(msg.workflowInstanceId)
    if (!inner) return
    for (const h of inner.values()) {
      try {
        h(msg)
      } catch {
        // Subscriber failures must not break the publish pipeline.
      }
    }
  }

  listByWorkflow(
    workflowInstanceId: string,
    opts: { topic?: string; limit?: number } = {},
  ): BlackboardMessage[] {
    const { topic, limit = 1000 } = opts
    if (topic) {
      const rows = this.db
        .query<DbRow, [string, string, number]>(
          `${SELECT_COLS} WHERE workflow_instance_id = ? AND topic = ? ORDER BY published_at ASC LIMIT ?`,
        )
        .all(workflowInstanceId, topic, limit)
      return rows.map(toMessage)
    }
    const rows = this.db
      .query<DbRow, [string, number]>(
        `${SELECT_COLS} WHERE workflow_instance_id = ? ORDER BY published_at ASC LIMIT ?`,
      )
      .all(workflowInstanceId, limit)
    return rows.map(toMessage)
  }

  byId(id: string): BlackboardMessage | undefined {
    const row = this.db
      .query<DbRow, [string]>(`${SELECT_COLS} WHERE id = ?`)
      .get(id)
    return row ? toMessage(row) : undefined
  }
}

const SELECT_COLS =
  `SELECT id, workflow_instance_id, topic, publisher_agent_id, payload, published_at FROM blackboard_messages`

function toMessage(r: DbRow): BlackboardMessage {
  return {
    id: r.id,
    workflowInstanceId: r.workflow_instance_id,
    topic: r.topic,
    publisherAgentId: r.publisher_agent_id,
    payload: JSON.parse(r.payload),
    publishedAt: r.published_at,
  }
}
