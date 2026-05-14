// D-023: AgentWorkspace is the first-class runtime concept. Phase 1 provides
// LocalWorktreeProvider; Phase 4 will add RemoteCloneProvider.

import type { WorkspaceRef } from '@legion/core'

export interface WorkspaceCreateInput {
  workflowInstanceId: string
  agentInstanceId: string
  role: string
  seq: number
  baseCommitSha: string
  /** Phase 3 (D-052): when role='reviewer', detach at this branch tip instead of baseCommitSha. */
  reviewTargetBranch?: string
}

export interface WorkspaceDescriptor {
  ref: WorkspaceRef
  path: string
}

export interface WorkspaceProvider {
  /** Create the workspace and return its descriptor. */
  create(input: WorkspaceCreateInput): Promise<WorkspaceDescriptor>

  /** Destroy the workspace; idempotent (no-op if already gone). */
  destroy(descriptor: WorkspaceDescriptor): Promise<void>

  /** List existing workspaces for cleanup / observability. */
  list(workflowInstanceId?: string): Promise<WorkspaceDescriptor[]>
}
