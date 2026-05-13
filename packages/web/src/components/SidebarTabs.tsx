import { useState } from 'react'
import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface SidebarTabsProps {
  instanceId: string
  selectedNodeId: string | null
  template: WorkflowTemplate
  events: AgentEvent[]
}

const TABS = ['Overview', 'Events', 'Diff', 'Tasks'] as const
type TabName = (typeof TABS)[number]

export default function SidebarTabs(props: SidebarTabsProps) {
  const [tab, setTab] = useState<TabName>('Overview')
  void props.instanceId
  void props.selectedNodeId
  void props.template
  void props.events
  return (
    <div>
      <div style={{ borderBottom: '1px solid #ddd' }}>
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: 8,
              border: 'none',
              background: tab === t ? '#eef' : 'transparent',
              cursor: 'pointer',
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <div style={{ padding: 8 }}>
        {tab === 'Overview' && <div>Overview (Task 7)</div>}
        {tab === 'Events' && <div>Events (Task 8)</div>}
        {tab === 'Diff' && <div>Diff (Task 9)</div>}
        {tab === 'Tasks' && <div>Tasks (Task 10)</div>}
      </div>
    </div>
  )
}
