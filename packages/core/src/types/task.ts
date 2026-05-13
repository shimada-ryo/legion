// D-014: Tasks are encapsulated within a single AgentInstance.
// Dependencies are intra-instance only; cross-instance coordination uses Layer 1 edges.

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Task {
  id: string
  agentInstanceId: string
  title: string
  description?: string
  status: TaskStatus
  dependencies: string[]
  createdAt: Date
  startedAt?: Date
  endedAt?: Date
  result?: unknown
}
