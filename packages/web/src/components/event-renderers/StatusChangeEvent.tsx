import type { AgentEvent } from '@legion/core'

export default function StatusChangeEvent({ event }: { event: AgentEvent }) {
  const p = event.payload as { status?: string }
  return (
    <div style={{ padding: 4, fontSize: 11, color: 'var(--fg-muted)', fontStyle: 'italic' }}>
      → {p.status ?? '?'}
    </div>
  )
}
