import type { WorkflowTemplate, AgentEvent, BlackboardMessage } from '@legion/core'

export type { BlackboardMessage } from '@legion/core'

export interface InstanceSummary {
  id: string
  templateId: string
  status: string
  startedAt: string
  endedAt: string | null
}

export interface AgentInstanceView {
  id: string
  roleNodeId: string
  workflowInstanceId: string
  sessionId: string
  status: string
  parentAgentInstanceId?: string
  spawnEdgeId?: string
  workspace: { kind: 'owned' | 'shared'; path: string }
  branchName?: string
  startedAt: string
  endedAt: string | null
}

export interface InstanceDetail extends InstanceSummary {
  templateSnapshot: WorkflowTemplate
  events: AgentEvent[]
  agentInstances: AgentInstanceView[]
  blackboardMessages: BlackboardMessage[]
}

export interface TemplateSummary {
  id: string
  name: string
  description: string | null
  nodeCount: number
}
