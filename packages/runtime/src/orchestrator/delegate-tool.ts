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
import { debugLog } from '../util/logger'

// OpenAI's response_format JSON Schema requires `additionalProperties: false`
// (verified via contract test against real Codex SDK / OpenAI API, 2026-05-15).
// Omitting it surfaces as `invalid_json_schema` from the API.
const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
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
  providers: Map<string, AgentProvider>
  eventLog: EventLogWriter
  template: WorkflowTemplate
  baseCommitSha: string
  blackboardStore: BlackboardStore
}

const SUMMARY_MAX = 500
const EVENT_PAYLOAD_PREVIEW_MAX = 200

export const DELEGATE_TOPICS = {
  START: 'system.delegate.start',
  RESULT: 'system.delegate.result',
  REVIEW_DECISION: 'system.review.decision',
} as const

interface SpawnInputs {
  agentInstanceId: string
  branchName: string
  workspacePath: string
  edgeType: 'delegates' | 'reviews'
  provider: AgentProvider
}

export class DelegateToolHandler {
  constructor(private readonly deps: DelegateToolDeps) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    debugLog('delegate.handle.enter', {
      workflowId: this.deps.workflowInstanceId,
      parentAgentId: this.deps.parentAgentInstanceId,
      role: input.role,
    })
    const { agentInstanceId, branchName, workspacePath, edgeType, provider } =
      await this.resolveSpawnInputs(input)
    debugLog('delegate.handle.spawn', {
      workflowId: this.deps.workflowInstanceId,
      agentInstanceId,
      branchName,
      workspacePath,
      edgeType,
      providerId: provider.id,
    })

    this.publishSystemEvent(DELEGATE_TOPICS.START, {
      fromAgentInstanceId: this.deps.parentAgentInstanceId,
      toAgentInstanceId: agentInstanceId,
      role: input.role,
      edgeType,
      prompt: input.prompt.slice(0, EVENT_PAYLOAD_PREVIEW_MAX),
    })

    const outputSchema = edgeType === 'reviews' ? REVIEW_OUTPUT_SCHEMA : undefined
    const { summary, status, error } = await this.runSpawnedAgent(
      agentInstanceId,
      input,
      workspacePath,
      provider,
      outputSchema,
    )
    debugLog('delegate.handle.drained', {
      agentInstanceId,
      status,
      summaryLen: summary.length,
      hasError: error !== undefined,
    })

    this.publishSystemEvent(DELEGATE_TOPICS.RESULT, {
      agentInstanceId,
      role: input.role,
      status,
      summary: summary.slice(0, EVENT_PAYLOAD_PREVIEW_MAX),
    })

    if (edgeType === 'reviews') {
      const parsed = parseReviewerOutput(summary)
      debugLog('delegate.handle.reviewerParse', {
        agentInstanceId,
        decision: parsed.payload?.decision,
        parsedOk: parsed.payload !== undefined,
      })
      if (parsed.payload !== undefined) {
        this.publishSystemEvent(DELEGATE_TOPICS.REVIEW_DECISION, {
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

  private resolveProvider(roleNodeId: string): AgentProvider {
    const targetNode = this.deps.template.nodes.find((n) => n.id === roleNodeId)
    if (!targetNode || targetNode.type !== 'role') {
      throw new Error(`delegate: target node '${roleNodeId}' is not a role node`)
    }
    const providerName = targetNode.provider
    const provider = this.deps.providers.get(providerName)
    if (!provider) {
      const registered = [...this.deps.providers.keys()].join(', ')
      throw new Error(
        `delegate: provider '${providerName}' is not registered (registered: ${registered})`,
      )
    }
    return provider
  }

  private async resolveSpawnInputs(input: DelegateToolInput): Promise<SpawnInputs> {
    const parentRow = this.deps.agentInstanceStore.byId(this.deps.parentAgentInstanceId)
    const fromRoleNodeId = parentRow?.roleNodeId ?? 'director'

    const targets = resolveDelegateTargets(this.deps.template, fromRoleNodeId)
    const target = targets.find((t) => t.roleName === input.role)
    if (!target) {
      throw new Error(
        `delegate: no delegates edge from '${fromRoleNodeId}' to role '${input.role}' in template`,
      )
    }

    const provider = this.resolveProvider(target.roleNodeId)

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

    return { agentInstanceId, branchName, workspacePath: ws.path, edgeType: target.edgeType, provider }
  }

  private async runSpawnedAgent(
    agentInstanceId: string,
    input: DelegateToolInput,
    workspacePath: string,
    provider: AgentProvider,
    outputSchema?: unknown,
  ): Promise<{ summary: string; status: 'completed' | 'failed'; error?: string }> {
    let summary = ''
    let status: 'completed' | 'failed' = 'completed'
    let error: string | undefined
    let sessionId: string | undefined

    try {
      debugLog('runSpawned.launch.start', {
        agentInstanceId,
        providerId: provider.id,
        role: input.role,
        hasOutputSchema: outputSchema !== undefined,
      })
      const handle = await provider.launch({
        workdir: workspacePath,
        role: input.role,
        initialPrompt: `${defaultSystemPromptFor(input.role)}\n\nTask: ${input.prompt}`,
        ...(outputSchema !== undefined ? { outputSchema } : {}),
      })
      sessionId = handle.sessionId
      debugLog('runSpawned.launch.done', { agentInstanceId, sessionId })
      this.deps.agentInstanceStore.updateSessionId(agentInstanceId, handle.sessionId)
      this.deps.agentInstanceStore.updateStatus(agentInstanceId, 'running')

      let evtCount = 0
      for await (const evt of provider.stream(handle.sessionId)) {
        evtCount++
        this.deps.eventLog.write(evt)
        if (evt.type === 'message' || evt.type === 'assistant_message') {
          const p = evt.payload as { text?: string; content?: string }
          const t = p.text ?? p.content
          if (typeof t === 'string') summary = t
        }
      }
      debugLog('runSpawned.drain.done', {
        agentInstanceId,
        sessionId,
        evtCount,
        summaryLen: summary.length,
      })
    } catch (e) {
      status = 'failed'
      error = e instanceof Error ? e.message : String(e)
    } finally {
      if (sessionId !== undefined) {
        // Release provider-side session state (matters for Codex's CodexSessionStore;
        // no-op for Claude). Errors here must not override the spawned agent's status.
        try { await provider.shutdown(sessionId) } catch { /* swallow */ }
      }
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
