import type { AppRuntime } from '../../app'

export async function handleApproval(
  instanceId: string,
  approvalId: string,
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const body = (await req.json()) as { decision?: 'approve' | 'deny'; reason?: string }
  const entry = ctx.adapters.get(instanceId)
  if (!entry) return new Response('Not Found', { status: 404 })
  if (body.decision === 'approve') {
    await entry.adapter.approve(entry.sessionId, approvalId)
    return new Response(null, { status: 204 })
  }
  if (body.decision === 'deny') {
    await entry.adapter.deny(entry.sessionId, approvalId, body.reason)
    return new Response(null, { status: 204 })
  }
  return new Response('decision must be "approve" or "deny"', { status: 400 })
}
