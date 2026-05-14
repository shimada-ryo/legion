import type { Database } from 'bun:sqlite'

export interface OrphanRecoveryOpts {
  db: Database
}

export function runOrphanRecovery({ db }: OrphanRecoveryOpts): void {
  const nowIso = new Date().toISOString()
  db.run(
    `UPDATE workflow_instances
     SET status = 'failed', ended_at_iso = COALESCE(ended_at_iso, ?)
     WHERE status IN ('running', 'waiting')`,
    [nowIso],
  )
  db.run(
    `UPDATE agent_instances
     SET status = 'failed', ended_at_iso = COALESCE(ended_at_iso, ?)
     WHERE ended_at_iso IS NULL`,
    [nowIso],
  )
}
