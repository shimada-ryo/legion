// packages/core/src/types/delegate.ts
// D-037, D-038: Director-facing custom tool. Synchronous: tool returns only
// after the Implementer session has ended.

export interface DelegateToolInput {
  /** Role to spawn. Phase 2 narrow scope accepts 'implementer' only. */
  role: string
  /** Self-contained prompt for the spawned agent. The spawned agent does NOT see the original user prompt. */
  prompt: string
  /** Optional one-line rationale. Logged to the event log but not passed to the spawned agent. */
  rationale?: string
}

export interface DelegateToolOutput {
  /** The spawned AgentInstance.id. */
  agentInstanceId: string
  /** Branch the Implementer committed to. */
  branchName: string
  /** 'completed' = session ended normally; 'failed' = provider threw. */
  status: 'completed' | 'failed'
  /** Last assistant message from the spawned agent, truncated to ~500 chars. */
  summary: string
  /** Present only when status='failed'. */
  error?: string
}
