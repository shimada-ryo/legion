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
  baseDir = await mkdtemp(join(tmpdir(), 'legion-diff-'))
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

describe('GET /api/instances/:id/diff', () => {
  test('returns 404 for unknown instance', async () => {
    const res = await fetch(`http://localhost:${server.port}/api/instances/unknown/diff`)
    expect(res.status).toBe(404)
  })

  test('returns empty array when no agent has a branch', async () => {
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: 'x' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    const res = await fetch(
      `http://localhost:${server.port}/api/instances/${workflowInstanceId}/diff`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ agentInstanceId: string; branch: string }>
    expect(body).toEqual([])
  })

  test('returns one entry per branched agent with diff empty when branch missing', async () => {
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: 'x' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    server.runtime.agentInstanceStore.insert({
      id: 'impl-diff-1',
      workflowInstanceId,
      roleNodeId: 'implementer',
      sessionId: 'sess-diff-1',
      parentAgentInstanceId: null,
      spawnEdgeId: null,
      status: 'completed',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt/impl-diff-1',
      branchName: 'legion/nonexistent-branch',
      startedAt: new Date(),
      endedAt: new Date(),
    })

    const res = await fetch(
      `http://localhost:${server.port}/api/instances/${workflowInstanceId}/diff`,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{
      agentInstanceId: string
      branch: string
      diff: string
    }>
    const entry = body.find((e) => e.agentInstanceId === 'impl-diff-1')
    expect(entry).toBeDefined()
    expect(entry!.branch).toBe('legion/nonexistent-branch')
    expect(entry!.diff).toBe('')
  })

  test('excludes rows with null branchName from response', async () => {
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: 'x' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    // Insert a synthetic row with null branch — must not appear in response
    server.runtime.agentInstanceStore.insert({
      id: 'detached-1',
      workflowInstanceId,
      roleNodeId: 'implementer',
      sessionId: 'sess-detached',
      parentAgentInstanceId: null,
      spawnEdgeId: null,
      status: 'completed',
      workspaceKind: 'owned',
      workspacePath: '/tmp/wt/detached',
      branchName: null,
      startedAt: new Date(),
      endedAt: new Date(),
    })

    const res = await fetch(
      `http://localhost:${server.port}/api/instances/${workflowInstanceId}/diff`,
    )
    const body = (await res.json()) as Array<{ agentInstanceId: string }>
    expect(body.some((e) => e.agentInstanceId === 'detached-1')).toBe(false)
  })
})
