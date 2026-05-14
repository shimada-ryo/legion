import { useState, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { AgentInstanceView, BlackboardMessage } from '../../types'

export interface BlackboardTabProps {
  blackboardMessages: BlackboardMessage[]
  agentInstances: AgentInstanceView[]
}

type FilterMode = 'all' | 'system' | 'user'

export default function BlackboardTab({
  blackboardMessages,
  agentInstances,
}: BlackboardTabProps) {
  const [filter, setFilter] = useState<FilterMode>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (filter === 'system') return blackboardMessages.filter((m) => m.topic.startsWith('system.'))
    if (filter === 'user') return blackboardMessages.filter((m) => !m.topic.startsWith('system.'))
    return blackboardMessages
  }, [blackboardMessages, filter])

  const agentById = useMemo(() => {
    const m = new Map<string, AgentInstanceView>()
    for (const a of agentInstances) m.set(a.id, a)
    return m
  }, [agentInstances])

  if (blackboardMessages.length === 0) {
    return <div style={emptyStyle}>No blackboard messages yet.</div>
  }

  return (
    <div style={{ fontSize: 13 }}>
      <div style={filterRowStyle} role="toolbar" aria-label="topic filter">
        <FilterChip
          ariaLabel="filter: all"
          label="all"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          ariaLabel="filter: system"
          label="system.*"
          active={filter === 'system'}
          onClick={() => setFilter('system')}
        />
        <FilterChip
          ariaLabel="filter: user"
          label="user"
          active={filter === 'user'}
          onClick={() => setFilter('user')}
        />
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {filtered.map((m) => {
          const expanded = expandedId === m.id
          const publisher = m.publisherAgentId ? agentById.get(m.publisherAgentId) : undefined
          return (
            <li key={m.id} style={rowStyle}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : m.id)}
                style={rowButtonStyle}
              >
                <span style={timeStyle}>{formatTime(m.publishedAt)}</span>
                <span style={topicStyle}>{m.topic}</span>
                {publisher && <span style={publisherStyle}>{publisher.roleNodeId}</span>}
              </button>
              {expanded && (
                <pre style={payloadStyle}>{JSON.stringify(m.payload, null, 2)}</pre>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function FilterChip({
  label,
  ariaLabel,
  active,
  onClick,
}: {
  label: string
  ariaLabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      style={{
        marginRight: 6,
        padding: '2px 8px',
        fontSize: 11,
        background: active ? 'var(--bg-elevated)' : 'transparent',
        color: 'var(--fg-primary)',
        border: '1px solid var(--border-default)',
        borderRadius: 12,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19)
}

const emptyStyle: CSSProperties = { padding: 12, color: 'var(--fg-muted)', fontSize: 13 }
const filterRowStyle: CSSProperties = { paddingBottom: 6, borderBottom: '1px solid var(--border-default)', marginBottom: 6 }
const rowStyle: CSSProperties = { borderBottom: '1px solid var(--border-default)' }
const rowButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '4px 0',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-primary)',
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
}
const timeStyle: CSSProperties = { color: 'var(--fg-muted)', minWidth: 64 }
const topicStyle: CSSProperties = { color: 'var(--accent)' }
const publisherStyle: CSSProperties = { color: 'var(--fg-muted)', fontStyle: 'italic' }
const payloadStyle: CSSProperties = {
  margin: '4px 0 6px 64px',
  padding: '4px 6px',
  background: 'var(--bg-canvas)',
  border: '1px solid var(--border-default)',
  color: 'var(--fg-primary)',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}
