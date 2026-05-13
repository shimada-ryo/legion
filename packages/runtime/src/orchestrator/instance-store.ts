import type { Database } from 'bun:sqlite'
import { ulid } from 'ulid'
import type {
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowTemplate,
} from '@legion/core'

export function initInstanceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      template_snapshot_json TEXT NOT NULL,
      base_commit_sha TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_iso TEXT NOT NULL,
      ended_at_iso TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wi_started ON workflow_instances(started_at_iso DESC);
  `)
}

export interface CreateInstanceInput {
  templateId: string
  templateSnapshot: WorkflowTemplate
  baseCommitSha: string
}

interface Row {
  id: string
  template_id: string
  template_snapshot_json: string
  base_commit_sha: string
  status: string
  started_at_iso: string
  ended_at_iso: string | null
}

export class InstanceStore {
  constructor(private readonly db: Database) {}

  create(input: CreateInstanceInput): WorkflowInstance {
    const id = ulid()
    const startedAt = new Date()
    this.db.run(
      `INSERT INTO workflow_instances (id, template_id, template_snapshot_json, base_commit_sha, status, started_at_iso) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.templateId,
        JSON.stringify(input.templateSnapshot),
        input.baseCommitSha,
        'running',
        startedAt.toISOString(),
      ],
    )
    return {
      id,
      templateId: input.templateId,
      templateSnapshot: input.templateSnapshot,
      baseCommitSha: input.baseCommitSha,
      status: 'running',
      agentInstances: [],
      blackboardChannels: [],
      startedAt,
    }
  }

  get(id: string): WorkflowInstance | undefined {
    const row = this.db
      .query<Row, [string]>(`SELECT * FROM workflow_instances WHERE id = ?`)
      .get(id)
    if (!row) return undefined
    return rowToInstance(row)
  }

  list(): WorkflowInstance[] {
    const rows = this.db
      .query<Row, []>(`SELECT * FROM workflow_instances ORDER BY rowid DESC`)
      .all()
    return rows.map(rowToInstance)
  }

  updateStatus(id: string, status: WorkflowInstanceStatus): void {
    const endedAt =
      status === 'completed' || status === 'failed' ? new Date().toISOString() : null
    this.db.run(
      `UPDATE workflow_instances SET status = ?, ended_at_iso = COALESCE(?, ended_at_iso) WHERE id = ?`,
      [status, endedAt, id],
    )
  }
}

function rowToInstance(row: Row): WorkflowInstance {
  const out: WorkflowInstance = {
    id: row.id,
    templateId: row.template_id,
    templateSnapshot: JSON.parse(row.template_snapshot_json) as WorkflowTemplate,
    baseCommitSha: row.base_commit_sha,
    status: row.status as WorkflowInstanceStatus,
    agentInstances: [],
    blackboardChannels: [],
    startedAt: new Date(row.started_at_iso),
  }
  if (row.ended_at_iso) out.endedAt = new Date(row.ended_at_iso)
  return out
}
