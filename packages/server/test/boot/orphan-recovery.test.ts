import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { runOrphanRecovery } from '../../src/boot/orphan-recovery'

describe('runOrphanRecovery', () => {
  test('flips workflow_instances.status from running to failed', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const wf = new InstanceStore(db)
    const inst = wf.create({
      templateId: 't',
      templateSnapshot: { id: 't', name: 't', nodes: [], edges: [] },
      baseCommitSha: 'x',
    })
    runOrphanRecovery({ db })
    expect(wf.get(inst.id)?.status).toBe('failed')
    db.close()
  })

  test('flips agent_instances with ended_at IS NULL', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const ai = new AgentInstanceStore(db)
    ai.insert({
      id: 'a1',
      workflowInstanceId: 'wf-1',
      roleNodeId: 'director',
      sessionId: 's1',
      parentAgentInstanceId: null,
      spawnEdgeId: null,
      status: 'running',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt',
      branchName: null,
      startedAt: new Date(),
      endedAt: null,
    })
    runOrphanRecovery({ db })
    const row = ai.byId('a1')
    expect(row?.status).toBe('failed')
    expect(row?.endedAt).not.toBeNull()
    db.close()
  })

  test('does not touch already-completed rows', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    initAgentInstanceSchema(db)
    const wf = new InstanceStore(db)
    const inst = wf.create({
      templateId: 't',
      templateSnapshot: { id: 't', name: 't', nodes: [], edges: [] },
      baseCommitSha: 'x',
    })
    wf.updateStatus(inst.id, 'completed')
    runOrphanRecovery({ db })
    expect(wf.get(inst.id)?.status).toBe('completed')
    db.close()
  })
})
