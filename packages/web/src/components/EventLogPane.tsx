import { useState, useMemo } from 'react'
import type { AgentEvent } from '@legion/core'
import type { AgentInstanceView, BlackboardMessage } from '../types'

export interface EventLogPaneProps {
  events: AgentEvent[]
  agentInstances?: AgentInstanceView[]
  blackboardMessages?: BlackboardMessage[]
}

type EventRow = { kind: 'event'; e: AgentEvent }
type BlackboardRow = { kind: 'blackboard'; m: BlackboardMessage }
type Row = EventRow | BlackboardRow

export default function EventLogPane({
  events,
  agentInstances = [],
  blackboardMessages = [],
}: EventLogPaneProps) {
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null)
  const [showBlackboard, setShowBlackboard] = useState(false)

  const labelForSession = useMemo(() => {
    const m = new Map<string, string>()
    const counters = new Map<string, number>()
    for (const a of agentInstances) {
      const n = (counters.get(a.roleNodeId) ?? 0) + 1
      counters.set(a.roleNodeId, n)
      m.set(a.sessionId, `${a.roleNodeId}-${n}`)
    }
    return m
  }, [agentInstances])

  const rows: Row[] = useMemo(() => {
    const eventRows: Row[] = (filterSessionId
      ? events.filter((e) => e.sessionId === filterSessionId)
      : events
    ).map((e) => ({ kind: 'event' as const, e }))
    if (!showBlackboard) return eventRows
    const bbRows: Row[] = blackboardMessages.map((m) => ({ kind: 'blackboard' as const, m }))
    return [...eventRows, ...bbRows].sort((a, b) => timeOf(a) - timeOf(b))
  }, [events, blackboardMessages, filterSessionId, showBlackboard])

  return (
    <div style={{ padding: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
      <div style={{ paddingBottom: 6, borderBottom: '1px solid var(--border-default)', marginBottom: 6 }}>
        <button
          onClick={() => setFilterSessionId(null)}
          style={{ marginRight: 8, fontWeight: filterSessionId === null ? 'bold' : 'normal' }}
        >
          all
        </button>
        {agentInstances.map((a) => (
          <button
            key={a.sessionId}
            onClick={() => setFilterSessionId(a.sessionId)}
            style={{
              marginRight: 8,
              fontWeight: filterSessionId === a.sessionId ? 'bold' : 'normal',
            }}
          >
            {labelForSession.get(a.sessionId) ?? a.roleNodeId}
          </button>
        ))}
        {blackboardMessages.length > 0 && (
          <button
            onClick={() => setShowBlackboard((v) => !v)}
            aria-pressed={showBlackboard}
            style={{ marginLeft: 8, fontWeight: showBlackboard ? 'bold' : 'normal' }}
          >
            blackboard
          </button>
        )}
      </div>
      {rows.map((row) =>
        row.kind === 'event' ? (
          <div key={row.e.id}>
            [{new Date(row.e.timestamp).toLocaleTimeString()}] {row.e.type} /{' '}
            {labelForSession.get(row.e.sessionId) ?? row.e.sessionId.slice(0, 8)}{' '}
            {stringifyPayload(row.e)}
          </div>
        ) : (
          <div key={`bb-${row.m.id}`} style={{ color: 'var(--accent)' }}>
            [{new Date(row.m.publishedAt).toLocaleTimeString()}] [bb] {row.m.topic}{' '}
            {JSON.stringify(row.m.payload).slice(0, 80)}
          </div>
        ),
      )}
    </div>
  )
}

function timeOf(row: Row): number {
  return row.kind === 'event' ? new Date(row.e.timestamp).getTime() : row.m.publishedAt
}

function stringifyPayload(e: AgentEvent): string {
  const text = (e.payload as { text?: string }).text
  if (typeof text === 'string') return text
  return JSON.stringify(e.payload)
}
