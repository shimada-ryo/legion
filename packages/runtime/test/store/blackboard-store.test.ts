import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { ulid } from 'ulid'
import { BlackboardStore } from '../../src/store/blackboard-store'

function setupDb(): Database {
  const db = new Database(':memory:')
  // Stub for the workflow_instances FK target referenced by blackboard_messages.
  db.run(`CREATE TABLE workflow_instances (id TEXT PRIMARY KEY)`)
  return db
}

describe('BlackboardStore', () => {
  let db: Database
  let store: BlackboardStore

  beforeEach(() => {
    db = setupDb()
    store = new BlackboardStore(db)
    store.initSchema()
  })

  it('insert + listByWorkflow returns inserted rows ordered by publishedAt', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

    const m1 = {
      id: ulid(),
      workflowInstanceId: wfId,
      topic: 'system.delegate.start',
      publisherAgentId: null,
      payload: { role: 'implementer' },
      publishedAt: 1000,
    }
    const m2 = {
      id: ulid(),
      workflowInstanceId: wfId,
      topic: 'user.foo',
      publisherAgentId: 'agent-1',
      payload: { value: 42 },
      publishedAt: 2000,
    }

    store.insert(m1)
    store.insert(m2)

    const rows = store.listByWorkflow(wfId)
    expect(rows).toHaveLength(2)
    const [r0, r1] = rows
    expect(r0).toMatchObject({ topic: 'system.delegate.start', publishedAt: 1000 })
    expect(r1).toMatchObject({ topic: 'user.foo', publishedAt: 2000 })
    expect(r1?.payload).toEqual({ value: 42 })
  })

  it('listByWorkflow with topic filter returns only matching rows', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'system.delegate.start', publisherAgentId: null, payload: {}, publishedAt: 1000 })
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'user.foo', publisherAgentId: null, payload: {}, publishedAt: 2000 })
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'system.delegate.result', publisherAgentId: null, payload: {}, publishedAt: 3000 })

    const sys = store.listByWorkflow(wfId, { topic: 'system.delegate.start' })
    expect(sys).toHaveLength(1)
    expect(sys[0]?.topic).toBe('system.delegate.start')
  })

  it('byId returns the inserted row, or undefined for unknown id', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])
    const id = ulid()
    store.insert({ id, workflowInstanceId: wfId, topic: 'x', publisherAgentId: null, payload: { ok: true }, publishedAt: 100 })

    expect(store.byId(id)?.payload).toEqual({ ok: true })
    expect(store.byId(ulid())).toBeUndefined()
  })

  it('CASCADE delete: removing workflow_instance row removes its blackboard rows', () => {
    const wfId = ulid()
    db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])
    store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 'x', publisherAgentId: null, payload: {}, publishedAt: 1 })
    db.run('PRAGMA foreign_keys = ON')
    db.run('DELETE FROM workflow_instances WHERE id = ?', [wfId])
    expect(store.listByWorkflow(wfId)).toHaveLength(0)
  })

  describe('tail (Phase 3 Pub/Sub)', () => {
    it('notifies subscribed handlers on insert, scoped by workflowInstanceId', () => {
      const wfA = ulid()
      const wfB = ulid()
      db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfA])
      db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfB])

      const seenA: string[] = []
      const seenB: string[] = []
      store.tail(wfA, (m) => seenA.push(m.topic))
      store.tail(wfB, (m) => seenB.push(m.topic))

      store.insert({ id: ulid(), workflowInstanceId: wfA, topic: 't1', publisherAgentId: null, payload: {}, publishedAt: 1 })
      store.insert({ id: ulid(), workflowInstanceId: wfB, topic: 't2', publisherAgentId: null, payload: {}, publishedAt: 2 })
      store.insert({ id: ulid(), workflowInstanceId: wfA, topic: 't3', publisherAgentId: null, payload: {}, publishedAt: 3 })

      expect(seenA).toEqual(['t1', 't3'])
      expect(seenB).toEqual(['t2'])
    })

    it('stop function unsubscribes the handler', () => {
      const wfId = ulid()
      db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

      const seen: string[] = []
      const stop = store.tail(wfId, (m) => seen.push(m.topic))
      store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 't1', publisherAgentId: null, payload: {}, publishedAt: 1 })
      stop()
      store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 't2', publisherAgentId: null, payload: {}, publishedAt: 2 })

      expect(seen).toEqual(['t1'])
    })

    it('a handler that throws does not break subsequent handlers', () => {
      const wfId = ulid()
      db.run('INSERT INTO workflow_instances (id) VALUES (?)', [wfId])

      const seen: string[] = []
      store.tail(wfId, () => { throw new Error('boom') })
      store.tail(wfId, (m) => seen.push(m.topic))

      store.insert({ id: ulid(), workflowInstanceId: wfId, topic: 't1', publisherAgentId: null, payload: {}, publishedAt: 1 })
      expect(seen).toEqual(['t1'])
    })
  })
})
