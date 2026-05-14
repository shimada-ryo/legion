import { ulid } from 'ulid'
import type { LaunchRequest } from '@legion/core'
import { defaultAllowedToolsFor } from '../role-profile'
import { ApprovalOrchestrator } from '../approval'
import { EventInjector } from '../session-store'

export type QueryFn = (input: unknown) => AsyncIterable<unknown>

export interface LaunchedSession {
  sessionId: string
  iter: AsyncIterable<unknown>
  approval: ApprovalOrchestrator
  injector: EventInjector
  workdir: string
  role: string
}

export function launchSession(req: LaunchRequest, query: QueryFn): LaunchedSession {
  const sessionId = ulid()
  const allowed = defaultAllowedToolsFor(req.role)
  const approval = new ApprovalOrchestrator(allowed)
  const injector = new EventInjector()

  approval.on('permission_request', (permReq) => {
    injector.push({
      id: ulid(),
      sessionId,
      type: 'permission_request',
      payload: {
        approvalId: permReq.approvalId,
        tool: permReq.tool,
        input: permReq.input,
      },
      timestamp: new Date(),
    })
  })

  const iter = query({
    prompt: req.initialPrompt,
    options: {
      cwd: req.workdir,
      allowedTools: allowed,
      permissionMode: 'default',
      canUseTool: async (toolName: string, input: Record<string, unknown>) => {
        const d = await approval.decide({ tool: toolName, input })
        return d.allow
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: d.reason ?? 'denied' }
      },
      ...(req.mcpServers !== undefined
        ? { mcpServers: req.mcpServers as Record<string, import('@anthropic-ai/claude-agent-sdk').McpServerConfig> }
        : {}),
      ...(req.model !== undefined ? { model: req.model } : {}),
      ...(req.env !== undefined ? { env: req.env } : {}),
    },
  })

  return { sessionId, iter, approval, injector, workdir: req.workdir, role: req.role }
}
