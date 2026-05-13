import type { Server } from 'bun'
import type { Database } from 'bun:sqlite'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BunServer = Server<any>
import type { AgentProvider } from '@legion/core'
import type { TemplateRegistry } from '@legion/runtime/template/registry'
import { InstanceStore } from '@legion/runtime/orchestrator/instance-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { route } from './http/routes'

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
  log: EventLog
  worktree: LocalWorktreeProvider
  /** workflowInstanceId → { adapter, sessionId }, populated on trigger. */
  adapters: Map<string, { adapter: AgentProvider; sessionId: string }>
}

export interface AppHandle {
  port: number
  runtime: AppRuntime
  stop(): Promise<void>
}

export async function startApp(opts: AppOptions): Promise<AppHandle> {
  const runtime: AppRuntime = {
    options: opts,
    store: new InstanceStore(opts.db),
    log: new EventLog(opts.db),
    worktree: new LocalWorktreeProvider({
      repoPath: opts.repoPath,
      baseDir: opts.worktreeBaseDir,
    }),
    adapters: new Map(),
  }
  const server: BunServer = Bun.serve({
    port: opts.port,
    fetch: (req, srv) => route(req, srv, runtime),
  })
  return {
    port: server.port ?? opts.port,
    runtime,
    stop: async () => {
      server.stop()
    },
  }
}
