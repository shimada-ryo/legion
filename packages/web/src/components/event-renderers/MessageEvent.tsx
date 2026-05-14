import type { AgentEvent } from '@legion/core'

export default function MessageEvent({ event }: { event: AgentEvent }) {
  const text = (event.payload as { text?: string }).text ?? ''
  return (
    <div style={{ padding: 8, background: 'var(--bg-elevated)', borderRadius: 6, margin: '4px 0' }}>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 4 }}>assistant</div>
      <div style={{ whiteSpace: 'pre-wrap', color: 'var(--fg-primary)' }}>{text}</div>
    </div>
  )
}
