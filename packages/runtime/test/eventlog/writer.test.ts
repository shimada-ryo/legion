import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLogWriter } from '@legion/runtime/eventlog/writer'
import type { AgentEvent } from '@legion/core'

let db: Database

beforeEach(() => {
  db = new Database(':memory:')
  initEventLogSchema(db)
})

afterEach(() => {
  db.close()
})

describe('EventLogWriter', () => {
  test('append stores an AgentEvent and assigns a monotonic seq', () => {
    const writer = new EventLogWriter(db)
    const evt: AgentEvent = {
      id: '01H000000000000000000000A1',
      sessionId: 'sess-1',
      type: 'message',
      payload: { text: 'hello' },
      timestamp: new Date('2026-05-13T12:00:00Z'),
    }
    const seq = writer.append('wf-instance-1', evt)
    expect(seq).toBe(1)
    const seq2 = writer.append('wf-instance-1', { ...evt, id: '01H000000000000000000000A2' })
    expect(seq2).toBe(2)
  })

  test('different workflow instances share the global seq counter', () => {
    const writer = new EventLogWriter(db)
    const e1: AgentEvent = {
      id: '01H000000000000000000000B1',
      sessionId: 's',
      type: 'message',
      payload: null,
      timestamp: new Date(),
    }
    const e2: AgentEvent = { ...e1, id: '01H000000000000000000000B2' }
    const s1 = writer.append('wf-1', e1)
    const s2 = writer.append('wf-2', e2)
    expect(s2).toBe(s1 + 1)
  })

  test('payload is stored as JSON', () => {
    const writer = new EventLogWriter(db)
    writer.append('wf-x', {
      id: '01H000000000000000000000C1',
      sessionId: 's',
      type: 'tool_call',
      payload: { name: 'Read', input: { path: '/x' } },
      timestamp: new Date(),
    })
    const row = db
      .query<{ payload_json: string }, [string]>(
        'SELECT payload_json FROM events WHERE event_id = ?',
      )
      .get('01H000000000000000000000C1')
    expect(row).not.toBeNull()
    expect(JSON.parse(row!.payload_json)).toEqual({
      name: 'Read',
      input: { path: '/x' },
    })
  })
})
