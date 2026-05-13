import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import type { WorkflowTemplate } from '@legion/core'

const TEMPLATE: WorkflowTemplate = {
  id: 'echo',
  name: 'Echo',
  nodes: [
    { type: 'trigger', id: 'trig', kind: 'manual' },
    {
      type: 'role',
      id: 'impl',
      role: 'implementer',
      provider: 'claude-code',
      lifetime: 'per-task',
    },
  ],
  edges: [{ from: 'trig', to: 'impl', type: 'triggers' }],
}

let repo: TempRepo
let baseDir: string
let db: Database

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-trig-'))
  db = new Database(':memory:')
  initEventLogSchema(db)
  initInstanceSchema(db)
})

afterEach(async () => {
  db.close()
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('triggerWorkflow', () => {
  test('creates an instance, creates a worktree, spawns one agent, and pipes events to event log', async () => {
    const wt = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const queryMock = (input: any): AsyncIterable<unknown> => {
      expect(input.options.workingDirectory).toBeDefined()
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'x', model: 'm' }
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'done' }] },
        }
        yield { type: 'result', subtype: 'success' }
      })()
    }
    const adapter = new ClaudeCodeAgentSDKProvider({ query: queryMock })
    const store = new InstanceStore(db)
    const log = new EventLog(db)
    const result = await triggerWorkflow({
      template: TEMPLATE,
      userPrompt: 'echo this',
      repoPath: repo.path,
      baseRef: 'HEAD',
      workspaceProvider: wt,
      adapter,
      instanceStore: store,
      eventLog: log,
    })
    expect(result.workflowInstanceId).toBeDefined()
    expect(result.sessionId).toBeDefined()
    // Wait for the streaming consumer to drain
    await new Promise((r) => setTimeout(r, 50))
    const history = log.history(result.workflowInstanceId)
    expect(history.length).toBeGreaterThanOrEqual(2) // init + message at minimum
    expect(history.some((e) => e.type === 'message')).toBe(true)
    expect(store.get(result.workflowInstanceId)?.status).toBe('completed')
  })
})
