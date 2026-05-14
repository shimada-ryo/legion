import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { makeTempRepo, type TempRepo } from '../../../runtime/test/helpers/temp-repo'
import { startApp, type AppHandle } from '@legion/server/app'
import { TemplateRegistry } from '@legion/runtime/template/registry'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { initInstanceSchema } from '@legion/runtime/orchestrator/instance-store'
import type { AgentProvider } from '@legion/core'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')

function makeMockAdapter(): AgentProvider {
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
    launch: async () => ({ sessionId: 'sess-1' }),
    stream: async function* () {
      yield {
        id: 'evt-1',
        sessionId: 'sess-1',
        type: 'message',
        payload: { text: 'hi' },
        timestamp: new Date(),
      }
      yield {
        id: 'evt-2',
        sessionId: 'sess-1',
        type: 'status_change',
        payload: { status: 'completed' },
        timestamp: new Date(),
      }
    },
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

let repo: TempRepo
let baseDir: string
let server: AppHandle

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-srv-'))
  const db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
  const templates = new TemplateRegistry(join(REPO_ROOT, 'workflows'))
  await templates.refresh()
  server = await startApp({
    port: 0,
    db,
    templates,
    repoPath: repo.path,
    worktreeBaseDir: baseDir,
    adapterFactory: () => makeMockAdapter(),
  })
})

afterEach(async () => {
  await server.stop()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('POST /api/workflows/trigger', () => {
  test('triggers a workflow and returns the new instance id', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: 'add /health',
      }),
    })
    expect(res.status).toBe(202)
    const body = (await res.json()) as { workflowInstanceId: string }
    expect(body.workflowInstanceId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
  })

  test('returns 404 for unknown templateId', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'nope', userPrompt: '' }),
    })
    expect(res.status).toBe(404)
  })

  test('returns 400 when templateId missing', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userPrompt: 'x' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/instances and /api/instances/:id', () => {
  test('list and detail work after a trigger', async () => {
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: 'x',
      }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    // Wait for the streaming consumer to drain mock messages
    await new Promise((r) => setTimeout(r, 100))

    const listRes = await fetch(`http://localhost:${server.port}/api/instances`)
    const list = (await listRes.json()) as Array<{ id: string }>
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((i) => i.id === workflowInstanceId)).toBe(true)

    const detailRes = await fetch(
      `http://localhost:${server.port}/api/instances/${workflowInstanceId}`,
    )
    const detail = (await detailRes.json()) as { id: string; events: unknown[] }
    expect(detail.id).toBe(workflowInstanceId)
    expect(Array.isArray(detail.events)).toBe(true)
  })

  test('GET /api/instances/:id returns agentInstances populated with parent / branch', async () => {
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: 'x',
      }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    server.runtime.agentInstanceStore.insert({
      id: 'impl-1',
      workflowInstanceId,
      roleNodeId: 'implementer',
      sessionId: 'sess-impl',
      parentAgentInstanceId: 'dir-synth',
      spawnEdgeId: 'director→implementer',
      status: 'completed',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt/impl',
      branchName: 'legion/x/impl-1',
      startedAt: new Date(),
      endedAt: new Date(),
    })

    const detailRes = await fetch(
      `http://localhost:${server.port}/api/instances/${workflowInstanceId}`,
    )
    const detail = (await detailRes.json()) as {
      agentInstances: Array<{
        id: string
        roleNodeId: string
        parentAgentInstanceId?: string
        branchName?: string
        workspace: { kind: string; path: string }
      }>
    }
    expect(Array.isArray(detail.agentInstances)).toBe(true)
    expect(detail.agentInstances.length).toBeGreaterThanOrEqual(2)
    const impl = detail.agentInstances.find((a) => a.id === 'impl-1')
    expect(impl).toBeDefined()
    expect(impl!.parentAgentInstanceId).toBe('dir-synth')
    expect(impl!.branchName).toBe('legion/x/impl-1')
    expect(impl!.workspace.kind).toBe('owned')
  })
})
