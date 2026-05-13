// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunServer = import('bun').Server<any>
import type { AppRuntime } from '../app'
import { handleTemplates } from './handlers/templates'
import {
  handleInstancesList,
  handleInstanceDetail,
  handleWorkflowsTrigger,
} from './handlers/instances'
import { handleApproval } from './handlers/approvals'

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
  if (path === '/workflows/trigger') {
    return handleWorkflowsTrigger(req, ctx)
  }
  if (path === '/instances') {
    return handleInstancesList(req, ctx)
  }
  const a = path.match(/^\/instances\/([^/]+)\/approvals\/([^/]+)$/)
  if (a) return handleApproval(a[1]!, a[2]!, req, ctx)
  const m = path.match(/^\/instances\/([^/]+)$/)
  if (m) return handleInstanceDetail(m[1]!, ctx)
  return new Response('Not Found', { status: 404 })
}
