import type { AgentEvent } from '@legion/core'

export default function EventLogPane(props: {
  events: AgentEvent[]
  instanceId: string
}) {
  void props.instanceId
  return (
    <div style={{ padding: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
      {props.events.map((e) => (
        <div key={e.id}>
          [{new Date(e.timestamp).toLocaleTimeString()}] {e.type} /{' '}
          {e.sessionId.slice(0, 8)}
        </div>
      ))}
    </div>
  )
}
