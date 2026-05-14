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
import { wsHandlers } from '../../src/ws/event-stream'
import type { AppRuntime } from '@legion/server/app'

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

function emptyBbStore() {
  return {
    listByWorkflow: () => [],
    tail: () => () => {},
  }
}

describe('wsHandlers unit', () => {
  test('no events dropped when an event arrives during history fetch (subscribe-first)', () => {
    const wfId = 'wf-race'

    const ev = (id: string, seq: number) =>
      ({ event: { id, sessionId: 's', type: 'message' as const, payload: {}, timestamp: new Date() }, seq })

    // Fully self-contained mock log: no real DB needed for the unit test.
    type Handler = (e: { id: string }, seq: number) => void
    let handlers: Map<symbol, Handler> = new Map()
    let historyCallCount = 0

    const mockLog = {
      historyWithSeq: (_id: string) => {
        historyCallCount++
        const history = [ev('e1', 1), ev('e2', 2)]
        // Simulate the race: fire e-race into already-subscribed handlers
        // (seq 3, which is > lastHistorySeq=2 so it must be replayed).
        for (const h of handlers.values()) h({ id: 'e-race' } as never, 3)
        return history
      },
      tail: (_id: string, handler: Handler) => {
        const key = Symbol()
        handlers.set(key, handler)
        return () => { handlers.delete(key) }
      },
    }

    const received: string[] = []
    const mockWs = {
      data: { workflowInstanceId: wfId, stop: null as (() => void) | null },
      send: (msg: string) => {
        const parsed = JSON.parse(msg) as { id?: string; type?: string }
        if (parsed.type === 'blackboard.message') return
        received.push(parsed.id!)
      },
    }

    const ctx = { log: mockLog, blackboardStore: emptyBbStore() } as unknown as AppRuntime
    wsHandlers(ctx).open(mockWs as never)

    // After open, the direct-send tail is active; fire e4 through it.
    for (const h of handlers.values()) h({ id: 'e4' } as never, 4)

    expect(historyCallCount).toBe(1)
    expect(received).toEqual(['e1', 'e2', 'e-race', 'e4'])

    if (mockWs.data.stop) mockWs.data.stop()
  })

  test('sends blackboard.message events for both history and live messages (Phase 3)', () => {
    const wfId = 'wf-bb'

    const noopLog = {
      historyWithSeq: () => [],
      tail: () => () => {},
    }

    type BbHandler = (m: { id: string; topic: string }) => void
    const bbHandlers = new Map<symbol, BbHandler>()
    const bbHistory = [
      { id: 'bb-1', workflowInstanceId: wfId, topic: 'system.delegate.start', publisherAgentId: null, payload: {}, publishedAt: 1 },
      { id: 'bb-2', workflowInstanceId: wfId, topic: 'system.review.decision', publisherAgentId: null, payload: { decision: 'approve' }, publishedAt: 2 },
    ]
    const mockBb = {
      listByWorkflow: (_id: string) => bbHistory,
      tail: (_id: string, handler: BbHandler) => {
        const key = Symbol()
        bbHandlers.set(key, handler)
        return () => { bbHandlers.delete(key) }
      },
    }

    const received: { type: string; message: { id: string; topic: string } }[] = []
    const mockWs = {
      data: { workflowInstanceId: wfId, stop: null as (() => void) | null },
      send: (msg: string) => {
        const parsed = JSON.parse(msg) as { type?: string; message?: { id: string; topic: string } }
        if (parsed.type === 'blackboard.message' && parsed.message) {
          received.push({ type: parsed.type, message: parsed.message })
        }
      },
    }

    const ctx = { log: noopLog, blackboardStore: mockBb } as unknown as AppRuntime
    wsHandlers(ctx).open(mockWs as never)

    // After open, fire a live blackboard message.
    for (const h of bbHandlers.values()) {
      h({ id: 'bb-3', topic: 'user.summary' })
    }

    const topics = received.map((r) => r.message.topic)
    expect(topics).toEqual(['system.delegate.start', 'system.review.decision', 'user.summary'])
    expect(received.every((r) => r.type === 'blackboard.message')).toBe(true)

    if (mockWs.data.stop) mockWs.data.stop()
  })

  test('blackboard race: messages arriving during history fetch are not duplicated or dropped', () => {
    const wfId = 'wf-bb-race'

    const noopLog = {
      historyWithSeq: () => [],
      tail: () => () => {},
    }

    type BbHandler = (m: { id: string; topic: string }) => void
    const bbHandlers = new Map<symbol, BbHandler>()
    const historyRows = [
      { id: 'bb-1', workflowInstanceId: wfId, topic: 't1', publisherAgentId: null, payload: {}, publishedAt: 1 },
      { id: 'bb-2', workflowInstanceId: wfId, topic: 't2', publisherAgentId: null, payload: {}, publishedAt: 2 },
    ]
    const mockBb = {
      listByWorkflow: (_id: string) => {
        // Race: simulate a message arriving via the already-subscribed handler
        // mid-history (id 'bb-2' is also in history → must be deduped).
        for (const h of bbHandlers.values()) h({ id: 'bb-2', topic: 't2-dup' })
        // And a brand-new one not in history.
        for (const h of bbHandlers.values()) h({ id: 'bb-race', topic: 'tR' })
        return historyRows
      },
      tail: (_id: string, handler: BbHandler) => {
        const key = Symbol()
        bbHandlers.set(key, handler)
        return () => { bbHandlers.delete(key) }
      },
    }

    const seenIds: string[] = []
    const mockWs = {
      data: { workflowInstanceId: wfId, stop: null as (() => void) | null },
      send: (msg: string) => {
        const parsed = JSON.parse(msg) as { type?: string; message?: { id: string } }
        if (parsed.type === 'blackboard.message' && parsed.message) {
          seenIds.push(parsed.message.id)
        }
      },
    }

    const ctx = { log: noopLog, blackboardStore: mockBb } as unknown as AppRuntime
    wsHandlers(ctx).open(mockWs as never)

    expect(seenIds).toEqual(['bb-1', 'bb-2', 'bb-race'])

    if (mockWs.data.stop) mockWs.data.stop()
  })
})

describe('WS /api/ws/instances/:id/events', () => {
  test('streams history then live events', async () => {
    // Trigger an instance and wait for events to land in the log
    const trig = await fetch(`http://localhost:${server.port}/api/workflows/trigger`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        templateId: 'feature-implementation',
        userPrompt: '',
      }),
    })
    const { workflowInstanceId } = (await trig.json()) as { workflowInstanceId: string }
    await new Promise((r) => setTimeout(r, 100))

    const url = `ws://localhost:${server.port}/api/ws/instances/${workflowInstanceId}/events`
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
