import type { Server } from 'bun'
import type { Database } from 'bun:sqlite'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunServer = Server<any>
import type { AgentProvider } from '@legion/core'
import type { TemplateRegistry } from '@legion/runtime/template/registry'
import { InstanceStore } from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { BlackboardStore } from '@legion/runtime/store/blackboard-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { runOrphanRecovery } from './boot/orphan-recovery'
import { route } from './http/routes'
import { wsHandlers, type WsData } from './ws/event-stream'

export interface AppOptions {
  port: number
  db: Database
  templates: TemplateRegistry
  repoPath: string
  worktreeBaseDir: string
  adapterFactory: () => AgentProvider
}

export interface AppRuntime {
  options: AppOptions
  store: InstanceStore
  agentInstanceStore: AgentInstanceStore
  blackboardStore: BlackboardStore
  log: EventLog
  worktree: LocalWorktreeProvider
  /** workflowInstanceId → provider (one provider instance per workflow; sessions live in agentInstanceStore). */
  adapters: Map<string, AgentProvider>
  /** approvalId → sessionId, populated when permission_request events flow through. */
  approvalIdToSessionId: Map<string, string>
}

export interface AppHandle {
  port: number
  runtime: AppRuntime
  stop(): Promise<void>
}

export async function startApp(opts: AppOptions): Promise<AppHandle> {
  initAgentInstanceSchema(opts.db)
  const blackboardStore = new BlackboardStore(opts.db)
  blackboardStore.initSchema()
  runOrphanRecovery({ db: opts.db })
  const runtime: AppRuntime = {
    options: opts,
    store: new InstanceStore(opts.db),
    agentInstanceStore: new AgentInstanceStore(opts.db),
    blackboardStore,
    log: new EventLog(opts.db),
    worktree: new LocalWorktreeProvider({
      repoPath: opts.repoPath,
      baseDir: opts.worktreeBaseDir,
    }),
    adapters: new Map(),
    approvalIdToSessionId: new Map(),
  }
  runtime.log.onAny((evt) => {
    if (evt.type === 'permission_request') {
      const approvalId = (evt.payload as { approvalId?: unknown }).approvalId
      if (typeof approvalId === 'string' && approvalId)
        runtime.approvalIdToSessionId.set(approvalId, evt.sessionId)
    }
  })
  const server: BunServer = Bun.serve<WsData>({
    port: opts.port,
    fetch: (req, srv) => {
      const url = new URL(req.url)
      const m = url.pathname.match(/^\/api\/ws\/instances\/([^/]+)\/events$/)
      if (m) {
        const upgraded = srv.upgrade(req, {
          data: { workflowInstanceId: m[1]!, stop: null } satisfies WsData,
        })
        if (upgraded) return undefined as unknown as Response
        return new Response('Upgrade failed', { status: 400 })
      }
      return route(req, srv, runtime)
    },
    websocket: wsHandlers(runtime),
  })
  return {
    port: server.port ?? opts.port,
    runtime,
    stop: async () => {
      server.stop()
    },
  }
}
