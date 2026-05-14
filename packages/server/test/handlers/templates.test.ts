import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
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

describe('GET /api/templates', () => {
  test('returns array of template summaries', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/templates`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ id: string; name: string; nodeCount: number }>
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toHaveProperty('id')
    expect(body[0]).toHaveProperty('name')
    expect(body[0]).toHaveProperty('nodeCount')
  })
})

describe('GET /api/templates/:id', () => {
  test('returns the full template', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/templates/feature-implementation`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; nodes: unknown[] }
    expect(body.id).toBe('feature-implementation')
    expect(Array.isArray(body.nodes)).toBe(true)
  })

  test('returns 404 for unknown template', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/templates/nope`)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/templates/:id/positions', () => {
  const yamlPath = join(REPO_ROOT, 'workflows', 'feature-with-review.yaml')
  let originalYaml: string

  beforeEach(async () => {
    originalYaml = await readFile(yamlPath, 'utf-8')
  })
  afterEach(async () => {
    await writeFile(yamlPath, originalYaml)
  })

  test('writes positions and returns updated template (200)', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          positions: { director: { x: 50, y: 60 } },
        }),
      },
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nodes: Array<{ id: string; position?: { x: number; y: number } }> }
    const dir = body.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 50, y: 60 })
  })

  test('returns 404 for unknown template', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/nope/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: {} }),
      },
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 for unknown node id', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { ghost: { x: 0, y: 0 } } }),
      },
    )
    expect(res.status).toBe(400)
  })

  test('returns 400 for non-numeric coordinates', async () => {
    // JSON cannot encode Infinity (becomes null in JSON.stringify).
    // The handler must still return 400 because null fails the typeof === 'number' check.
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { director: { x: 0, y: 1e400 } } }),
      },
    )
    expect(res.status).toBe(400)
  })

  test('returns 400 for malformed body', async () => {
    const res = await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      },
    )
    expect(res.status).toBe(400)
  })

  test('subsequent GET reflects the persisted positions (registry hot reload)', async () => {
    await fetch(
      `http://localhost:${server.port}/api/templates/feature-with-review/positions`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ positions: { director: { x: 11, y: 22 } } }),
      },
    )
    const get = await fetch(`http://localhost:${server.port}/api/templates/feature-with-review`)
    const body = (await get.json()) as { nodes: Array<{ id: string; position?: { x: number; y: number } }> }
    const dir = body.nodes.find((n) => n.id === 'director')!
    expect(dir.position).toEqual({ x: 11, y: 22 })
  })
})
