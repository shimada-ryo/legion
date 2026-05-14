import type { Database } from 'bun:sqlite'
import type { AgentStatus } from '@legion/core'

export interface AgentInstanceRow {
  id: string
  workflowInstanceId: string
  roleNodeId: string
  sessionId: string
  parentAgentInstanceId: string | null
  spawnEdgeId: string | null
  status: AgentStatus
  workspaceKind: 'owned' | 'shared'
  workspacePath: string
  branchName: string | null
  startedAt: Date
  endedAt: Date | null
}

interface DbRow {
  id: string
  workflow_instance_id: string
  role_node_id: string
  session_id: string
  parent_agent_instance_id: string | null
  spawn_edge_id: string | null
  status: string
  workspace_kind: string
  workspace_path: string
  branch_name: string | null
  started_at_iso: string
  ended_at_iso: string | null
}

export function initAgentInstanceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_instances (
      id                       TEXT PRIMARY KEY,
      workflow_instance_id     TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
      role_node_id             TEXT NOT NULL,
      session_id               TEXT NOT NULL UNIQUE,
      parent_agent_instance_id TEXT REFERENCES agent_instances(id),
      spawn_edge_id            TEXT,
      status                   TEXT NOT NULL,
      workspace_kind           TEXT NOT NULL,
      workspace_path           TEXT NOT NULL,
      branch_name              TEXT,
      started_at_iso           TEXT NOT NULL,
      ended_at_iso             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_instances_workflow ON agent_instances(workflow_instance_id);
    CREATE INDEX IF NOT EXISTS idx_agent_instances_session  ON agent_instances(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_instances_parent   ON agent_instances(parent_agent_instance_id);
  `)
}

export class AgentInstanceStore {
  constructor(private readonly db: Database) {}

  insert(r: AgentInstanceRow): void {
    this.db.run(
      `INSERT INTO agent_instances
       (id, workflow_instance_id, role_node_id, session_id, parent_agent_instance_id,
        spawn_edge_id, status, workspace_kind, workspace_path, branch_name,
        started_at_iso, ended_at_iso)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.workflowInstanceId,
        r.roleNodeId,
        r.sessionId,
        r.parentAgentInstanceId,
        r.spawnEdgeId,
        r.status,
        r.workspaceKind,
        r.workspacePath,
        r.branchName,
        r.startedAt.toISOString(),
        r.endedAt ? r.endedAt.toISOString() : null,
      ],
    )
  }

  byId(id: string): AgentInstanceRow | undefined {
    const row = this.db
      .query<DbRow, [string]>(`SELECT * FROM agent_instances WHERE id = ?`)
      .get(id)
    return row ? toRow(row) : undefined
  }

  bySessionId(sessionId: string): AgentInstanceRow | undefined {
    const row = this.db
      .query<DbRow, [string]>(`SELECT * FROM agent_instances WHERE session_id = ?`)
      .get(sessionId)
    return row ? toRow(row) : undefined
  }

  listByWorkflow(workflowInstanceId: string): AgentInstanceRow[] {
    const rows = this.db
      .query<DbRow, [string]>(
        `SELECT * FROM agent_instances WHERE workflow_instance_id = ? ORDER BY rowid ASC`,
      )
      .all(workflowInstanceId)
    return rows.map(toRow)
  }

  listChildren(parentAgentInstanceId: string): AgentInstanceRow[] {
    const rows = this.db
      .query<DbRow, [string]>(
        `SELECT * FROM agent_instances WHERE parent_agent_instance_id = ? ORDER BY rowid ASC`,
      )
      .all(parentAgentInstanceId)
    return rows.map(toRow)
  }

  updateStatus(id: string, status: AgentStatus): void {
    this.db.run(`UPDATE agent_instances SET status = ? WHERE id = ?`, [status, id])
  }

  updateSessionId(id: string, sessionId: string): void {
    this.db.run(`UPDATE agent_instances SET session_id = ? WHERE id = ?`, [sessionId, id])
  }

  setEndedAt(id: string, endedAt: Date): void {
    this.db.run(`UPDATE agent_instances SET ended_at_iso = ? WHERE id = ?`, [
      endedAt.toISOString(),
      id,
    ])
  }
}

function toRow(r: DbRow): AgentInstanceRow {
  return {
    id: r.id,
    workflowInstanceId: r.workflow_instance_id,
    roleNodeId: r.role_node_id,
    sessionId: r.session_id,
    parentAgentInstanceId: r.parent_agent_instance_id,
    spawnEdgeId: r.spawn_edge_id,
    status: r.status as AgentStatus,
    workspaceKind: r.workspace_kind as 'owned' | 'shared',
    workspacePath: r.workspace_path,
    branchName: r.branch_name,
    startedAt: new Date(r.started_at_iso),
    endedAt: r.ended_at_iso ? new Date(r.ended_at_iso) : null,
  }
}
