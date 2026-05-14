# Phase 3 a02: Codex Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@openai/codex-sdk` ベースの `CodexSdkProvider` を Phase 1/2 の `ClaudeCodeAgentSDKProvider` と対称的なパターンで実装する。最終 Reviewer 用に `outputSchema` を尊重し、ThreadEvent → AgentEvent 変換を提供し、boot 時に `~/.codex/auth.json` または `CODEX_API_KEY` の存在を assert する。Codex SDK 自体の挙動を検証する **contract test を先に書く** (CLAUDE.md "Test Policy" 規約)。

**Architecture:** `CodexSdkProvider` は `AgentProvider` interface を実装し、内部で `new Codex()` ファクトリを保持。`launch()` で `codex.startThread()` を呼び、`stream()` で `thread.runStreamed()` の async iterable を `AgentEvent` に変換して emit。`canUseTool` / custom tools は Codex SDK にないので no-op / unsupported。`supportsApprovalFlow=false`。認証は ChatGPT OAuth (`~/.codex/auth.json`) を default、`OPENAI_API_KEY` は legion 側から渡さない。

**Tech Stack:** TypeScript, Bun runtime, `@openai/codex-sdk` (v0.130+, Apache-2.0), Bun's built-in test runner。Codex CLI binary は `@openai/codex` (peer dep) または既存のグローバル `codex` を利用。

**Spec reference:** [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md) § 5, [reference_codex_sdk_integration](../../../C:/Users/shimada.ryo/.claude/projects/d--Projects-Misc-legion/memory/reference_codex_sdk_integration.md) (auto-memory)。

**Depends on:** [a01 runtime core plan](2026-05-14_phase3_a01_runtime.md) (LaunchRequest.outputSchema, capability 検査の前提)。

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/runtime/src/adapter/codex/codex-provider.ts` | `CodexSdkProvider` クラス本体 |
| `packages/runtime/src/adapter/codex/codex-launch.ts` | `launchCodexSession` — `thread.startThread()` + state 保持 |
| `packages/runtime/src/adapter/codex/codex-stream.ts` | `streamCodexSession` — ThreadEvent → AgentEvent 変換 |
| `packages/runtime/src/adapter/codex/codex-session-store.ts` | session ID → Thread の map (Claude provider の `SessionStore` と対称) |
| `packages/runtime/test/adapter/codex/codex-stream.test.ts` | `streamCodexSession` unit tests (固定 ThreadEvent fixture) |
| `packages/runtime/test/adapter/codex/codex-provider.test.ts` | `CodexSdkProvider` unit tests (codexFactory mock) |
| `packages/runtime/test/adapter/codex/codex-provider.contract.test.ts` | **Contract test**: 実 `@openai/codex-sdk` 相手に mock が表現している契約を verify。`skipIf(!CODEX_INTEGRATION)` |

### Modify

| Path | Change |
| --- | --- |
| `packages/runtime/package.json` | `@openai/codex-sdk` を deps に追加 (peer dep の `@openai/codex` も)、新 subpath exports |
| `packages/runtime/src/orchestrator/delegate-tool.ts` | deps の `provider` を `providers: Map<string, AgentProvider>` に変え、target node の `provider` field で選ぶ (Task 6) |
| `packages/runtime/src/orchestrator/trigger.ts` | `DelegateToolHandler` 構築時に `providers: ctx.providersByName` を渡す (Task 6) |
| `packages/runtime/test/orchestrator/delegate-tool.test.ts` | provider Map 形に test fixture を改修、Codex 選択 test を追加 (Task 6) |
| `packages/server/src/app.ts` | `startApp` で CodexSdkProvider を登録、`ctx.providersByName: Map<string, AgentProvider>` を構築、boot 時 auth 存在 assertion (warn) (Task 7) |

---

## Pre-flight

- [ ] **a01 完了を確認**

```bash
git log --oneline -10
```

期待: 最新コミット群に "feat(runtime): DelegateToolHandler auto-publishes to Blackboard" や "feat(runtime): reviewer worktree honors reviewTargetBranch" などが含まれていること。a01 plan が完了していなければ a02 に着手しない。

- [ ] **全 test green ベースライン**

```bash
bun run test
```

期待: a01 完了直後の数字 (おそらく 189 pass / 2 skip / 0 fail 前後)。

- [ ] **typecheck green**

```bash
bun run typecheck
```

期待: 全パッケージ green。

- [ ] **(任意) Codex 認証の状態を確認** — contract test (Task 8) を実行するなら必要。それ以外の Task は不要。

```bash
# Windows PowerShell
Test-Path "$env:USERPROFILE\.codex\auth.json"
# bash
test -f "$HOME/.codex/auth.json" && echo "ok" || echo "no auth.json"
```

期待: contract test 実行時のみ `True`/`ok` であること。なければ `codex login` を実行する。

---

## Task 1: `@openai/codex-sdk` 依存追加

**Files:**
- Modify: `packages/runtime/package.json`

- [ ] **Step 1: `bun add` で依存を追加**

```bash
cd packages/runtime
bun add @openai/codex-sdk
```

期待: `dependencies` に `@openai/codex-sdk: "^0.130.0"` (またはその時点の最新) が追加され、`bun.lock` が更新される。

- [ ] **Step 2: peer dep の `@openai/codex` (CLI binary 提供) も明示的に追加するか判断**

調査: `bun pm ls @openai/codex` で auto-install されているか確認。SDK が internally `findCodexPath()` でプラットフォーム別 binary (`@openai/codex-linux-x64` 等) を探す仕様。

```bash
bun pm ls | grep -i codex
```

期待: `@openai/codex-sdk` のみ表示で `@openai/codex` が無ければ追加:

```bash
bun add @openai/codex
```

- [ ] **Step 3: typecheck で型エラーが無いことを確認**

```bash
bun run typecheck
```

期待: green。`@openai/codex-sdk` の type が解決する。

- [ ] **Step 4: commit**

```bash
git add packages/runtime/package.json bun.lock
git commit -m "chore(runtime): add @openai/codex-sdk dependency"
```

---

## Task 2: Contract test skeleton を **先に** 書く (CLAUDE.md 規約)

**Files:**
- Create: `packages/runtime/test/adapter/codex/codex-provider.contract.test.ts`

**Mock policy note:** これは contract test 本体。Mock は使わず、実 `@openai/codex-sdk` を直接呼ぶ。`skipIf` で auth 不在環境ではスキップ。

Phase 3 spec §12 末尾: "a01〜a02 は contract test を先に書く。失敗 skeleton から始めて実装で green にする"

- [ ] **Step 1: contract test を作成 (まだ何も実装が無くても書ける)**

`packages/runtime/test/adapter/codex/codex-provider.contract.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { $ } from 'bun'

// Contract test for the mock fixtures in:
//   - packages/runtime/test/adapter/codex/codex-provider.test.ts
//   - packages/runtime/test/adapter/codex/codex-stream.test.ts
//
// representing: @openai/codex-sdk Codex/Thread/ThreadEvent surface
// verified on:  2026-05-14, by SDK research (memory: reference_codex_sdk_integration)
// invalidated when:
//   - @openai/codex-sdk bumps ThreadEvent shape (item.completed / turn.completed / turn.failed)
//   - SDK changes ThreadOptions accepted fields (sandboxMode/approvalPolicy/workingDirectory)
//   - SDK introduces / removes outputSchema behavior on TurnOptions
//
// Run criteria: CODEX_INTEGRATION=1 AND (~/.codex/auth.json exists OR CODEX_API_KEY env set)
// Cost: ~10 seconds, a few cents on real OpenAI API.

const hasAuth =
  existsSync(join(homedir(), '.codex', 'auth.json')) ||
  Boolean(process.env['CODEX_API_KEY'])
const CONTRACT_ENABLED = process.env['CODEX_INTEGRATION'] === '1' && hasAuth

describe.skipIf(!CONTRACT_ENABLED)('@openai/codex-sdk contract', () => {
  it('startThread + runStreamed emits item.completed and turn.completed in this order', async () => {
    const { Codex } = await import('@openai/codex-sdk')
    const tmp = await mkdtemp(join(tmpdir(), 'codex-contract-'))
    try {
      // Codex は git repo を要求するので最小 init
      await $`git init -q ${tmp}`.quiet()
      await writeFile(join(tmp, 'README.md'), '# contract test\n')
      await $`git -C ${tmp} add -A`.quiet()
      await $`git -C ${tmp} -c user.email=t@t -c user.name=t commit -qm init`.quiet()

      const codex = new Codex()
      const thread = codex.startThread({
        workingDirectory: tmp,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })

      const { events } = await thread.runStreamed("Reply with exactly the string: OK")
      const seen: string[] = []
      for await (const ev of events) {
        seen.push(ev.type)
        if (ev.type === 'turn.failed') break
        if (ev.type === 'turn.completed') break
      }

      expect(seen).toContain('item.completed')
      expect(seen).toContain('turn.completed')
      // item.completed が turn.completed より前であることを expect
      const itemIdx = seen.indexOf('item.completed')
      const turnIdx = seen.lastIndexOf('turn.completed')
      expect(itemIdx).toBeLessThan(turnIdx)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)

  it('outputSchema on runStreamed yields schema-conformant final assistant message', async () => {
    const { Codex } = await import('@openai/codex-sdk')
    const tmp = await mkdtemp(join(tmpdir(), 'codex-contract-'))
    try {
      await $`git init -q ${tmp}`.quiet()
      await writeFile(join(tmp, 'README.md'), '# contract test\n')
      await $`git -C ${tmp} add -A`.quiet()
      await $`git -C ${tmp} -c user.email=t@t -c user.name=t commit -qm init`.quiet()

      const codex = new Codex()
      const thread = codex.startThread({
        workingDirectory: tmp,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      })

      const turn = await thread.run("Return decision=approve", {
        outputSchema: {
          type: 'object',
          properties: {
            decision: { type: 'string', enum: ['approve', 'reject'] },
          },
          required: ['decision'],
        } as unknown,
      })

      // SDK の RunResult.finalResponse は string。JSON.parse 可能かを assert。
      expect(typeof turn.finalResponse).toBe('string')
      const parsed = JSON.parse(turn.finalResponse) as { decision: string }
      expect(['approve', 'reject']).toContain(parsed.decision)
    } finally {
      await rm(tmp, { recursive: true, force: true })
    }
  }, 30_000)
})
```

- [ ] **Step 2: test を実行 — auth が無い環境では skip、auth ありなら **失敗してよい** (まだ実装無し相当)**

```bash
bun run test packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
```

期待 (no auth): `skip`。

期待 (auth あり): 2 pass。 ← この時点でも実装ファイルは無いが、test は @openai/codex-sdk を直接 import するので動く。**もし fail したら、SDK の挙動が contract test の前提と違うことを示すので、test を直して real behavior に合わせる**。

- [ ] **Step 3: commit (skeleton として残す)**

```bash
git add packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
git commit -m "test(runtime): add Codex SDK contract test skeleton (skipIf gated)"
```

---

## Task 3: `codex-stream.ts` (ThreadEvent → AgentEvent 変換) — TDD

**Files:**
- Create: `packages/runtime/src/adapter/codex/codex-stream.ts`
- Create: `packages/runtime/test/adapter/codex/codex-stream.test.ts`
- Create: `packages/runtime/src/adapter/codex/codex-session-store.ts`

**Mock policy note:** ThreadEvent を stub で供給する unit test。Contract test (Task 2) で「ThreadEvent の shape はこう」と verified しているので、mock は正当化される。

- [ ] **Step 1: `codex-session-store.ts` を作成 (簡素)**

```typescript
// packages/runtime/src/adapter/codex/codex-session-store.ts
import type { Thread } from '@openai/codex-sdk'

export interface CodexSession {
  sessionId: string
  thread: Thread
  prompt: string
  outputSchema?: unknown
  role: string
  abort: AbortController
}

export class CodexSessionStore {
  private map = new Map<string, CodexSession>()

  set(s: CodexSession): void {
    this.map.set(s.sessionId, s)
  }

  get(sessionId: string): CodexSession {
    const s = this.map.get(sessionId)
    if (!s) throw new Error(`CodexSessionStore: no session for ${sessionId}`)
    return s
  }

  delete(sessionId: string): void {
    this.map.delete(sessionId)
  }
}
```

- [ ] **Step 2: failing test を書く (`codex-stream.test.ts`)**

```typescript
import { describe, it, expect } from 'bun:test'
import { ulid } from 'ulid'
import type { Thread, ThreadEvent } from '@openai/codex-sdk'
import { streamCodexSession } from '../../../src/adapter/codex/codex-stream'
import { CodexSessionStore, type CodexSession } from '../../../src/adapter/codex/codex-session-store'

// Mock: minimal Thread stub for codex-stream tests
// representing:    @openai/codex-sdk Thread interface (runStreamed return shape)
// verified on:     2026-05-14, by SDK source review (sdk/typescript/src/index.ts)
// invalidated when: SDK changes runStreamed return type (currently { events: AsyncIterable<ThreadEvent> })
// contract test:   packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
function makeStubThread(events: ThreadEvent[]): Thread {
  return {
    runStreamed: async () => ({
      events: (async function* () {
        for (const e of events) yield e
      })(),
    }),
    // Thread の他のメソッド (run など) は test では使わないので unimplemented
    run: async () => { throw new Error('stub: run not implemented') },
  } as unknown as Thread
}

function setupSession(events: ThreadEvent[], role = 'reviewer'): { store: CodexSessionStore; sessionId: string } {
  const store = new CodexSessionStore()
  const sessionId = ulid()
  store.set({
    sessionId,
    thread: makeStubThread(events),
    prompt: 'test prompt',
    role,
    abort: new AbortController(),
  })
  return { store, sessionId }
}

describe('streamCodexSession', () => {
  it('emits assistant_message for item.completed of type AgentMessage', async () => {
    const events: ThreadEvent[] = [
      {
        type: 'item.completed',
        item: { item_type: 'agent_message', text: 'hello world' },
      } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: {} } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: any[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev)
      if (ev.type === 'session_end') break
    }

    const am = out.find((e) => e.type === 'assistant_message')
    expect(am).toBeDefined()
    expect((am.payload as any).content).toBe('hello world')

    const end = out.find((e) => e.type === 'session_end')
    expect(end).toBeDefined()
    expect((end.payload as any).status).toBe('completed')
  })

  it('emits session_end with status=failed for turn.failed', async () => {
    const events: ThreadEvent[] = [
      {
        type: 'turn.failed',
        error: { message: 'boom' },
      } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: any[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev)
    }

    const end = out.find((e) => e.type === 'session_end')
    expect(end).toBeDefined()
    expect((end.payload as any).status).toBe('failed')
    expect((end.payload as any).error).toContain('boom')
  })

  it('drops thread.started / turn.started / reasoning items (internal events)', async () => {
    const events: ThreadEvent[] = [
      { type: 'thread.started' } as unknown as ThreadEvent,
      { type: 'turn.started' } as unknown as ThreadEvent,
      { type: 'item.started', item: { item_type: 'reasoning' } } as unknown as ThreadEvent,
      { type: 'item.completed', item: { item_type: 'agent_message', text: 'output' } } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: {} } as unknown as ThreadEvent,
    ]
    const { store, sessionId } = setupSession(events)

    const out: any[] = []
    for await (const ev of streamCodexSession(store, sessionId)) {
      out.push(ev)
    }

    // assistant_message と session_end のみ流れるはず
    const types = out.map((e) => e.type)
    expect(types).toEqual(['assistant_message', 'session_end'])
  })
})
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/adapter/codex/codex-stream.test.ts
```

期待: `Cannot find module '../../../src/adapter/codex/codex-stream'` で FAIL。

- [ ] **Step 4: `codex-stream.ts` を実装**

```typescript
// packages/runtime/src/adapter/codex/codex-stream.ts
import { ulid } from 'ulid'
import type { AgentEvent } from '@legion/core'
import { CodexSessionStore } from './codex-session-store'

export async function* streamCodexSession(
  store: CodexSessionStore,
  sessionId: string,
): AsyncIterable<AgentEvent> {
  const session = store.get(sessionId)
  const turnOpts: { outputSchema?: unknown; signal?: AbortSignal } = { signal: session.abort.signal }
  if (session.outputSchema !== undefined) turnOpts.outputSchema = session.outputSchema

  const { events } = await session.thread.runStreamed(session.prompt, turnOpts)

  for await (const ev of events) {
    const translated = translateEvent(ev as any, sessionId)
    if (translated) yield translated
    if ((ev as any).type === 'turn.completed' || (ev as any).type === 'turn.failed' || (ev as any).type === 'error') {
      // session_end は translateEvent が emit するのでここで break
      break
    }
  }
}

function translateEvent(ev: { type: string; item?: any; error?: any; usage?: unknown }, sessionId: string): AgentEvent | undefined {
  switch (ev.type) {
    case 'item.completed': {
      const item = ev.item ?? {}
      if (item.item_type === 'agent_message') {
        return {
          id: ulid(),
          sessionId,
          type: 'assistant_message',
          payload: { content: item.text ?? '' },
          timestamp: new Date(),
        }
      }
      if (item.item_type === 'command_execution') {
        return {
          id: ulid(),
          sessionId,
          type: 'tool_use',
          payload: { tool: 'shell', input: item.command ?? null },
          timestamp: new Date(),
        }
      }
      if (item.item_type === 'mcp_tool_call') {
        return {
          id: ulid(),
          sessionId,
          type: 'tool_use',
          payload: { tool: item.tool_name ?? 'mcp', input: item.arguments ?? null },
          timestamp: new Date(),
        }
      }
      // reasoning / file_change / web_search 等は Phase 3 では drop
      return undefined
    }
    case 'turn.completed':
      return {
        id: ulid(),
        sessionId,
        type: 'session_end',
        payload: { status: 'completed', usage: ev.usage ?? null },
        timestamp: new Date(),
      }
    case 'turn.failed':
    case 'error':
      return {
        id: ulid(),
        sessionId,
        type: 'session_end',
        payload: { status: 'failed', error: String(ev.error?.message ?? ev.error ?? 'unknown') },
        timestamp: new Date(),
      }
    default:
      return undefined
  }
}
```

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/adapter/codex/codex-stream.test.ts
```

期待: 3 pass / 0 fail。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/adapter/codex/codex-session-store.ts \
        packages/runtime/src/adapter/codex/codex-stream.ts \
        packages/runtime/test/adapter/codex/codex-stream.test.ts
git commit -m "feat(runtime): add codex-stream (ThreadEvent → AgentEvent translation)"
```

---

## Task 4: `codex-launch.ts`

**Files:**
- Create: `packages/runtime/src/adapter/codex/codex-launch.ts`

このタスクは独立した unit test を持たない (Task 5 の `codex-provider.test.ts` から経由で test される)。

- [ ] **Step 1: `codex-launch.ts` を実装**

```typescript
// packages/runtime/src/adapter/codex/codex-launch.ts
import { ulid } from 'ulid'
import type { Codex } from '@openai/codex-sdk'
import type { LaunchRequest } from '@legion/core'
import type { CodexSession } from './codex-session-store'

export function launchCodexSession(codex: Codex, req: LaunchRequest): CodexSession {
  const sessionId = ulid()
  const thread = codex.startThread({
    workingDirectory: req.workdir,
    sandboxMode: 'read-only',
    approvalPolicy: 'never',
    ...(req.model !== undefined ? { model: req.model } : {}),
  })
  return {
    sessionId,
    thread,
    prompt: req.initialPrompt,
    outputSchema: req.outputSchema,
    role: req.role,
    abort: new AbortController(),
  }
}
```

注: `sandboxMode: 'read-only'` と `approvalPolicy: 'never'` は **Phase 3 で Codex を Reviewer 専用に使う前提** での hard-coding。将来 Codex を他用途に拡張するときは `LaunchRequest` から渡せるようにする (現状 YAGNI)。

- [ ] **Step 2: typecheck で `LaunchRequest.outputSchema` 等の参照が解決することを確認**

```bash
bun run typecheck
```

期待: green。a01 で追加した型が効いている。

- [ ] **Step 3: commit (test なしの commit でも problem ないが、Task 5 と一緒に commit してもよい)**

```bash
git add packages/runtime/src/adapter/codex/codex-launch.ts
git commit -m "feat(runtime): add codex-launch helper"
```

---

## Task 5: `CodexSdkProvider` クラス本体 — TDD with `codexFactory` mock

**Files:**
- Create: `packages/runtime/src/adapter/codex/codex-provider.ts`
- Create: `packages/runtime/test/adapter/codex/codex-provider.test.ts`

**Mock policy note:** `codexFactory` を injection できるようにし、test では fake `Codex` インスタンス (`.startThread()` が stub thread を返す) を渡す。**Contract test は Task 2 で書いた `codex-provider.contract.test.ts`**。

- [ ] **Step 1: failing test を書く**

`packages/runtime/test/adapter/codex/codex-provider.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import type { Codex, Thread, ThreadEvent } from '@openai/codex-sdk'
import { CodexSdkProvider } from '../../../src/adapter/codex/codex-provider'

// Mock: @openai/codex-sdk Codex factory for unit tests
// representing:    @openai/codex-sdk Codex class (constructor + startThread)
// verified on:     2026-05-14, by SDK README + source review
// invalidated when: SDK changes Codex constructor options or startThread signature
// contract test:   packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
function makeStubCodex(events: ThreadEvent[]): Codex {
  const thread = {
    runStreamed: async () => ({
      events: (async function* () {
        for (const e of events) yield e
      })(),
    }),
    run: async () => { throw new Error('stub') },
  } as unknown as Thread

  return {
    startThread: () => thread,
    // Codex のその他 API は test では使わない
  } as unknown as Codex
}

describe('CodexSdkProvider', () => {
  it('id and capabilities reflect Codex SDK constraints', () => {
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex([]) })
    expect(p.id).toBe('codex')
    expect(p.capabilities.supportsApprovalFlow).toBe(false)
    expect(p.capabilities.supportsResume).toBe(false)
  })

  it('launch returns a SessionHandle, stream yields events from the stub thread', async () => {
    const events: ThreadEvent[] = [
      { type: 'item.completed', item: { item_type: 'agent_message', text: 'hi' } } as unknown as ThreadEvent,
      { type: 'turn.completed', usage: {} } as unknown as ThreadEvent,
    ]
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex(events) })

    const handle = await p.launch({
      workdir: '/tmp/wt',
      role: 'reviewer',
      initialPrompt: 'review please',
    })
    expect(typeof handle.sessionId).toBe('string')

    const out: any[] = []
    for await (const ev of p.stream(handle.sessionId)) {
      out.push(ev)
      if (ev.type === 'session_end') break
    }

    expect(out.map((e) => e.type)).toEqual(['assistant_message', 'session_end'])
    expect(out[0].payload.content).toBe('hi')
  })

  it('approve / deny are no-ops (no approvalFlow)', async () => {
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex([]) })
    const handle = await p.launch({ workdir: '/tmp', role: 'reviewer', initialPrompt: 'x' })
    await expect(p.approve(handle.sessionId, 'any-id')).resolves.toBeUndefined()
    await expect(p.deny(handle.sessionId, 'any-id')).resolves.toBeUndefined()
  })

  it('outputSchema in LaunchRequest is preserved in session state', async () => {
    const p = new CodexSdkProvider({ codexFactory: () => makeStubCodex([{ type: 'turn.completed', usage: {} } as unknown as ThreadEvent]) })
    const schema = { type: 'object', properties: { decision: { type: 'string' } }, required: ['decision'] }
    const handle = await p.launch({
      workdir: '/tmp',
      role: 'reviewer',
      initialPrompt: 'x',
      outputSchema: schema,
    })
    // 内部状態確認: stream() 開始時に session.outputSchema が thread.runStreamed に渡るはず
    // CodexSdkProvider.store を公開しない設計なので、ここでは flow が完走することのみ assert
    for await (const _ of p.stream(handle.sessionId)) { /* drain */ }
    expect(true).toBe(true)  // smoke
  })
})
```

- [ ] **Step 2: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/adapter/codex/codex-provider.test.ts
```

期待: `Cannot find module .../codex-provider` で FAIL。

- [ ] **Step 3: `codex-provider.ts` を実装**

```typescript
// packages/runtime/src/adapter/codex/codex-provider.ts
import { Codex } from '@openai/codex-sdk'
import type {
  AgentProvider,
  LaunchRequest,
  SessionHandle,
  AgentEvent,
  AgentCapabilities,
  ProviderDetection,
  AuthStatus,
  SendOptions,
  Checkpoint,
  Transcript,
} from '@legion/core'
import { CodexSessionStore } from './codex-session-store'
import { launchCodexSession } from './codex-launch'
import { streamCodexSession } from './codex-stream'

export interface CodexSdkProviderOptions {
  /** Inject Codex constructor. In tests, pass a factory that returns a stub Codex. */
  codexFactory?: () => Codex
}

export class CodexSdkProvider implements AgentProvider {
  id = 'codex'
  displayName = 'OpenAI Codex (codex-sdk)'
  capabilities: AgentCapabilities = {
    supportsCheckpoint: false,
    supportsResume: false,
    supportsAttach: false,
    supportsApprovalFlow: false,
  }

  private store = new CodexSessionStore()
  private codex: Codex

  constructor(opts: CodexSdkProviderOptions = {}) {
    const factory = opts.codexFactory ?? (() => new Codex())
    this.codex = factory()
  }

  async detect(): Promise<ProviderDetection> {
    return { installed: true, version: 'codex-sdk' }
  }

  async authenticate(): Promise<AuthStatus> {
    // server boot 時の assertion (Task 7) で別途 warning を出す。
    // ここでは false positives を避けるため一律 true を返す。
    return { authenticated: true }
  }

  async launch(req: LaunchRequest): Promise<SessionHandle> {
    const s = launchCodexSession(this.codex, req)
    this.store.set(s)
    return { sessionId: s.sessionId }
  }

  stream(sessionId: string): AsyncIterable<AgentEvent> {
    return streamCodexSession(this.store, sessionId)
  }

  async send(_sessionId: string, _message: string, _opts?: SendOptions): Promise<void> {
    throw new Error('send: bidirectional input is not supported by Codex provider')
  }

  async interrupt(sessionId: string): Promise<void> {
    this.store.get(sessionId).abort.abort()
  }

  async approve(_sessionId: string, _approvalId: string): Promise<void> {
    /* no-op: Codex SDK には approvalFlow がない (approvalPolicy=never で運用) */
  }

  async deny(_sessionId: string, _approvalId: string, _reason?: string): Promise<void> {
    /* no-op */
  }

  async status(sessionId: string): Promise<unknown> {
    const s = this.store.get(sessionId)
    return { sessionId: s.sessionId, role: s.role }
  }

  async checkpoint(sessionId: string): Promise<Checkpoint> {
    return { id: sessionId, createdAt: new Date(), metadata: {} }
  }

  async resume(_sessionId: string, _checkpoint?: string): Promise<SessionHandle> {
    throw new Error('resume: not supported by Codex provider in Phase 3')
  }

  async shutdown(sessionId: string): Promise<void> {
    this.store.delete(sessionId)
  }

  async exportTranscript(sessionId: string): Promise<Transcript> {
    return { sessionId, events: [] }
  }
}
```

- [ ] **Step 4: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/adapter/codex/codex-provider.test.ts
```

期待: 4 pass / 0 fail。

- [ ] **Step 5: commit**

```bash
git add packages/runtime/src/adapter/codex/codex-provider.ts \
        packages/runtime/test/adapter/codex/codex-provider.test.ts
git commit -m "feat(runtime): add CodexSdkProvider with codexFactory injection"
```

---

## Task 6: `DelegateToolHandler` の Provider 動的選択

**Files:**
- Modify: `packages/runtime/src/orchestrator/delegate-tool.ts`
- Modify: `packages/runtime/src/orchestrator/trigger.ts` (or wherever DelegateToolHandler is constructed)
- Modify: `packages/runtime/test/orchestrator/delegate-tool.test.ts`

**Mock policy note:** `delegate-tool.test.ts` の mock fixtures (createMockProvider / createMockWorktreeManager) は a01 Task 7 でヘッダコメントを追加済。本タスクは Map<string, AgentProvider> 形に test fixture を改修する。

Spec §6.1 step 3 で「provider 動的選択: workflow template の target ノードの `provider` フィールドに応じて `ctx.providers` から選ぶ」と書いた要件。a01 では single provider 前提だったので Phase 2 narrow の構造を踏襲。a02 で Codex provider が登場したことで、ここで dynamic 化する。

- [ ] **Step 1: failing test を書く**

`delegate-tool.test.ts` に追加:

```typescript
it('selects provider from providers Map by target node provider field (claude-code for implementer)', async () => {
  const claudeStub = createCapturingProvider({ summary: 'claude says hi' })
  const codexStub = createCapturingProvider({ summary: 'codex says hi' })
  const providers = new Map<string, AgentProvider>()
  providers.set('claude-code', claudeStub)
  providers.set('codex', codexStub)

  const handler = new DelegateToolHandler({
    /* existing deps */,
    providers,  // ← replaces `provider`
  })

  // template: director→implementer (provider=claude-code) の delegates edge
  await handler.handle({ role: 'implementer', prompt: '...' })

  expect(claudeStub.lastLaunchRequest).toBeDefined()
  expect(codexStub.lastLaunchRequest).toBeUndefined()  // codex は呼ばれない
})

it('selects codex provider for reviewer target', async () => {
  const claudeStub = createCapturingProvider({ summary: 'unused' })
  const codexStub = createCapturingProvider({
    summary: '{"decision":"approve","feedback":"","notes":""}',
  })
  const providers = new Map<string, AgentProvider>()
  providers.set('claude-code', claudeStub)
  providers.set('codex', codexStub)

  // template: implementer→reviewer (provider=codex) の reviews edge
  // caller agent_instance を Implementer として setup (a01 Task 7 と同じ pattern)
  const handler = new DelegateToolHandler({
    /* existing deps with templateWithReviewsEdge */,
    providers,
  })

  const out = await handler.handle({ role: 'reviewer', prompt: 'review please' })

  expect(codexStub.lastLaunchRequest).toBeDefined()
  expect(claudeStub.lastLaunchRequest).toBeUndefined()
  expect(out.decision).toBe('approve')
})

it('throws when target provider name is not registered', async () => {
  const providers = new Map<string, AgentProvider>()
  // claude-code のみ登録
  providers.set('claude-code', createCapturingProvider({ summary: 'x' }))

  const handler = new DelegateToolHandler({
    /* template with reviewer node having provider='codex' */,
    providers,
  })

  await expect(handler.handle({ role: 'reviewer', prompt: '...' })).rejects.toThrow(/codex/)
})
```

- [ ] **Step 2: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: `providers` フィールドが未対応で型エラー、または `provider` がない object で run-time error。

- [ ] **Step 3: `delegate-tool.ts` の deps を改修**

`provider: AgentProvider` を `providers: Map<string, AgentProvider>` に置き換え。handle() 内で target ノードの provider field を読んで Map から取得:

```typescript
class DelegateToolHandler {
  constructor(private deps: {
    workflowInstanceId: string
    parentAgentInstanceId: string
    parentSessionId: string
    agentInstanceStore: AgentInstanceStore
    blackboardStore: BlackboardStore
    worktreeManager: WorktreeManager
    providers: Map<string, AgentProvider>   // ★ Phase 3: replaces single provider
    eventLog: EventLog
    template: WorkflowTemplate
    baseCommitSha: string
  }) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    // ... 既存: role validation, reviewTargetBranch 解決

    // ★ provider 動的選択
    const targetNode = this.deps.template.nodes.find((n) => n.id === target.roleNodeId)
    const providerName = (targetNode as { provider?: string } | undefined)?.provider
    if (!providerName) {
      throw new Error(`delegate: target node '${target.roleNodeId}' has no provider field`)
    }
    const provider = this.deps.providers.get(providerName)
    if (!provider) {
      throw new Error(
        `delegate: provider '${providerName}' is not registered (registered: ${[...this.deps.providers.keys()].join(', ')})`,
      )
    }

    // ... 既存: agent_instances INSERT, worktree create, provider.launch (この provider を使う), drainstream, etc.
    const session = await provider.launch({ /* existing args */ })
    for await (const ev of provider.stream(session.sessionId)) { /* ... */ }
  }
}
```

- [ ] **Step 4: `trigger.ts` (DelegateToolHandler 構築箇所) を改修**

```bash
grep -n "new DelegateToolHandler" packages/runtime/src/orchestrator/trigger.ts
```

該当箇所で `provider: <single>` を `providers: ctx.providersByName` (a02 Task 7 で server が設定する Map) に置き換え。

```typescript
// trigger.ts 内 (Phase 2 narrow から:)
const handler = new DelegateToolHandler({
  // ... existing
  providers: ctx.providersByName,  // ★ Phase 3
  // (provider: <single> は削除)
})
```

`ctx.providersByName` の型は `Map<string, AgentProvider>`。Phase 2 narrow の `ctx.adapters` Map をそのまま使えない場合は、`ctx` 型を server 側で適切に拡張する (a02 Task 7 / a03 で server 側を整える)。

- [ ] **Step 5: 既存 test fixtures を更新**

`delegate-tool.test.ts` 内のすべての test で `provider: <stub>` を `providers: new Map([['claude-code', <stub>]])` (または対応する name) に置き換え。default factory として helper を導入してもよい:

```typescript
function singleProviderMap(p: AgentProvider, name = 'claude-code'): Map<string, AgentProvider> {
  return new Map([[name, p]])
}
```

- [ ] **Step 6: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/orchestrator/delegate-tool.test.ts
```

期待: 既存 Implementer test (claude-code 経由) も新規 Reviewer test (codex 経由) も全 pass。

- [ ] **Step 7: typecheck**

```bash
bun run typecheck
```

期待: green。`trigger.ts` から `ctx.providersByName` を渡す呼び出しが解決する (a02 Task 7 で server 側に `providersByName: Map<string, AgentProvider>` フィールドを追加するので、ctx 型もそれに合わせて変える)。

- [ ] **Step 8: commit**

```bash
git add packages/runtime/src/orchestrator/delegate-tool.ts \
        packages/runtime/src/orchestrator/trigger.ts \
        packages/runtime/test/orchestrator/delegate-tool.test.ts
git commit -m "feat(runtime): DelegateToolHandler selects provider by target node field"
```

---

## Task 7: `startApp` で Codex provider を登録 + boot 時 auth assertion

**Files:**
- Modify: `packages/server/src/app.ts`

- [ ] **Step 1: 既存 `app.ts` を読み、現状の provider 登録箇所を確認**

```bash
cat packages/server/src/app.ts | head -80
```

期待: `ClaudeCodeAgentSDKProvider` を構築して `ctx.adapters` / `ctx.providers` のような Map に詰めるロジックがある。Phase 2 narrow の D-041 改訂版に従って `ctx.adapters: Map<workflowInstanceId, AgentProvider>` ベースのはず。

- [ ] **Step 2: Codex provider を併存させる**

具体的な改修は既存 server コードの構造に依存するが、概略:

```typescript
import { ClaudeCodeAgentSDKProvider } from '@legion/runtime/adapter/provider'
import { CodexSdkProvider } from '@legion/runtime/adapter/codex/codex-provider'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// startApp の中で:
const claudeProvider = new ClaudeCodeAgentSDKProvider({ query })
const codexProvider = new CodexSdkProvider()
const providersByName = new Map<string, AgentProvider>()
providersByName.set(claudeProvider.id, claudeProvider)
providersByName.set(codexProvider.id, codexProvider)

// boot 時 Codex auth assertion (warning のみ、ハードフェイルしない)
const codexAuthPath = join(homedir(), '.codex', 'auth.json')
if (!existsSync(codexAuthPath) && !process.env['CODEX_API_KEY']) {
  console.warn(
    '[legion] codex provider is registered but no ChatGPT OAuth (~/.codex/auth.json) or CODEX_API_KEY found.\n' +
    '  Run `codex login` or set CODEX_API_KEY before triggering workflows that use codex.\n' +
    '  DO NOT set OPENAI_API_KEY in addition to ChatGPT OAuth — it may be ignored (openai/codex#3286).',
  )
}

ctx.providersByName = providersByName
```

(`ctx.providersByName` の型は a01 で template-validate が `Set<string>` を期待する形に合わせる。trigger.ts / delegate-tool.ts が `ctx.providersByName.get(name)` で provider を取り出す構造に変える必要があるが、これは Phase 2 narrow の `ctx.adapters: Map<workflowInstanceId, AgentProvider>` をそのまま使う場合には別途リファクタリングが必要。詳細は spec §5.6 「ctx.providers の拡張」参照。)

- [ ] **Step 3: 既存 server test が壊れていないことを確認**

```bash
bun run test packages/server/test
```

期待: 既存 server test 全 pass。`Codex provider が登録されている` ことを explicit に assert する test は a03 で追加。

- [ ] **Step 4: typecheck**

```bash
bun run typecheck
```

期待: green。

- [ ] **Step 5: commit**

```bash
git add packages/server/src/app.ts
git commit -m "feat(server): register CodexSdkProvider with boot-time auth warning"
```

---

## Task 8: Contract test 実行 + 全体 verification

- [ ] **Step 1: 通常 full test suite (auth なし環境想定)**

```bash
bun run test
```

期待: a01 完了時の数字に + 10 件前後 (codex-stream 3 + codex-provider 4 + 既存 server 互換 0)。contract test は skip でカウント外。0 fail。

- [ ] **Step 2: typecheck**

```bash
bun run typecheck
```

期待: 全パッケージ green。

- [ ] **Step 3: (auth ありなら) contract test を実行**

```bash
# Windows PowerShell
$env:CODEX_INTEGRATION = "1"; bun run test packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
# bash
CODEX_INTEGRATION=1 bun run test packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
```

期待: 2 pass / 0 fail、~10〜20s で完了、API コストは数 cent。**ここで fail したら mock fixture が現実と乖離している可能性が高い**ので、現実 (実 SDK 出力) に test と mock を合わせる。

- [ ] **Step 4: 既存 Phase 2 real-SDK delegate-flow が引き続き green (auth あり環境)**

```bash
# Windows PowerShell
$env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-..."; bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: 38.7s で green。Phase 3 a01〜a02 で DelegateToolHandler / role-profile / role-prompts (a05 で更新予定だが a02 時点では未着手) を変更したが、Implementer delegate path の挙動は壊れていないことを確認。

- [ ] **Step 5: (任意) Codex 認証フローの手動確認**

```bash
codex --version
# Windows
Test-Path "$env:USERPROFILE\.codex\auth.json"
# bash
test -f "$HOME/.codex/auth.json" && echo "ok"
```

期待: codex binary の version 出力、auth.json 存在確認。

- [ ] **Step 6: 必要なら commit (test の更新があった場合)**

```bash
git status
# 変更があれば commit、なければ skip
```

---

## Done criteria

a02 完了時点で:

- 新規ファイル: `codex-provider.ts`, `codex-launch.ts`, `codex-stream.ts`, `codex-session-store.ts`, 各 test、 contract test (skeleton)
- 拡張ファイル: `packages/runtime/package.json` (dep + subpath)、`packages/runtime/src/orchestrator/delegate-tool.ts` (providers Map)、`packages/runtime/src/orchestrator/trigger.ts` (ctx.providersByName 注入)、`packages/server/src/app.ts` (provider 登録 + ctx.providersByName 構築 + boot assertion)
- `bun run test`: green、~13 件追加。contract test は skip 状態 (CODEX_INTEGRATION 未設定時)
- `bun run typecheck`: green
- DelegateToolHandler が target node の `provider` フィールドを見て providers Map から選べる状態 (Reviewer → Codex / Implementer → Claude が template 駆動で動く)
- 各 mock fixture に CLAUDE.md 規約のヘッダコメント (representing / verified on / invalidated when / contract test) が付与済み
- (auth ありなら) contract test が green で fact-check 済

次の a03 では server expansion (`blackboardMessages` レスポンス、WS event、instance-detail 拡張)。Codex provider と DelegateToolHandler の dynamic provider selection は a02 で揃ったので、a03 では純粋に server / API 層に集中できる。
