import { useState } from 'react'
import type { AgentEvent } from '@legion/core'

export default function ToolCallEvent({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const p = event.payload as {
    name?: string
    input?: unknown
    result?: unknown
    kind?: string
  }
  return (
    <div style={{ padding: 8, background: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 6, margin: '4px 0' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--fg-primary)' }}
      >
        {open ? '▼' : '▶'} tool {p.name ?? '?'} {p.kind === 'result' ? '(result)' : ''}
      </button>
      {open && (
        <pre style={{ marginTop: 8, fontSize: 11, overflow: 'auto' }}>
          {JSON.stringify(p.input ?? p.result, null, 2)}
        </pre>
      )}
    </div>
  )
}
