import { ulid } from 'ulid'
import type { WorkflowTemplate, AgentProvider } from '@legion/core'
import type { EventLog } from '../eventlog/eventlog'
import type { InstanceStore } from './instance-store'
import type { AgentInstanceStore } from '../store/agent-instance-store'
import type { WorkspaceProvider } from '../workspace/provider'
import { resolveCommitSha } from '../workspace/git'
import { buildInitialPrompt } from './spawn-agent'
import { resolveTriggerTargets } from './graph-walker'
import { DelegateToolHandler } from './delegate-tool'
import { loadLegionConfig } from '../config/loader'
import { runWorktreeSetup } from '../config/setup-runner'

export interface TriggerInput {
  template: WorkflowTemplate
  userPrompt: string
  repoPath: string
  baseRef: string
  workspaceProvider: WorkspaceProvider
  adapter: AgentProvider
  instanceStore: InstanceStore
  agentInstanceStore: AgentInstanceStore
  eventLog: EventLog
}

export interface TriggerResult {
  workflowInstanceId: string
  sessionId: string
}

export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  const triggerTargets = resolveTriggerTargets(input.template)
  if (triggerTargets.length === 0) {
    throw new Error(`template ${input.template.id} has no triggers→role edge`)
  }
  const directorNode = triggerTargets[0]!

  const baseCommitSha = await resolveCommitSha(input.repoPath, input.baseRef)
  const instance = input.instanceStore.create({
    templateId: input.template.id,
    templateSnapshot: input.template,
    baseCommitSha,
  })

  const directorAgentInstanceId = ulid()
  const directorWs = await input.workspaceProvider.create({
    workflowInstanceId: instance.id,
    agentInstanceId: directorAgentInstanceId,
    role: directorNode.role,
    seq: 1,
    baseCommitSha,
  })
  // Director worktree is --detach, so ws.ref has no branch field.
  const directorBranch =
    directorWs.ref.kind === 'owned' && 'branch' in directorWs.ref
      ? directorWs.ref.branch ?? null
      : null

  input.agentInstanceStore.insert({
    id: directorAgentInstanceId,
    workflowInstanceId: instance.id,
    roleNodeId: directorNode.id,
    sessionId: 'pending',
    parentAgentInstanceId: null,
    spawnEdgeId: null,
    status: 'starting',
    workspaceKind: 'owned',
    workspacePath: directorWs.path,
    branchName: directorBranch,
    startedAt: new Date(),
    endedAt: null,
  })

  const config = await loadLegionConfig(input.repoPath)
  await runWorktreeSetup({
    mainRepoPath: input.repoPath,
    worktreePath: directorWs.path,
    config,
  })

  const delegateHandler = new DelegateToolHandler({
    workflowInstanceId: instance.id,
    parentAgentInstanceId: directorAgentInstanceId,
    parentSessionId: 'pending',
    agentInstanceStore: input.agentInstanceStore,
    workspaceProvider: input.workspaceProvider,
    provider: input.adapter,
    eventLog: { write: (evt) => input.eventLog.append(instance.id, evt) },
    template: input.template,
    baseCommitSha,
  })
  const customTools = [
    {
      name: 'mcp__legion__delegate',
      description:
        'Spawn an Implementer agent and wait for it to finish. Returns { agentInstanceId, branchName, status, summary }.',
      inputSchema: {
        type: 'object',
        properties: {
          role: { type: 'string' },
          prompt: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['role', 'prompt'],
      },
      handler: (toolInput: unknown) =>
        delegateHandler.handle(toolInput as never),
    },
  ]

  const handle = await input.adapter.launch({
    workdir: directorWs.path,
    role: directorNode.role,
    initialPrompt: buildInitialPrompt({
      role: directorNode.role,
      userPrompt: input.userPrompt,
    }),
    customTools,
  })

  input.agentInstanceStore.updateSessionId(directorAgentInstanceId, handle.sessionId)
  input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'running')

  // Drain the stream in the background; events flow into the event log.
  void drainStream(input, instance.id, directorAgentInstanceId, handle.sessionId)
  return { workflowInstanceId: instance.id, sessionId: handle.sessionId }
}

async function drainStream(
  input: TriggerInput,
  workflowInstanceId: string,
  directorAgentInstanceId: string,
  sessionId: string,
): Promise<void> {
  try {
    for await (const evt of input.adapter.stream(sessionId)) {
      input.eventLog.append(workflowInstanceId, evt)
      if (evt.type === 'status_change') {
        const status = (evt.payload as { status?: string }).status
        if (status === 'completed')
          input.instanceStore.updateStatus(workflowInstanceId, 'completed')
        if (status === 'failed')
          input.instanceStore.updateStatus(workflowInstanceId, 'failed')
      }
    }
    input.agentInstanceStore.setEndedAt(directorAgentInstanceId, new Date())
    input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'completed')
  } catch (err) {
    input.eventLog.append(workflowInstanceId, {
      id: ulid(),
      sessionId,
      type: 'error',
      payload: { message: (err as Error).message },
      timestamp: new Date(),
    })
    input.instanceStore.updateStatus(workflowInstanceId, 'failed')
    input.agentInstanceStore.setEndedAt(directorAgentInstanceId, new Date())
    input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'failed')
  }
}
