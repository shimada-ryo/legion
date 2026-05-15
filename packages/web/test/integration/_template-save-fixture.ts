// Subprocess fixture for template-save integration test.
// Boots a real @legion/server, prints "READY PORT=N" on stdout, then waits.
// Runs in a clean Bun process — no happy-dom pollution.
import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { startApp } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { AgentProvider } from '@legion/core'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

function noopProvider(): AgentProvider {
  return {
    id: 'claude-code',
    displayName: 'mock',
    capabilities: {
      supportsCheckpoint: false,
      supportsResume: false,
      supportsAttach: false,
      supportsApprovalFlow: false,
    },
    detect: async () => ({ installed: true }),
    authenticate: async () => ({ authenticated: true }),
    launch: async () => ({ sessionId: 's' }),
    stream: async function* () {},
    send: async () => {},
    interrupt: async () => {},
    approve: async () => {},
    deny: async () => {},
    status: async () => ({}),
    checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
    resume: async () => ({ sessionId: '' }),
    shutdown: async () => {},
    exportTranscript: async () => ({ sessionId: '', events: [] }),
  }
}

async function main(): Promise<void> {
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  const baseDir = await mkdtemp(join(tmpdir(), 'legion-tpl-int-'))
  const templates = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await templates.refresh()
  const server = await startApp({
    port: 0,
    db,
    templates,
    repoPath: REPO_ROOT,
    worktreeBaseDir: baseDir,
    adapterFactory: noopProvider,
  })

  process.stdout.write(`READY PORT=${server.port}\n`)

  const cleanup = async (): Promise<void> => {
    await server.stop()
    await rm(baseDir, { recursive: true, force: true })
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
  // Keep alive
  await new Promise(() => {})
}

await main()
