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

let repo: TempRepo
let baseDir: string
let server: AppHandle

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-appr-'))
})

afterEach(async () => {
  if (server) await server.stop()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

function buildApprovalAdapter(): {
  adapter: AgentProvider
  approvedIds: string[]
  deniedIds: string[]
} {
  const approvedIds: string[] = []
  const deniedIds: string[] = []
  const adapter: AgentProvider = {
    id: 'claude-code',
    displayName: 'mock',
    capabilities: {
      supportsCheckpoint: false,
      supportsResume: false,
      supportsAttach: false,
      supportsApprovalFlow: true,
    },
    detect: async () => ({ installed: true }),
    authenticate: async () => ({ authenticated: true }),
    launch: async () => ({ sessionId: 'sess-mock' }),
    stream: async function* () {
      // Emit a permission_request event then keep stream open briefly
      yield {
        id: 'evt-pr',
        sessionId: 'sess-mock',
        type: 'permission_request',
        payload: { approvalId: 'app-1', tool: 'Edit', input: {} },
        timestamp: new Date(),
      }
      await new Promise((r) => setTimeout(r, 200))
    },
    send: async () => {},
    interrupt: async () => {},
    approve: async (_sessionId, approvalId) => {
      approvedIds.push(approvalId)
    },
    deny: async (_sessionId, approvalId) => {
      deniedIds.push(approvalId)
    },
    status: async () => ({}),
    checkpoint: async () => ({ id: '', createdAt: new Date(), metadata: {} }),
    resume: async () => ({ sessionId: '' }),
    shutdown: async () => {},
    exportTranscript: async () => ({ sessionId: '', events: [] }),
  }
  return { adapter, approvedIds, deniedIds }
}

describe('POST /instances/:id/approvals/:approvalId', () => {
  test('approve resolves a pending approval via the adapter', async () => {
    const { adapter, approvedIds } = buildApprovalAdapter()
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
      adapterFactory: () => adapter,
    })
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: '' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    // Wait for the permission_request event to land
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(
      `http://localhost:${server.port}/instances/${workflowInstanceId}/approvals/app-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      },
    )
    expect(res.status).toBe(204)
    expect(approvedIds).toEqual(['app-1'])
  })

  test('deny endpoint records the reason', async () => {
    const { adapter, deniedIds } = buildApprovalAdapter()
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
      adapterFactory: () => adapter,
    })
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: '' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(
      `http://localhost:${server.port}/instances/${workflowInstanceId}/approvals/app-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'deny', reason: 'too risky' }),
      },
    )
    expect(res.status).toBe(204)
    expect(deniedIds).toEqual(['app-1'])
  })

  test('returns 404 when instance is unknown', async () => {
    const { adapter } = buildApprovalAdapter()
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
      adapterFactory: () => adapter,
    })
    const res = await fetch(
      `http://localhost:${server.port}/instances/unknown-instance/approvals/app-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      },
    )
    expect(res.status).toBe(404)
  })

  test('returns 400 for missing or invalid decision', async () => {
    const { adapter } = buildApprovalAdapter()
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
      adapterFactory: () => adapter,
    })
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ templateId: 'feature-implementation', userPrompt: '' }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 50))

    const res = await fetch(
      `http://localhost:${server.port}/instances/${workflowInstanceId}/approvals/app-1`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      },
    )
    expect(res.status).toBe(400)
  })
})
