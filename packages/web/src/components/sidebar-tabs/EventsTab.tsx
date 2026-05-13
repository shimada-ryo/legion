import type { AgentEvent } from '@legion/core'
import MessageEvent from '../event-renderers/MessageEvent'
import ToolCallEvent from '../event-renderers/ToolCallEvent'
import PermissionRequestEvent from '../event-renderers/PermissionRequestEvent'
import StatusChangeEvent from '../event-renderers/StatusChangeEvent'

export default function EventsTab(props: {
  events: AgentEvent[]
  instanceId: string
}) {
  return (
    <div>
      {props.events.map((e) => {
        if (e.type === 'message') return <MessageEvent key={e.id} event={e} />
        if (e.type === 'tool_call') return <ToolCallEvent key={e.id} event={e} />
        if (e.type === 'permission_request')
          return (
            <PermissionRequestEvent
              key={e.id}
              event={e}
              instanceId={props.instanceId}
            />
          )
        if (e.type === 'status_change')
          return <StatusChangeEvent key={e.id} event={e} />
        return null
      })}
    </div>
  )
}
