// packages/runtime/test/integration/delegate-flow-review.integration.test.ts
//
// Phase 3 E2E: Claude (Director + Implementer) + Codex (Reviewer).
// Auth-gated; skipped when either CLAUDE_CODE_OAUTH_TOKEN or Codex auth
// (~/.codex/auth.json or CODEX_API_KEY) is absent. Each run costs ~25-80
// cents in API fees, depending on retry count.
import { describe, test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { Database } from 'bun:sqlite'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { AgentProvider, BlackboardMessage } from '@legion/core'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { BlackboardStore } from '@legion/runtime/store/blackboard-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { initEventLogSchema } from '@legion/runtime/eventlog/schema'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { CodexSdkProvider } from '@legion/runtime/adapter/codex/codex-provider'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import { loadWorkflowTemplate } from '@legion/runtime/template/loader'
import { makeScratchRepo } from './fixtures/scratch-repo'

const HAS_CLAUDE = !!process.env['CLAUDE_CODE_OAUTH_TOKEN']
const HAS_CODEX =
  existsSync(join(homedir(), '.codex', 'auth.json')) ||
  !!process.env['CODEX_API_KEY']
const HAS_AUTH = HAS_CLAUDE && HAS_CODEX

async function awaitWorkflow(
  store: InstanceStore,
  wfId: string,
  timeoutMs: number,
): Promise<'completed' | 'failed'> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const s = store.get(wfId)?.status
    if (s === 'completed' || s === 'failed') return s
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out after ${timeoutMs}ms; last status: ${store.get(wfId)?.status}`)
}

function decisions(messages: BlackboardMessage[]): string[] {
  return messages
    .filter((m) => m.topic === 'system.review.decision')
    .map((m) => (m.payload as { decision?: string }).decision)
    .filter((d): d is string => typeof d === 'string')
}

describe.skipIf(!HAS_AUTH)('Phase 3 delegate flow with Reviewer (real SDK)', () => {
  test(
    'Director -> Implementer -> Reviewer(Codex) -> approve in one round',
    async () => {
      const repo = await makeScratchRepo()
      try {
        const db = new Database(':memory:')
        initInstanceSchema(db)
        initAgentInstanceSchema(db)
        initEventLogSchema(db)

        const store = new InstanceStore(db)
        const agentStore = new AgentInstanceStore(db)
        const log = new EventLog(db)
        const blackboard = new BlackboardStore(db)
        blackboard.initSchema()
        const worktree = new LocalWorktreeProvider({
          repoPath: repo.path,
          baseDir: `${repo.path}/.legion-worktrees`,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const claudeProvider = new ClaudeCodeAgentSDKProvider({ query: query as any })
        const codexProvider = new CodexSdkProvider()
        const providersByName = new Map<string, AgentProvider>([
          ['claude-code', claudeProvider],
          ['codex', codexProvider],
        ])
        const template = await loadWorkflowTemplate(
          `${repo.path}/workflows/feature-with-review.yaml`,
        )

        const { workflowInstanceId } = await triggerWorkflow({
          template,
          userPrompt:
            'Add a function welcomeUser(name) to src/hello.ts that returns "Welcome, <name>!". ' +
            'Commit the change with a clear message. The Reviewer will check your work.',
          repoPath: repo.path,
          baseRef: 'HEAD',
          workspaceProvider: worktree,
          providersByName,
          instanceStore: store,
          agentInstanceStore: agentStore,
          eventLog: log,
          blackboardStore: blackboard,
        })

        const finalStatus = await awaitWorkflow(store, workflowInstanceId, 230_000)
        expect(finalStatus).toBe('completed')

        const rows = agentStore.listByWorkflow(workflowInstanceId)
        const director = rows.find((r) => r.roleNodeId === 'director')
        const implementer = rows.find((r) => r.roleNodeId === 'implementer')
        const reviewers = rows.filter((r) => r.roleNodeId === 'reviewer')
        expect(director).toBeDefined()
        expect(implementer).toBeDefined()
        expect(reviewers.length).toBeGreaterThanOrEqual(1)
        expect(reviewers[0]!.parentAgentInstanceId).toBe(implementer!.id)

        const msgs = blackboard.listByWorkflow(workflowInstanceId)
        const ds = decisions(msgs)
        expect(ds.length).toBeGreaterThanOrEqual(1)
        expect(ds[ds.length - 1]).toBe('approve')

        // Implementer must have committed on its branch.
        const branch = implementer!.branchName as string
        const log1 = await $`git log --oneline ${branch}`.cwd(repo.path).quiet().nothrow()
        expect(log1.exitCode).toBe(0)
        const lines = log1.stdout.toString().trim().split('\n')
        expect(lines.length).toBeGreaterThanOrEqual(2)
      } finally {
        await repo.cleanup()
      }
    },
    { timeout: 240_000 },
  )

  test(
    'request-changes round: Reviewer asks, Implementer revises, then approves',
    async () => {
      const repo = await makeScratchRepo()
      try {
        const db = new Database(':memory:')
        initInstanceSchema(db)
        initAgentInstanceSchema(db)
        initEventLogSchema(db)

        const store = new InstanceStore(db)
        const agentStore = new AgentInstanceStore(db)
        const log = new EventLog(db)
        const blackboard = new BlackboardStore(db)
        blackboard.initSchema()
        const worktree = new LocalWorktreeProvider({
          repoPath: repo.path,
          baseDir: `${repo.path}/.legion-worktrees`,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const claudeProvider = new ClaudeCodeAgentSDKProvider({ query: query as any })
        const codexProvider = new CodexSdkProvider()
        const providersByName = new Map<string, AgentProvider>([
          ['claude-code', claudeProvider],
          ['codex', codexProvider],
        ])
        const template = await loadWorkflowTemplate(
          `${repo.path}/workflows/feature-with-review.yaml`,
        )

        // Engineered to provoke one request-changes cycle: the first commit is
        // intentionally broken (no zero-guard), then revised after the Reviewer
        // calls it out.
        const { workflowInstanceId } = await triggerWorkflow({
          template,
          userPrompt:
            'Add a function divide(a, b) to src/math.ts that returns a / b. ' +
            'IMPORTANT: in your FIRST commit, omit the divide-by-zero guard ' +
            '(literally just `return a / b`, no `if (b === 0)` check). ' +
            'The Reviewer is expected to call this out as request-changes. ' +
            'When it does, add the guard (return null or throw on b === 0), ' +
            'commit again, and re-request review.',
          repoPath: repo.path,
          baseRef: 'HEAD',
          workspaceProvider: worktree,
          providersByName,
          instanceStore: store,
          agentInstanceStore: agentStore,
          eventLog: log,
          blackboardStore: blackboard,
        })

        const finalStatus = await awaitWorkflow(store, workflowInstanceId, 350_000)
        expect(finalStatus).toBe('completed')

        const rows = agentStore.listByWorkflow(workflowInstanceId)
        const implementer = rows.find((r) => r.roleNodeId === 'implementer')!
        const reviewers = rows.filter((r) => r.roleNodeId === 'reviewer')
        expect(reviewers.length).toBeGreaterThanOrEqual(2)
        for (const r of reviewers) {
          expect(r.parentAgentInstanceId).toBe(implementer.id)
        }

        const ds = decisions(blackboard.listByWorkflow(workflowInstanceId))
        expect(ds).toContain('request-changes')
        expect(ds[ds.length - 1]).toBe('approve')

        const branch = implementer.branchName as string
        const log1 = await $`git log --oneline ${branch}`.cwd(repo.path).quiet().nothrow()
        expect(log1.exitCode).toBe(0)
        const lines = log1.stdout.toString().trim().split('\n')
        // initial + first impl + revised impl => >=3
        expect(lines.length).toBeGreaterThanOrEqual(3)
      } finally {
        await repo.cleanup()
      }
    },
    { timeout: 360_000 },
  )
})
