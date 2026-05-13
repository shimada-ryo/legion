// D-018, D-019: Workflow Template — stored as YAML in workflows/, cached in DB.
// Layer 1 of the two-layer model (D-012, D-013).

export type EdgeType =
  | 'triggers'
  | 'delegates'
  | 'publishes'
  | 'subscribes'
  | 'reviews'
  | 'synthesizes'

export type RoleLifetime = 'per-task' | 'per-workflow' | 'persistent'

export type TriggerKind = 'manual' | 'github-issue' | 'schedule' | 'webhook'

export type SinkKind = 'github-pr' | 'github-merge' | 'notify'

export interface RoleNode {
  type: 'role'
  id: string
  role: string
  provider: string
  lifetime: RoleLifetime
}

export interface TriggerNode {
  type: 'trigger'
  id: string
  kind: TriggerKind
}

export interface BlackboardNode {
  type: 'blackboard'
  id: string
  schema: Record<string, string>
}

export interface HumanGateNode {
  type: 'human-gate'
  id: string
  label: string
}

export interface SinkNode {
  type: 'sink'
  id: string
  kind: SinkKind
}

export type TemplateNode =
  | RoleNode
  | TriggerNode
  | BlackboardNode
  | HumanGateNode
  | SinkNode

export interface TemplateEdge {
  from: string
  to: string
  type: EdgeType
}

export interface WorkflowTemplate {
  id: string
  name: string
  description?: string
  nodes: TemplateNode[]
  edges: TemplateEdge[]
}
