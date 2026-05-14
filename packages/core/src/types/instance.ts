// D-012, D-013, D-014, D-018: Execution-layer entities.
// WorkflowInstance is spawned from a Template snapshot and owns a graph of AgentInstances.

import type { WorkflowTemplate } from './template'
import type { Task } from './task'
import type { WorkspaceRef } from './workspace'

export type WorkflowInstanceStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'

export type AgentStatus =
  | 'created'
  | 'starting'
  | 'planning'
  | 'running'
  | 'waiting_for_user'
  | 'waiting_for_permission'
  | 'waiting_for_ci'
  | 'waiting_for_review'
  | 'blocked'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'archived'

export interface InboundMessage {
  id: string
  fromAgentInstanceId?: string
  fromBlackboardChannelId?: string
  edgeType: string
  payload: unknown
  receivedAt: Date
}

export interface SubscriptionState {
  blackboardNodeId: string
  lastConsumedMessageId?: string
}

export interface BlackboardChannelState {
  blackboardNodeId: string
  messageCount: number
  lastMessageAt?: Date
}

export interface AgentInstance {
  id: string
  roleNodeId: string
  workflowInstanceId: string
  sessionId: string
  status: AgentStatus
  parentAgentInstanceId?: string      // Phase 2: parent (Director's id for Implementer)
  spawnEdgeId?: string                // Phase 2: which template edge spawned this agent
  workspace: WorkspaceRef             // Phase 2: persisted workspace reference
  branchName?: string                 // Phase 2: branch name for committers (Implementer); undefined for --detach (Director)
  tasks: Task[]
  inbox: InboundMessage[]
  subscriptions: SubscriptionState[]
  startedAt: Date
  endedAt?: Date
}

export interface WorkflowInstance {
  id: string
  templateId: string
  templateSnapshot: WorkflowTemplate
  baseCommitSha: string
  status: WorkflowInstanceStatus
  agentInstances: AgentInstance[]
  blackboardChannels: BlackboardChannelState[]
  startedAt: Date
  endedAt?: Date
}
