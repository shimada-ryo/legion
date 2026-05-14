import type { AppRuntime } from '../../app'
import type { WorkflowTemplate } from '@legion/core'
import {
  writeTemplatePositions,
  type PositionMap,
} from '@legion/runtime/template/writer'

export async function handleTemplates(
  req: Request,
  ctx: AppRuntime,
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/api/templates' && req.method === 'GET') {
    const list = ctx.options.templates.list().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      nodeCount: t.nodes.length,
    }))
    return Response.json(list)
  }

  const patchMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/positions$/)
  if (patchMatch && req.method === 'PATCH') {
    const id = patchMatch[1]!
    const sourcePath = ctx.options.templates.sourcePathOf(id)
    const template = ctx.options.templates.get(id)
    if (!sourcePath || !template) return new Response('Not Found', { status: 404 })

    const body = await req.json().catch(() => null)
    const validated = validatePositions(body, template)
    if ('error' in validated) {
      return new Response(validated.error, { status: 400 })
    }

    try {
      await writeTemplatePositions(sourcePath, validated.value)
      await ctx.options.templates.refreshOne(id)
    } catch (e) {
      return new Response(`write failed: ${(e as Error).message}`, { status: 500 })
    }
    return Response.json(ctx.options.templates.get(id))
  }

  const getMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/)
  if (getMatch && req.method === 'GET') {
    const t = ctx.options.templates.get(getMatch[1]!)
    if (!t) return new Response('Not Found', { status: 404 })
    return Response.json(t)
  }

  return new Response('Method Not Allowed', { status: 405 })
}

function validatePositions(
  body: unknown,
  template: WorkflowTemplate,
): { value: PositionMap } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' }
  const raw = (body as Record<string, unknown>)['positions']
  if (typeof raw !== 'object' || raw === null) return { error: 'positions must be an object' }
  const knownIds = new Set(template.nodes.map((n) => n.id))
  const out: PositionMap = {}
  for (const [id, pos] of Object.entries(raw)) {
    if (!knownIds.has(id)) return { error: `unknown node id: ${id}` }
    if (typeof pos !== 'object' || pos === null) return { error: `positions.${id} must be object` }
    const p = pos as Record<string, unknown>
    if (typeof p['x'] !== 'number' || typeof p['y'] !== 'number') {
      return { error: `positions.${id} requires numeric x, y` }
    }
    if (!Number.isFinite(p['x']) || !Number.isFinite(p['y'])) {
      return { error: `positions.${id} must have finite x, y` }
    }
    out[id] = { x: p['x'], y: p['y'] }
  }
  return { value: out }
}
