import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
  type AgentInstanceRow,
} from '@legion/runtime/store/agent-instance-store'

function freshStore(): { db: Database; store: AgentInstanceStore } {
  const db = new Database(':memory:')
  initAgentInstanceSchema(db)
  return { db, store: new AgentInstanceStore(db) }
}

function row(overrides: Partial<AgentInstanceRow> = {}): AgentInstanceRow {
  return {
    id: '01JABCDEFGHJKMNPQRSTUVWXY1',
    workflowInstanceId: 'wf-01',
    roleNodeId: 'director',
    sessionId: 'sess-1',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'starting',
    workspaceKind: 'owned',
    workspacePath: '/tmp/wt/director',
    branchName: null,
    startedAt: new Date('2026-05-14T12:00:00Z'),
    endedAt: null,
    ...overrides,
  }
}

describe('AgentInstanceStore', () => {
  test('insert then byId round-trips', () => {
    const { db, store } = freshStore()
    const r = row()
    store.insert(r)
    expect(store.byId(r.id)).toEqual(r)
    db.close()
  })

  test('bySessionId looks up by unique session_id', () => {
    const { db, store } = freshStore()
    const r = row({ sessionId: 'sess-xyz' })
    store.insert(r)
    expect(store.bySessionId('sess-xyz')?.id).toBe(r.id)
    expect(store.bySessionId('nope')).toBeUndefined()
    db.close()
  })

  test('listByWorkflow returns rows in insertion order', () => {
    const { db, store } = freshStore()
    store.insert(row({ id: 'a1', sessionId: 's1' }))
    store.insert(row({ id: 'a2', sessionId: 's2' }))
    const list = store.listByWorkflow('wf-01')
    expect(list.map((r) => r.id)).toEqual(['a1', 'a2'])
    db.close()
  })

  test('listChildren filters by parent', () => {
    const { db, store } = freshStore()
    store.insert(row({ id: 'parent', sessionId: 'sp' }))
    store.insert(
      row({ id: 'child1', sessionId: 'sc1', parentAgentInstanceId: 'parent' }),
    )
    store.insert(
      row({ id: 'child2', sessionId: 'sc2', parentAgentInstanceId: 'parent' }),
    )
    const kids = store.listChildren('parent')
    expect(kids.map((r) => r.id).sort()).toEqual(['child1', 'child2'])
    db.close()
  })

  test('updateStatus persists', () => {
    const { db, store } = freshStore()
    store.insert(row())
    store.updateStatus(row().id, 'running')
    expect(store.byId(row().id)?.status).toBe('running')
    db.close()
  })

  test('setEndedAt persists', () => {
    const { db, store } = freshStore()
    store.insert(row())
    const t = new Date('2026-05-14T13:00:00Z')
    store.setEndedAt(row().id, t)
    expect(store.byId(row().id)?.endedAt?.toISOString()).toBe(t.toISOString())
    db.close()
  })
})
