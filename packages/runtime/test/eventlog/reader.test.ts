import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLogWriter } from '@legion/runtime/eventlog/writer'
import { EventLogReader } from '@legion/runtime/eventlog/reader'
import type { AgentEvent } from '@legion/core'

let db: Database

function evt(id: string, sessionId = 's'): AgentEvent {
  return {
    id,
    sessionId,
    type: 'message',
    payload: { text: id },
    timestamp: new Date(),
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => db.close())

describe('EventLogReader.history', () => {
  test('returns events for a workflow instance in seq order', () => {
    const w = new EventLogWriter(db)
    w.append('wf-1', evt('01H000000000000000000000D1'))
    w.append('wf-2', evt('01H000000000000000000000D2'))
    w.append('wf-1', evt('01H000000000000000000000D3'))
    const r = new EventLogReader(db)
    const rows = r.history('wf-1')
    expect(rows.map((e) => e.id)).toEqual([
      '01H000000000000000000000D1',
      '01H000000000000000000000D3',
    ])
  })

  test('respects afterSeq parameter', () => {
    const w = new EventLogWriter(db)
    const s1 = w.append('wf-1', evt('01H000000000000000000000E1'))
    w.append('wf-1', evt('01H000000000000000000000E2'))
    const r = new EventLogReader(db)
    const rows = r.history('wf-1', { afterSeq: s1 })
    expect(rows.map((e) => e.id)).toEqual(['01H000000000000000000000E2'])
  })
})

describe('EventLogReader.tail', () => {
  test('yields events for the given workflow instance via notify()', async () => {
    const r = new EventLogReader(db)
    const yielded: string[] = []
    const stop = r.tail('wf-1', (e) => {
      yielded.push(e.id)
    })
    r.notify('wf-1', evt('01H000000000000000000000F1'), 1)
    r.notify('wf-2', evt('01H000000000000000000000F2'), 2)
    r.notify('wf-1', evt('01H000000000000000000000F3'), 3)
    stop()
    expect(yielded).toEqual(['01H000000000000000000000F1', '01H000000000000000000000F3'])
  })
})
