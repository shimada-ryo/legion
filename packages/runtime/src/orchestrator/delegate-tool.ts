// D-037, D-038: Director-facing delegate tool. Synchronous: returns only after
// the spawned agent's session has ended.

import { ulid } from 'ulid'
import type {
  AgentEvent,
  AgentProvider,
  DelegateToolInput,
  DelegateToolOutput,
  WorkflowTemplate,
} from '@legion/core'
import { defaultSystemPromptFor } from '../adapter/role-prompts'
import { resolveDelegateTargets } from './graph-walker'
import { PENDING_SESSION_ID, type AgentInstanceStore } from '../store/agent-instance-store'
import type { WorkspaceProvider } from '../workspace/provider'

export interface EventLogWriter {
  write(evt: AgentEvent): void
}

export interface DelegateToolDeps {
  workflowInstanceId: string
  parentAgentInstanceId: string
  agentInstanceStore: AgentInstanceStore
  workspaceProvider: WorkspaceProvider
  provider: AgentProvider
  eventLog: EventLogWriter
  template: WorkflowTemplate
  baseCommitSha: string
}

const SUMMARY_MAX = 500

export class DelegateToolHandler {
  constructor(private readonly deps: DelegateToolDeps) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    const parentRow = this.deps.agentInstanceStore.byId(this.deps.parentAgentInstanceId)
    const fromRoleNodeId = parentRow?.roleNodeId ?? 'director'

    const targets = resolveDelegateTargets(this.deps.template, fromRoleNodeId)
    const target = targets.find((t) => t.roleName === input.role)
    if (!target) {
      throw new Error(
        `delegate: no delegates edge from '${fromRoleNodeId}' to role '${input.role}' in template`,
      )
    }

    // For reviews edges, resolve reviewTargetBranch from caller's branchName.
    let reviewTargetBranch: string | undefined
    if (target.edgeType === 'reviews') {
      const callerBranch = parentRow?.branchName ?? null
      if (!callerBranch) {
        throw new Error(
          `delegate: caller agent instance has no branchName — cannot delegate reviews edge to role '${input.role}'`,
        )
      }
      reviewTargetBranch = callerBranch
    }

    const seq = this.nextSeqForRole(target.roleNodeId)
    const agentInstanceId = ulid()

    const ws = await this.deps.workspaceProvider.create({
      workflowInstanceId: this.deps.workflowInstanceId,
      agentInstanceId,
      role: input.role,
      seq,
      baseCommitSha: this.deps.baseCommitSha,
      ...(reviewTargetBranch !== undefined ? { reviewTargetBranch } : {}),
    })

    // Reviewer agents examine the caller's branch — they don't own a new branch.
    // For delegates edges, the workspace creates a new branch we read back.
    // Both paths guarantee a non-null string (throw otherwise).
    const branchName: string = (() => {
      if (target.edgeType === 'reviews') {
        // reviewTargetBranch is always set here (we threw above if null)
        return reviewTargetBranch as string
      }
      const b = ws.ref.kind === 'owned' && 'branch' in ws.ref ? ws.ref.branch ?? null : null
      if (!b) {
        throw new Error(
          `delegate: workspace for role '${input.role}' must produce a branch (got --detach)`,
        )
      }
      return b
    })()

    this.deps.agentInstanceStore.insert({
      id: agentInstanceId,
      workflowInstanceId: this.deps.workflowInstanceId,
      roleNodeId: target.roleNodeId,
      sessionId: PENDING_SESSION_ID,
      parentAgentInstanceId: this.deps.parentAgentInstanceId,
      spawnEdgeId: `${fromRoleNodeId}→${target.roleNodeId}`,
      status: 'starting',
      workspaceKind: 'owned',
      workspacePath: ws.path,
      branchName,
      startedAt: new Date(),
      endedAt: null,
    })

    let summary = ''
    let status: 'completed' | 'failed' = 'completed'
    let error: string | undefined

    try {
      const handle = await this.deps.provider.launch({
        workdir: ws.path,
        role: input.role,
        initialPrompt: `${defaultSystemPromptFor(input.role)}\n\nTask: ${input.prompt}`,
      })
      this.deps.agentInstanceStore.updateSessionId(agentInstanceId, handle.sessionId)
      this.deps.agentInstanceStore.updateStatus(agentInstanceId, 'running')

      for await (const evt of this.deps.provider.stream(handle.sessionId)) {
        this.deps.eventLog.write(evt)
        if (evt.type === 'message') {
          const t = (evt.payload as { text?: string }).text
          if (typeof t === 'string') summary = t
        }
      }
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : String(e)
    } finally {
      this.deps.agentInstanceStore.setEndedAt(agentInstanceId, new Date())
      this.deps.agentInstanceStore.updateStatus(
        agentInstanceId,
        status === 'completed' ? 'completed' : 'failed',
      )
    }

    return {
      agentInstanceId,
      branchName,
      status,
      summary: summary.slice(0, SUMMARY_MAX),
      ...(error !== undefined ? { error } : {}),
    }
  }

  private nextSeqForRole(roleNodeId: string): number {
    const rows = this.deps.agentInstanceStore.listByWorkflow(this.deps.workflowInstanceId)
    return rows.filter((r) => r.roleNodeId === roleNodeId).length + 1
  }
}
