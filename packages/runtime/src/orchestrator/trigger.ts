import { ulid } from 'ulid'
import type { WorkflowTemplate, AgentProvider } from '@legion/core'
import type { EventLog } from '../eventlog/eventlog'
import type { InstanceStore } from './instance-store'
import type { WorkspaceProvider } from '../workspace/provider'
import { resolveCommitSha } from '../workspace/git'
import { firstRoleNode, buildInitialPrompt } from './spawn-agent'

export interface TriggerInput {
  template: WorkflowTemplate
  userPrompt: string
  repoPath: string
  baseRef: string
  workspaceProvider: WorkspaceProvider
  adapter: AgentProvider
  instanceStore: InstanceStore
  eventLog: EventLog
}

export interface TriggerResult {
  workflowInstanceId: string
  sessionId: string
}

export async function triggerWorkflow(input: TriggerInput): Promise<TriggerResult> {
  const role = firstRoleNode(input.template)
  if (!role) throw new Error('Template has no Role node to spawn')
  const baseCommitSha = await resolveCommitSha(input.repoPath, input.baseRef)
  const instance = input.instanceStore.create({
    templateId: input.template.id,
    templateSnapshot: input.template,
    baseCommitSha,
  })
  const agentInstanceId = ulid()
  const workspace = await input.workspaceProvider.create({
    workflowInstanceId: instance.id,
    agentInstanceId,
    role: role.role,
    seq: 1,
    baseCommitSha,
  })
  const handle = await input.adapter.launch({
    workdir: workspace.path,
    role: role.role,
    initialPrompt: buildInitialPrompt(role, input.userPrompt),
  })
  // Drain the stream in the background; events flow into the event log.
  void drainStream(input, instance.id, handle.sessionId)
  return { workflowInstanceId: instance.id, sessionId: handle.sessionId }
}

async function drainStream(
  input: TriggerInput,
  workflowInstanceId: string,
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
  } catch (err) {
    input.eventLog.append(workflowInstanceId, {
      id: ulid(),
      sessionId,
      type: 'error',
      payload: { message: (err as Error).message },
      timestamp: new Date(),
    })
    input.instanceStore.updateStatus(workflowInstanceId, 'failed')
  }
}
