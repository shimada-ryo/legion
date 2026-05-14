import { useEffect, useState } from 'react'
import type { AgentEvent, BlackboardMessage } from '@legion/core'

export interface InstanceStream {
  events: AgentEvent[]
  blackboardMessages: BlackboardMessage[]
}

interface BlackboardEnvelope {
  type: 'blackboard.message'
  message: BlackboardMessage
}

function isBlackboardEnvelope(v: unknown): v is BlackboardEnvelope {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: unknown }).type === 'blackboard.message' &&
    typeof (v as { message?: unknown }).message === 'object'
  )
}

export function useInstanceEventStream(instanceId: string | undefined): InstanceStream {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [blackboardMessages, setBlackboardMessages] = useState<BlackboardMessage[]>([])

  useEffect(() => {
    if (!instanceId) return
    setEvents([])
    setBlackboardMessages([])
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/ws/instances/${encodeURIComponent(instanceId)}/events`
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as unknown
        if (isBlackboardEnvelope(parsed)) {
          const msg = parsed.message
          setBlackboardMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
          )
          return
        }
        setEvents((prev) => [...prev, parsed as AgentEvent])
      } catch {
        // ignore malformed
      }
    }
    return () => ws.close()
  }, [instanceId])

  return { events, blackboardMessages }
}
