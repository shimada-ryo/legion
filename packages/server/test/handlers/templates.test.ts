import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { startApp, type AppHandle } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { AgentProvider } from '@legion/core'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

function makeMockAdapterFactory(): () => AgentProvider {
  return () =>
    ({
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
    }) satisfies AgentProvider
}

let server: AppHandle
let baseDir: string

beforeEach(async () => {
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  baseDir = await mkdtemp(join(tmpdir(), 'legion-srv-'))
  const templates = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await templates.refresh()
  server = await startApp({
    port: 0, // ask the OS for a free port
    db,
    templates,
    repoPath: REPO_ROOT,
    worktreeBaseDir: baseDir,
    adapterFactory: makeMockAdapterFactory(),
  })
})

afterEach(async () => {
  await server.stop()
  await rm(baseDir, { recursive: true, force: true })
})

describe('GET /templates', () => {
  test('returns array of template summaries', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; name: string; nodeCount: number }>
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toHaveProperty('id')
    expect(body[0]).toHaveProperty('name')
    expect(body[0]).toHaveProperty('nodeCount')
  })
})

describe('GET /templates/:id', () => {
  test('returns the full template', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates/feature-implementation`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; nodes: unknown[] }
    expect(body.id).toBe('feature-implementation')
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  test('returns 404 for unknown template', async () => {
    const res = await fetch(`http://localhost:${server.port}/templates/nope`)
    expect(res.status).toBe(404)
  })
})
