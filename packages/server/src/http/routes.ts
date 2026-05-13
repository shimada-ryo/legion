// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunServer = import('bun').Server<any>
import type { AppRuntime } from '../app'
import { handleTemplates } from './handlers/templates'

export function route(
  req: Request,
  _srv: BunServer,
  ctx: AppRuntime,
): Response | Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname
  if (path === '/templates' || path.startsWith('/templates/')) {
    return handleTemplates(req, ctx)
  }
  return new Response('Not Found', { status: 404 })
}
