import type { AppRuntime } from '../../app'

export async function handleApproval(
  instanceId: string,
  approvalId: string,
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as { decision?: 'approve' | 'deny'; reason?: string }

  const sessionId = ctx.approvalIdToSessionId.get(approvalId)
  if (!sessionId) return new Response('Approval not found', { status: 404 })
  const adapter = ctx.adapters.get(instanceId)
  if (!adapter) return new Response('Instance not found', { status: 404 })

  if (body.decision === 'approve') {
    await adapter.approve(sessionId, approvalId)
    return new Response(null, { status: 204 })
  }
  if (body.decision === 'deny') {
    await adapter.deny(sessionId, approvalId, body.reason)
    return new Response(null, { status: 204 })
  }
  return new Response('decision must be "approve" or "deny"', { status: 400 })
}
