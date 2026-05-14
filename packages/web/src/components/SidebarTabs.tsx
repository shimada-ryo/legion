import { useState } from 'react'
import type { WorkflowTemplate, AgentEvent } from '@legion/core'
import type { AgentInstanceView } from '../types'
import OverviewTab from './sidebar-tabs/OverviewTab'
import EventsTab from './sidebar-tabs/EventsTab'
import DiffTab from './sidebar-tabs/DiffTab'
import TasksTab from './sidebar-tabs/TasksTab'

export interface SidebarTabsProps {
  instanceId: string
  selectedNodeId: string | null
  template: WorkflowTemplate
  events: AgentEvent[]
  agentInstances: AgentInstanceView[]
}

const TABS = ['Overview', 'Events', 'Diff', 'Tasks'] as const
type TabName = (typeof TABS)[number]

export default function SidebarTabs(props: SidebarTabsProps) {
  const [tab, setTab] = useState<TabName>('Overview')
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
        {tab === 'Overview' && (
          <OverviewTab template={props.template} selectedNodeId={props.selectedNodeId} agentInstances={props.agentInstances} />
        )}
        {tab === 'Events' && <EventsTab events={props.events} instanceId={props.instanceId} />}
        {tab === 'Diff' && <DiffTab instanceId={props.instanceId} />}
        {tab === 'Tasks' && <TasksTab />}
      </div>
    </div>
  )
}
