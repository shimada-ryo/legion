import { ulid } from 'ulid'
import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import type { WorkflowTemplate, AgentProvider, DelegateToolInput } from '@legion/core'
import type { EventLog } from '../eventlog/eventlog'
import type { InstanceStore } from './instance-store'
import { PENDING_SESSION_ID, type AgentInstanceStore } from '../store/agent-instance-store'
import type { WorkspaceProvider } from '../workspace/provider'
import { resolveCommitSha } from '../workspace/git'
import { buildInitialPrompt } from './spawn-agent'
import { resolveTriggerTargets } from './graph-walker'
import { DelegateToolHandler } from './delegate-tool'
import { loadLegionConfig } from '../config/loader'
import { runWorktreeSetup } from '../config/setup-runner'
import type { BlackboardStore } from '../store/blackboard-store'
import { debugLog } from '../util/logger'

export interface TriggerInput {
  template: WorkflowTemplate
  userPrompt: string
  repoPath: string
  baseRef: string
  workspaceProvider: WorkspaceProvider
  providersByName: Map<string, AgentProvider>
  instanceStore: InstanceStore
  agentInstanceStore: AgentInstanceStore
  eventLog: EventLog
  blackboardStore: BlackboardStore
}

export interface TriggerResult {
  workflowInstanceId: string
  sessionId: string
}

export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  debugLog('trigger.start', {
    templateId: input.template.id,
    providers: [...input.providersByName.keys()],
  })
  const triggerTargets = resolveTriggerTargets(input.template)
  if (triggerTargets.length === 0) {
    throw new Error(`template ${input.template.id} has no triggers→role edge`)
  }
  const directorNode = triggerTargets[0]!
  const directorProvider = input.providersByName.get(directorNode.provider)
  if (!directorProvider) {
    throw new Error(
      `provider '${directorNode.provider}' not registered (template ${input.template.id})`,
    )
  }

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
    sessionId: PENDING_SESSION_ID,
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
    agentInstanceStore: input.agentInstanceStore,
    workspaceProvider: input.workspaceProvider,
    providers: input.providersByName,
    eventLog: { write: (evt) => input.eventLog.append(instance.id, evt) },
    template: input.template,
    baseCommitSha,
    blackboardStore: input.blackboardStore,
  })
  const delegateTool = tool(
    'delegate',
    'Spawn an Implementer agent and wait for it to finish. Returns { agentInstanceId, branchName, status, summary }.',
    {
      role: z.string(),
      prompt: z.string(),
      rationale: z.string().optional(),
    },
    async (args) => {
      const result = await delegateHandler.handle(args as DelegateToolInput)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      }
    },
  )

  const legionMcpServer = createSdkMcpServer({
    name: 'legion',
    tools: [delegateTool],
  })

  const handle = await directorProvider.launch({
    workdir: directorWs.path,
    role: directorNode.role,
    initialPrompt: buildInitialPrompt({
      role: directorNode.role,
      userPrompt: input.userPrompt,
    }),
    mcpServers: { legion: legionMcpServer },
  })

  input.agentInstanceStore.updateSessionId(directorAgentInstanceId, handle.sessionId)
  input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'running')
  debugLog('trigger.directorLaunched', {
    workflowId: instance.id,
    directorAgentInstanceId,
    sessionId: handle.sessionId,
  })

  // Drain the stream in the background; events flow into the event log.
  void drainStream(input, directorProvider, instance.id, directorAgentInstanceId, handle.sessionId)
  return { workflowInstanceId: instance.id, sessionId: handle.sessionId }
}

async function drainStream(
  input: TriggerInput,
  provider: AgentProvider,
  workflowInstanceId: string,
  directorAgentInstanceId: string,
  sessionId: string,
): Promise<void> {
  try {
    let evtCount = 0
    for await (const evt of provider.stream(sessionId)) {
      evtCount++
      input.eventLog.append(workflowInstanceId, evt)
      if (evt.type === 'status_change') {
        const status = (evt.payload as { status?: string }).status
        debugLog('drainStream.statusChange', { workflowInstanceId, status, evtCount })
        if (status === 'completed')
          input.instanceStore.updateStatus(workflowInstanceId, 'completed')
        if (status === 'failed')
          input.instanceStore.updateStatus(workflowInstanceId, 'failed')
      }
    }
    debugLog('drainStream.done', { workflowInstanceId, evtCount })
    input.agentInstanceStore.setEndedAt(directorAgentInstanceId, new Date())
    input.agentInstanceStore.updateStatus(directorAgentInstanceId, 'completed')
  } catch (err) {
    debugLog('drainStream.error', { workflowInstanceId, error: (err as Error).message })
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
