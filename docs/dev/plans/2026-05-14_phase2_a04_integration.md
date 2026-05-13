# Phase 2 a04: Real-SDK Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one end-to-end integration test that exercises the real `@anthropic-ai/claude-agent-sdk` against a real scratch git repo, drives Director→Implementer through `triggerWorkflow`, and verifies that (a) two rows land in `agent_instances`, (b) the Implementer commits to its branch, and (c) the Director's delegate tool returns a non-empty summary.

**Architecture:** The test boots an in-process server-like environment (just the runtime pieces — no HTTP), builds a scratch git repo on disk, invokes `triggerWorkflow` with a tiny prompt, and inspects the resulting SQLite state. Skipped when no Anthropic auth is present (`skipIf` on both `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`).

**Tech Stack:** Bun's `bun:test`, `@anthropic-ai/claude-agent-sdk`, `bun:sqlite`, real `git` subprocess via Bun's `$`.

**Spec reference:** [docs/dev/specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md) § 10 (D-044).
**Depends on:** a01 (runtime) and a02 (server-side store wiring) merged. a03 (web) is not required.

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/runtime/test/integration/delegate-flow.integration.test.ts` | End-to-end Director→Implementer delegate flow |
| `packages/runtime/test/integration/fixtures/scratch-repo.ts` | Helper: build a temp git repo with a workflows/ dir |

---

## Pre-flight

- [ ] **a03 optional, a01+a02 required**

```bash
git log --oneline | head -25
```

Expected: a01 and a02 commits visible.

- [ ] **Auth available**

```bash
echo "ANTHROPIC_API_KEY set: ${ANTHROPIC_API_KEY:+yes}"
echo "CLAUDE_CODE_OAUTH_TOKEN set: ${CLAUDE_CODE_OAUTH_TOKEN:+yes}"
```

(Windows PowerShell equivalent: `Write-Host "API key: $($env:ANTHROPIC_API_KEY -ne $null)"`.) Without at least one, the test will be skipped — that is fine for the implementation phase, but plan one human run with auth before declaring this plan complete.

- [ ] **Baseline tests**

```bash
bun run typecheck && bun run test
```

Expected: green.

---

## Task 1: Scratch-repo fixture helper

**Files:**
- Create: `packages/runtime/test/integration/fixtures/scratch-repo.ts`

- [ ] **Step 1: Write the helper**

```typescript
// packages/runtime/test/integration/fixtures/scratch-repo.ts
import { $ } from 'bun'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ScratchRepo {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Create a throwaway git repo with one initial commit and a workflows/ directory
 * containing the legion sample workflow yamls. Caller is responsible for cleanup().
 */
export async function makeScratchRepo(): Promise<ScratchRepo> {
  const path = await mkdtemp(join(tmpdir(), 'legion-it-'))
  await $`git init -b main`.cwd(path).quiet()
  await $`git config user.email it@example.com`.cwd(path).quiet()
  await $`git config user.name "legion integration"`.cwd(path).quiet()
  await writeFile(join(path, 'README.md'), '# scratch\n\nplaceholder.\n')
  await mkdir(join(path, 'workflows'), { recursive: true })
  await writeFile(
    join(path, 'workflows', 'bug-fix.yaml'),
    [
      'id: bug-fix',
      'name: Bug Fix',
      'description: Single-Implementer fix.',
      'nodes:',
      '  - id: trigger',
      '    type: trigger',
      '    kind: manual',
      '  - id: director',
      '    type: role',
      '    role: director',
      '    provider: claude-code',
      '    lifetime: per-workflow',
      '  - id: implementer',
      '    type: role',
      '    role: implementer',
      '    provider: claude-code',
      '    lifetime: per-task',
      'edges:',
      '  - { from: trigger,  to: director,    type: triggers }',
      '  - { from: director, to: implementer, type: delegates }',
      '',
    ].join('\n'),
  )
  await $`git add -A`.cwd(path).quiet()
  await $`git commit -m initial`.cwd(path).quiet()
  return {
    path,
    cleanup: async () => {
      await $`rm -rf ${path}`.quiet().nothrow()
    },
  }
}
```

Windows note: `rm -rf` works under Bun on Windows via a posix-ish shell. If it fails on a CI runner, swap to `node:fs/promises`'s `rm(path, { recursive: true, force: true })`.

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/test/integration/fixtures/scratch-repo.ts
git commit -m "test(runtime): scratch-repo fixture helper for integration tests"
```

---

## Task 2: Director→Implementer integration test

**Files:**
- Create: `packages/runtime/test/integration/delegate-flow.integration.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/runtime/test/integration/delegate-flow.integration.test.ts
import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { Database } from 'bun:sqlite'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  InstanceStore,
  initInstanceSchema,
} from '@legion/runtime/orchestrator/instance-store'
import {
  AgentInstanceStore,
  initAgentInstanceSchema,
} from '@legion/runtime/store/agent-instance-store'
import { EventLog } from '@legion/runtime/eventlog/eventlog'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { triggerWorkflow } from '@legion/runtime/orchestrator/trigger'
import { loadWorkflowsDir } from '@legion/runtime/template/loader'
import { makeScratchRepo } from './fixtures/scratch-repo'

const HAS_AUTH =
  !!process.env['ANTHROPIC_API_KEY'] || !!process.env['CLAUDE_CODE_OAUTH_TOKEN']

describe.skipIf(!HAS_AUTH)('Phase 2 delegate flow (real SDK)', () => {
  test(
    'Director calls delegate, Implementer commits, agent_instances has two rows',
    async () => {
      const repo = await makeScratchRepo()
      try {
        const db = new Database(':memory:')
        initInstanceSchema(db)
        initAgentInstanceSchema(db)

        const store = new InstanceStore(db)
        const agentStore = new AgentInstanceStore(db)
        const log = new EventLog(db)
        const worktree = new LocalWorktreeProvider({
          repoPath: repo.path,
          baseDir: `${repo.path}/.legion-worktrees`,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const adapter = new ClaudeCodeAgentSDKProvider({ query: query as any })
        const templates = await loadWorkflowsDir(`${repo.path}/workflows`)
        const template = templates.get('bug-fix')
        if (!template) throw new Error('bug-fix template missing')

        const { workflowInstanceId } = await triggerWorkflow({
          template,
          userPrompt:
            'Append a single line "## smoke" to README.md and commit. Use the Implementer to do the edit.',
          repoPath: repo.path,
          baseRef: 'HEAD',
          workspaceProvider: worktree,
          adapter,
          instanceStore: store,
          agentInstanceStore: agentStore,
          eventLog: log,
        })

        // Drain Director's stream by reading from the event log. triggerWorkflow
        // returns synchronously after Director session ends in Phase 1; Phase 2
        // keeps that contract for the trigger entry point.
        // Walk the agent_instances table.
        const rows = agentStore.listByWorkflow(workflowInstanceId)
        expect(rows.length).toBeGreaterThanOrEqual(2)

        const director = rows.find((r) => r.roleNodeId === 'director')
        const implementer = rows.find((r) => r.roleNodeId === 'implementer')
        expect(director).toBeDefined()
        expect(implementer).toBeDefined()
        expect(implementer!.parentAgentInstanceId).toBe(director!.id)
        expect(implementer!.branchName).toBeTruthy()

        // Verify Implementer actually committed on its branch.
        const branch = implementer!.branchName as string
        const log1 = await $`git log --oneline ${branch}`.cwd(repo.path).quiet().nothrow()
        expect(log1.exitCode).toBe(0)
        const lines = log1.stdout.toString().trim().split('\n')
        expect(lines.length).toBeGreaterThanOrEqual(2)  // initial + at least one Implementer commit
      } finally {
        await repo.cleanup()
      }
    },
    { timeout: 180_000 },  // real SDK calls, allow 3 minutes
  )
})
```

- [ ] **Step 2: Run the test (without auth — should skip)**

```bash
ANTHROPIC_API_KEY= CLAUDE_CODE_OAUTH_TOKEN= bun test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

Expected: `1 skip` and no failure.

- [ ] **Step 3: Run with auth — should pass**

If you have an Anthropic credential available:

```bash
# bash / zsh
bun test packages/runtime/test/integration/delegate-flow.integration.test.ts

# PowerShell
bun test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

Expected: 1 pass (this may take 30–120 seconds and consume some token budget — the prompt is intentionally tiny).

If the test fails:
- **Implementer made no commit**: I-9 fix in a01 may not be effective. Re-read `IMPLEMENTER_PROMPT` and `role-profile.ts` — does the allowedTools list actually include `Bash(git commit*)`? Did the prompt land in the SDK call?
- **`expect(rows.length).toBeGreaterThanOrEqual(2)`**: Director may not have called delegate. Read the Director's events from `log.history(workflowInstanceId)` and inspect.
- **Timeout**: increase to 300_000 or pick a smaller model. The integration test in Phase 1 (`provider.integration.test.ts`) uses `claude-haiku-4-5-20251001` — consider matching it here.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/test/integration/delegate-flow.integration.test.ts
git commit -m "test(runtime): real-SDK integration test for Director->Implementer (D-044)"
```

---

## Wrap-up

- [ ] **Final regress**

Run: `bun run typecheck && bun run test`
Expected: typecheck green; tests pass with one new skip (without auth) or one new pass (with auth).

- [ ] **Plan handoff for next steps**

Phase 2 narrow scope is now feature-complete. Next session should:

1. Manual smoke run with auth, verifying the Web UI shows the Director → Implementer flow as described in [a03 § "Manual browser smoke"](2026-05-14_phase2_a03_web.md#wrap-up).
2. Update Phase 1 carry-forward list (I-2 ✅ I-4 ✅ I-9 ✅ I-1 ✅, leaving I-3 and I-5 still open).
3. Draft handoff for the agent that will work on Phase 3 (Reviewer + Blackboard + Codex), referencing the Phase 2 enablement concerns that remain open: concern #3 (`worktreeAdd --detach <branch>`).

- [ ] **Branch state check**

```bash
git log --oneline | head -25
```

Expected: ~2 commits for a04.

---

*If the integration test passes without auth (i.e. it forgot to skip), something is mis-wired in `describe.skipIf`. Bun's `describe.skipIf` accepts a boolean; verify the truthiness of `HAS_AUTH`. The Phase 1 integration test [provider.integration.test.ts](../../../packages/runtime/test/adapter/provider.integration.test.ts) uses the same pattern — copy it verbatim if needed.*
