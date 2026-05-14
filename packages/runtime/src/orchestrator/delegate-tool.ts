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
import type { AgentInstanceStore } from '../store/agent-instance-store'
import type { WorkspaceProvider } from '../workspace/provider'

export interface EventLogWriter {
  write(evt: AgentEvent): void
}

export interface DelegateToolDeps {
  workflowInstanceId: string
  parentAgentInstanceId: string
  parentSessionId: string
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

    const seq = this.nextSeqForRole(target.roleNodeId)
    const agentInstanceId = ulid()

    // Create worktree via the existing WorkspaceProvider API. The provider
    // derives the branch name internally; we read it back from the descriptor.
    const ws = await this.deps.workspaceProvider.create({
      workflowInstanceId: this.deps.workflowInstanceId,
      agentInstanceId,
      role: input.role,
      seq,
      baseCommitSha: this.deps.baseCommitSha,
    })
    const branchName =
      ws.ref.kind === 'owned' && 'branch' in ws.ref ? ws.ref.branch ?? null : null
    if (!branchName) {
      throw new Error(
        `delegate: workspace for role '${input.role}' must produce a branch (got --detach)`,
      )
    }

    this.deps.agentInstanceStore.insert({
      id: agentInstanceId,
      workflowInstanceId: this.deps.workflowInstanceId,
      roleNodeId: target.roleNodeId,
      sessionId: 'pending',
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
