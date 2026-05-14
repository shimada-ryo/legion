import type { AppRuntime } from '../../app'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import { resolveTriggerTargets } from '@legion/runtime/orchestrator/graph-walker'

export async function handleWorkflowsTrigger(
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as {
    templateId?: string
    userPrompt?: string
    baseRef?: string
  }
  const templateId = body.templateId
  const userPrompt = body.userPrompt ?? ''
  if (!templateId) return new Response('templateId required', { status: 400 })
  const template = ctx.options.templates.get(templateId)
  if (!template) return new Response('Unknown template', { status: 404 })
  const { workflowInstanceId } = await triggerWorkflow({
    template,
    userPrompt,
    repoPath: ctx.options.repoPath,
    baseRef: body.baseRef ?? 'HEAD',
    workspaceProvider: ctx.worktree,
    providersByName: ctx.providersByName,
    instanceStore: ctx.store,
    agentInstanceStore: ctx.agentInstanceStore,
    eventLog: ctx.log,
    blackboardStore: ctx.blackboardStore,
  })
  // Keep the per-workflow provider reference for approval flow routing.
  const directorNode = resolveTriggerTargets(template)[0]
  const directorProvider = directorNode
    ? ctx.providersByName.get(directorNode.provider)
    : undefined
  if (directorProvider) ctx.adapters.set(workflowInstanceId, directorProvider)
  return Response.json({ workflowInstanceId }, { status: 202 })
}

export function handleInstancesList(_req: Request, ctx: AppRuntime): Response {
  const list = ctx.store.list().map((i) => ({
    id: i.id,
    templateId: i.templateId,
    status: i.status,
    startedAt: i.startedAt.toISOString(),
    endedAt: i.endedAt ? i.endedAt.toISOString() : null,
  }))
  return Response.json(list)
}

export function handleInstanceDetail(
  id: string,
  req: Request,
  ctx: AppRuntime,
): Response {
  const inst = ctx.store.get(id)
  if (!inst) return new Response('Not Found', { status: 404 })
  const events = ctx.log.history(id)
  const agentInstances = ctx.agentInstanceStore.listByWorkflow(id).map((r) => ({
    id: r.id,
    roleNodeId: r.roleNodeId,
    workflowInstanceId: r.workflowInstanceId,
    sessionId: r.sessionId,
    status: r.status,
    parentAgentInstanceId: r.parentAgentInstanceId ?? undefined,
    spawnEdgeId: r.spawnEdgeId ?? undefined,
    workspace: { kind: r.workspaceKind, path: r.workspacePath },
    branchName: r.branchName ?? undefined,
    tasks: [],
    inbox: [],
    subscriptions: [],
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  }))

  // Phase 3 (§ 8.4): expose Blackboard messages for the Reviewer flow.
  const url = new URL(req.url)
  const topicPrefix = url.searchParams.get('topicPrefix') ?? undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Math.max(1, parseInt(limitRaw, 10) || 200) : 200
  let blackboardMessages = ctx.blackboardStore.listByWorkflow(id, { limit })
  if (topicPrefix) {
    blackboardMessages = blackboardMessages.filter((m) => m.topic.startsWith(topicPrefix))
  }

  return Response.json({
    id: inst.id,
    templateId: inst.templateId,
    templateSnapshot: inst.templateSnapshot,
    status: inst.status,
    startedAt: inst.startedAt.toISOString(),
    endedAt: inst.endedAt ? inst.endedAt.toISOString() : null,
    agentInstances,
    events,
    blackboardMessages,
  })
}
