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
    launch: async () => ({ sessionId: 's' }),
    stream: async function* () {
      yield {
        id: 'evt-1',
        sessionId: 's',
        type: 'message',
        payload: { text: 'hi' },
        timestamp: new Date(),
      }
      yield {
        id: 'evt-2',
        sessionId: 's',
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
  baseDir = await mkdtemp(join(tmpdir(), 'legion-ws-'))
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

describe('WS /ws/instances/:id/events', () => {
  test('streams history then live events', async () => {
    // Trigger an instance and wait for events to land in the log
    const trig = await fetch(`http://localhost:${server.port}/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: '',
      }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    const url = `ws://localhost:${server.port}/ws/instances/${workflowInstanceId}/events`
    const ws = new WebSocket(url)
    const received: { id?: string; type?: string }[] = []
    ws.addEventListener('message', (e) => {
      received.push(JSON.parse(e.data as string))
    })
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', () => resolve(undefined))
      ws.addEventListener('error', (e) => reject(e))
    })
    await new Promise((r) => setTimeout(r, 100))
    ws.close()
    expect(received.length).toBeGreaterThan(0)
    expect(received[0]).toHaveProperty('id')
    expect(received[0]).toHaveProperty('type')
  })
})
