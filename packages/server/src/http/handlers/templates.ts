import type { AppRuntime } from '../../app'

export function handleTemplates(req: Request, ctx: AppRuntime): Response {
  const url = new URL(req.url)
  if (url.pathname === '/templates' && req.method === 'GET') {
    const list = ctx.options.templates.list().map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      nodeCount: t.nodes.length,
    }))
    return Response.json(list)
  }
  const m = url.pathname.match(/^\/templates\/([^/]+)$/)
  if (m && req.method === 'GET') {
    const t = ctx.options.templates.get(m[1]!)
    if (!t) return new Response('Not Found', { status: 404 })
    return Response.json(t)
  }
  return new Response('Method Not Allowed', { status: 405 })
}
