import type { AgentEvent } from '@legion/core'

export default function MessageEvent({ event }: { event: AgentEvent }) {
  const text = (event.payload as { text?: string }).text ?? ''
  return (
    <div style={{ padding: 8, background: '#f6f6f6', borderRadius: 6, margin: '4px 0' }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>assistant</div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  )
}
