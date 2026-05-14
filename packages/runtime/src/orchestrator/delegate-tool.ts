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
import type { BlackboardStore } from '../store/blackboard-store'

const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['approve', 'request-changes', 'reject'] },
    feedback: { type: 'string' },
    notes:    { type: 'string' },
  },
  required: ['decision'],
} as const

interface ReviewPayload {
  decision: 'approve' | 'request-changes' | 'reject'
  feedback?: string
  notes?: string
}

function parseReviewerOutput(
  rawAssistantMessage: string,
): { payload?: ReviewPayload; freeFormSummary: string } {
  // Strategy 1: whole body is JSON
  const trimmed = rawAssistantMessage.trim()
  try {
    const obj = JSON.parse(trimmed) as ReviewPayload
    if (obj.decision) {
      return { payload: obj, freeFormSummary: obj.notes ?? '' }
    }
  } catch {
    // fall through
  }

  // Strategy 2: extract first ```json fenced block
  const fenceMatch = rawAssistantMessage.match(/```json\s*([\s\S]*?)```/i)
  if (fenceMatch) {
    try {
      const captured = fenceMatch[1] ?? ''
      const obj = JSON.parse(captured) as ReviewPayload
      if (obj.decision) {
        const before = rawAssistantMessage.slice(0, fenceMatch.index ?? 0).trim()
        return { payload: obj, freeFormSummary: before }
      }
    } catch {
      // fall through
    }
  }

  return { freeFormSummary: rawAssistantMessage }
}

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
  blackboardStore: BlackboardStore
}

const SUMMARY_MAX = 500
const PROMPT_PREVIEW_MAX = 200

export class DelegateToolHandler {
  constructor(private readonly deps: DelegateToolDeps) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    const { agentInstanceId, branchName, workspacePath, edgeType } =
      await this.resolveSpawnInputs(input)

    this.publishSystemEvent('system.delegate.start', {
      fromAgentInstanceId: this.deps.parentAgentInstanceId,
      toAgentInstanceId: agentInstanceId,
      role: input.role,
      edgeType,
      prompt: input.prompt.slice(0, PROMPT_PREVIEW_MAX),
    })

    const outputSchema = edgeType === 'reviews' ? REVIEW_OUTPUT_SCHEMA : undefined
    const { summary, status, error } = await this.runSpawnedAgent(
      agentInstanceId,
      input,
      workspacePath,
      outputSchema,
    )

    this.publishSystemEvent('system.delegate.result', {
      agentInstanceId,
      role: input.role,
      status,
      summary: summary.slice(0, PROMPT_PREVIEW_MAX),
    })

    if (edgeType === 'reviews') {
      const parsed = parseReviewerOutput(summary)
      if (parsed.payload !== undefined) {
        this.publishSystemEvent('system.review.decision', {
          agentInstanceId,
          decision: parsed.payload.decision,
          feedback: parsed.payload.feedback,
        })
      }
      return {
        agentInstanceId,
        branchName,
        status,
        ...(parsed.payload?.decision !== undefined ? { decision: parsed.payload.decision } : {}),
        ...(parsed.payload?.feedback !== undefined ? { feedback: parsed.payload.feedback } : {}),
        summary: parsed.freeFormSummary.slice(0, SUMMARY_MAX),
        ...(error !== undefined ? { error } : {}),
      }
    }

    return {
      agentInstanceId,
      branchName,
      status,
      summary: summary.slice(0, SUMMARY_MAX),
      ...(error !== undefined ? { error } : {}),
    }
  }

  private publishSystemEvent(topic: string, payload: unknown): void {
    this.deps.blackboardStore.insert({
      id: ulid(),
      workflowInstanceId: this.deps.workflowInstanceId,
      topic,
      publisherAgentId: null,
      payload,
      publishedAt: Date.now(),
    })
  }

  private async resolveSpawnInputs(
    input: DelegateToolInput,
  ): Promise<{ agentInstanceId: string; branchName: string; workspacePath: string; edgeType: string }> {
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

    return { agentInstanceId, branchName, workspacePath: ws.path, edgeType: target.edgeType }
  }

  private async runSpawnedAgent(
    agentInstanceId: string,
    input: DelegateToolInput,
    workspacePath: string,
    outputSchema?: unknown,
  ): Promise<{ summary: string; status: 'completed' | 'failed'; error?: string }> {
    let summary = ''
    let status: 'completed' | 'failed' = 'completed'
    let error: string | undefined

    try {
      const handle = await this.deps.provider.launch({
        workdir: workspacePath,
        role: input.role,
        initialPrompt: `${defaultSystemPromptFor(input.role)}\n\nTask: ${input.prompt}`,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
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

    return { summary, status, ...(error !== undefined ? { error } : {}) }
  }

  private nextSeqForRole(roleNodeId: string): number {
    const rows = this.deps.agentInstanceStore.listByWorkflow(this.deps.workflowInstanceId)
    return rows.filter((r) => r.roleNodeId === roleNodeId).length + 1
  }
}
