import type { AppRuntime } from '../../app'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'

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
  const adapter = ctx.options.adapterFactory()
  const { workflowInstanceId } = await triggerWorkflow({
    template,
    userPrompt,
    repoPath: ctx.options.repoPath,
    baseRef: body.baseRef ?? 'HEAD',
    workspaceProvider: ctx.worktree,
    adapter,
    instanceStore: ctx.store,
    agentInstanceStore: ctx.agentInstanceStore,
    eventLog: ctx.log,
  })
  ctx.adapters.set(workflowInstanceId, adapter)
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

export function handleInstanceDetail(id: string, ctx: AppRuntime): Response {
  const inst = ctx.store.get(id)
  if (!inst) return new Response('Not Found', { status: 404 })
  const events = ctx.log.history(id)
  const rows = ctx.agentInstanceStore.listByWorkflow(id)
  const agentInstances = rows.map((r) => ({
    id: r.id,
    roleNodeId: r.roleNodeId,
    workflowInstanceId: r.workflowInstanceId,
    sessionId: r.sessionId,
    status: r.status,
    parentAgentInstanceId: r.parentAgentInstanceId ?? undefined,
    spawnEdgeId: r.spawnEdgeId ?? undefined,
    workspace: { kind: r.workspaceKind, path: r.workspacePath } as const,
    branchName: r.branchName ?? undefined,
    tasks: [],
    inbox: [],
    subscriptions: [],
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
  }))
  return Response.json({
    id: inst.id,
    templateId: inst.templateId,
    templateSnapshot: inst.templateSnapshot,
    status: inst.status,
    startedAt: inst.startedAt.toISOString(),
    endedAt: inst.endedAt ? inst.endedAt.toISOString() : null,
    agentInstances,
    events,
  })
}
