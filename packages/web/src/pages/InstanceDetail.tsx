import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams } from 'react-router-dom'
import { getInstance } from '../api/client'
import type { InstanceDetail as InstanceDetailType } from '../types'
import { useInstanceEventStream } from '../api/event-stream'
import CanvasOverlay from '../components/CanvasOverlay'
import SidebarTabs from '../components/SidebarTabs'
import EventLogPane from '../components/EventLogPane'

export default function InstanceDetail() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<InstanceDetailType | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const events = useInstanceEventStream(id)

  useEffect(() => {
    if (!id) return
    getInstance(id).then(setData).catch(console.error)
  }, [id])

  if (!data) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div className="instance-detail" style={layoutStyle}>
      <div className="canvas-area" style={canvasStyle}>
        <CanvasOverlay
          template={data.templateSnapshot}
          events={events}
          onSelectNode={setSelectedNodeId}
        />
      </div>
      <div className="sidebar" style={sidebarStyle}>
        <SidebarTabs
          instanceId={data.id}
          selectedNodeId={selectedNodeId}
          template={data.templateSnapshot}
          events={events}
        />
      </div>
      <div className="event-log" style={eventLogStyle}>
        <EventLogPane events={events} instanceId={data.id} />
      </div>
    </div>
  )
}

const layoutStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 360px',
  gridTemplateRows: '1fr 240px',
  gridTemplateAreas: '"canvas sidebar" "log log"',
  height: '100%',
}
const canvasStyle: CSSProperties = {
  gridArea: 'canvas',
  borderRight: '1px solid #ddd',
}
const sidebarStyle: CSSProperties = { gridArea: 'sidebar', overflowY: 'auto' }
const eventLogStyle: CSSProperties = {
  gridArea: 'log',
  borderTop: '1px solid #ddd',
  overflowY: 'auto',
  background: '#fafafa',
}
