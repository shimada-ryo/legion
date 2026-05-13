import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import type { AgentEvent } from '@legion/core'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => db.close())

describe('EventLog', () => {
  test('append triggers tail subscribers', () => {
    const log = new EventLog(db)
    const got: string[] = []
    log.tail('wf-1', (e) => got.push(e.id))
    log.append('wf-1', {
      id: '01H000000000000000000000G1',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    })
    expect(got).toEqual(['01H000000000000000000000G1'])
  })

  test('history reflects appended events', () => {
    const log = new EventLog(db)
    log.append('wf-1', {
      id: '01H000000000000000000000G2',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    })
    expect(log.history('wf-1').map((e) => e.id)).toEqual(['01H000000000000000000000G2'])
  })
})
