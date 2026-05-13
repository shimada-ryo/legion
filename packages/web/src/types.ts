import type { WorkflowTemplate, AgentEvent } from '@legion/core'

export interface InstanceSummary {
  id: string
  templateId: string
  status: string
  startedAt: string
  endedAt: string | null
}

export interface InstanceDetail extends InstanceSummary {
  templateSnapshot: WorkflowTemplate
  events: AgentEvent[]
}

export interface TemplateSummary {
  id: string
  name: string
  description: string | null
  nodeCount: number
}
