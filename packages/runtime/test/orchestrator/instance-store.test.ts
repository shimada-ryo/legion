import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import type { WorkflowTemplate } from '@legion/core'

const SAMPLE_TEMPLATE: WorkflowTemplate = {
  id: 't',
  name: 'T',
  nodes: [{ type: 'trigger', id: 'trig', kind: 'manual' }],
  edges: [],
}

describe('InstanceStore', () => {
  test('create returns a fresh ULID and persists snapshot', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const inst = store.create({
      templateId: 't',
      templateSnapshot: SAMPLE_TEMPLATE,
      baseCommitSha: 'a'.repeat(40),
    })
    expect(inst.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
    expect(inst.status).toBe('running')
    const fetched = store.get(inst.id)
    expect(fetched?.templateSnapshot).toEqual(SAMPLE_TEMPLATE)
    db.close()
  })

  test('list returns instances most-recent first', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const a = store.create({
      templateId: 't',
      templateSnapshot: SAMPLE_TEMPLATE,
      baseCommitSha: 'x',
    })
    const b = store.create({
      templateId: 't',
      templateSnapshot: SAMPLE_TEMPLATE,
      baseCommitSha: 'y',
    })
    const list = store.list()
    expect(list[0]!.id).toBe(b.id)
    expect(list[1]!.id).toBe(a.id)
    db.close()
  })

  test('updateStatus persists', () => {
    const db = new Database(':memory:')
    initInstanceSchema(db)
    const store = new InstanceStore(db)
    const inst = store.create({
      templateId: 't',
      templateSnapshot: SAMPLE_TEMPLATE,
      baseCommitSha: 'x',
    })
    store.updateStatus(inst.id, 'completed')
    expect(store.get(inst.id)?.status).toBe('completed')
    db.close()
  })
})
