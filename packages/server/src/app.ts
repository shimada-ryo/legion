import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import { CodexSdkProvider } from '@legion/runtime/adapter/codex/codex-provider'
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
  /** All registered providers keyed by their id. */
  providersByName: Map<string, AgentProvider>
  /** approvalId → sessionId, populated when permission_request events flow through. */
  approvalIdToSessionId: Map<string, string>
}

export interface AppHandle {
  port: number
  runtime: AppRuntime
  stop(): Promise<void>
}

function buildProviders(opts: AppOptions): Map<string, AgentProvider> {
  const claudeProvider = opts.adapterFactory()
  const codexProvider = new CodexSdkProvider()

  const codexAuthPath = join(homedir(), '.codex', 'auth.json')
  const hasChatgptOauth = existsSync(codexAuthPath)
  const hasCodexApiKey = Boolean(process.env['CODEX_API_KEY'])
  if (!hasChatgptOauth && !hasCodexApiKey) {
    console.warn(
      '[legion] codex provider is registered but no ChatGPT OAuth (~/.codex/auth.json) ' +
        'or CODEX_API_KEY found.\n' +
        '  Run `codex login` or set CODEX_API_KEY before triggering workflows that use codex.\n' +
        '  DO NOT set OPENAI_API_KEY alongside ChatGPT OAuth — it may be ignored (openai/codex#3286).',
    )
  }

  const map = new Map<string, AgentProvider>()
  map.set(claudeProvider.id, claudeProvider)
  map.set(codexProvider.id, codexProvider)
  return map
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
    providersByName: buildProviders(opts),
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
