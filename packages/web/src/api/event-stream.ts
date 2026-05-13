import { useEffect, useState } from 'react'
import type { AgentEvent } from '@legion/core'

export function useInstanceEventStream(instanceId: string | undefined): AgentEvent[] {
  const [events, setEvents] = useState<AgentEvent[]>([])
  useEffect(() => {
    if (!instanceId) return
    setEvents([])
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws/instances/${encodeURIComponent(instanceId)}/events`
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as AgentEvent
        setEvents((prev) => [...prev, evt])
      } catch {
        // ignore malformed
      }
    }
    return () => ws.close()
  }, [instanceId])
  return events
}
