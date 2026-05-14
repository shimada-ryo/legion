import { useState, useMemo } from 'react'
import type { AgentEvent } from '@legion/core'
import type { AgentInstanceView } from '../types'

export interface EventLogPaneProps {
  events: AgentEvent[]
  agentInstances?: AgentInstanceView[]
}

export default function EventLogPane({ events, agentInstances = [] }: EventLogPaneProps) {
  const [filterSessionId, setFilterSessionId] = useState<string | null>(null)

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

  const filtered = filterSessionId
    ? events.filter((e) => e.sessionId === filterSessionId)
    : events

  return (
    <div style={{ padding: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
      <div style={{ paddingBottom: 6, borderBottom: '1px solid #eee', marginBottom: 6 }}>
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
      </div>
      {filtered.map((e) => (
        <div key={e.id}>
          [{new Date(e.timestamp).toLocaleTimeString()}] {e.type} /{' '}
          {labelForSession.get(e.sessionId) ?? e.sessionId.slice(0, 8)}{' '}
          {stringifyPayload(e)}
        </div>
      ))}
    </div>
  )
}

function stringifyPayload(e: AgentEvent): string {
  const text = (e.payload as { text?: string }).text
  if (typeof text === 'string') return text
  return JSON.stringify(e.payload)
}
