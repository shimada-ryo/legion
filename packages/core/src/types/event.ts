// Append-only audit log for replay, metrics, and debugging.

export type EventEntityType =
  | 'workflow_template'
  | 'workflow_instance'
  | 'agent_instance'
  | 'task'
  | 'blackboard_channel'
  | 'human_gate'
  | 'session'

export interface AuditEvent {
  id: string
  entityType: EventEntityType
  entityId: string
  eventType: string
  payload: unknown
  createdAt: Date
}
