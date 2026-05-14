# Phase 3 a06: Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 全体を実 SDK + 実 Codex で end-to-end に動かす integration test を追加し、retry loop が approve まで通ること・Reviewer の Codex provider が機能していること・Blackboard auto-publish が正しい順序で起きていることを verify する。Phase 2 narrow の `delegate-flow.integration.test.ts` (D-044) と同じパターンで、`CLAUDE_CODE_OAUTH_TOKEN` + Codex auth (`~/.codex/auth.json` or `CODEX_API_KEY`) が両方揃ったときのみ走る `skipIf` gated test。

**Architecture:** Phase 2 で作った scratch-repo fixture を再利用し、`feature-with-review.yaml` を template として triggerWorkflow を呼ぶ。Implementer のプロンプトを「絶対に最初は壊れた実装を出して、Reviewer の request-changes を 1 回受けてから修正してね」と工作することで、retry loop を意図的に発火させる。Blackboard を SELECT して `system.delegate.start` / `system.review.decision` / `system.delegate.result` の発火回数と順序を assert。

**Tech Stack:** Bun test runner、real `@anthropic-ai/claude-agent-sdk` + real `@openai/codex-sdk`、`bun:sqlite`。

**Spec reference:** [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md) § 9。

**Depends on:** a01〜a05 全部 (Phase 3 narrow の全構成要素)。a02 で書いた Codex contract test がここで再利用される。

**実行コスト:** ~70〜120s / 1 回、API コストは ~25〜40 cents (Claude Sonnet + Codex 各々の round trip 数による)。CI なしの環境なので手動実行。

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `packages/runtime/test/integration/delegate-flow-review.integration.test.ts` | Phase 3 E2E test (approve 1 round + retry round) |

### Modify

| Path | Change |
| --- | --- |
| `packages/runtime/test/integration/fixtures/scratch-repo.ts` | (必要なら) feature-with-review.yaml をコピーする helper を追加 |
| `docs/dev/manuals/user_test_manual.md` | Phase 3 動作確認 (5 タブ目 + Reviewer / retry) を補足 |

---

## Pre-flight

- [ ] **a01〜a05 完了確認**

```bash
git log --oneline -30 | grep -E "phase3|feature-with-review|REVIEWER_PROMPT|Codex|BlackboardStore"
```

期待: 各サブプランのコミット群が見える。

- [ ] **typecheck + 通常 test green**

```bash
bun run typecheck && bun run test
```

期待: green、a05 完了後の baseline (~230 件)。

- [ ] **Codex contract test を 1 度実行 (gate before E2E)**

```bash
$env:CODEX_INTEGRATION = "1"
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."  # 任意 (contract test では Codex のみ確認)
bun run test packages/runtime/test/adapter/codex/codex-provider.contract.test.ts
```

期待: 2 pass、~10〜20s。落ちたら a02 の mock fixture が現実と乖離しているので、E2E 前に解決すべき。

- [ ] **Phase 2 delegate-flow integration test を 1 度実行 (regression gate)**

```bash
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."
bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: 38.7s で green。Phase 2 narrow path が壊れていないことを確認。

---

## Task 1: `delegate-flow-review.integration.test.ts` の骨格と setup

**Files:**
- Create: `packages/runtime/test/integration/delegate-flow-review.integration.test.ts`

- [ ] **Step 1: 既存 `delegate-flow.integration.test.ts` を参考に骨格を写す**

```bash
cat packages/runtime/test/integration/delegate-flow.integration.test.ts | head -80
```

期待: `describe.skipIf(!HAS_AUTH)`、scratch-repo fixture、triggerWorkflow、`awaitWorkflow` polling、各種 assertion の pattern が見える。

- [ ] **Step 2: 新規 test ファイルの骨格を作る**

```typescript
// packages/runtime/test/integration/delegate-flow-review.integration.test.ts
import { describe, it, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ulid } from 'ulid'
import { Database } from 'bun:sqlite'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Codex } from '@openai/codex-sdk'
import { setupScratchRepo, cleanupScratchRepo } from './fixtures/scratch-repo'
import { ClaudeCodeAgentSDKProvider } from '../../src/adapter/provider'
import { CodexSdkProvider } from '../../src/adapter/codex/codex-provider'
import { triggerWorkflow } from '../../src/orchestrator/trigger'
import { BlackboardStore } from '../../src/store/blackboard-store'
import { AgentInstanceStore } from '../../src/store/agent-instance-store'
import { InstanceStore } from '../../src/store/instance-store'
import { loadWorkflowTemplate } from '../../src/orchestrator/template-loader'

const HAS_CLAUDE = Boolean(process.env['CLAUDE_CODE_OAUTH_TOKEN'])
const HAS_CODEX =
  existsSync(join(homedir(), '.codex', 'auth.json')) ||
  Boolean(process.env['CODEX_API_KEY'])
const HAS_AUTH = HAS_CLAUDE && HAS_CODEX

async function awaitWorkflow(store: InstanceStore, wfId: string, deadlineMs = 180_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < deadlineMs) {
    const wf = store.get(wfId)
    if (wf?.status === 'completed' || wf?.status === 'failed') return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`awaitWorkflow: timed out after ${deadlineMs}ms`)
}

describe.skipIf(!HAS_AUTH)('Phase 3 delegate-flow with Reviewer (real SDK)', () => {
  // tests 内ここに 2 つの it
})
```

- [ ] **Step 3: typecheck**

```bash
bun run typecheck
```

期待: green (実装関数の import が解決する; auth が無くて skipIf で skip されるが型エラーは独立)。

- [ ] **Step 4: commit (skeleton として残す)**

```bash
git add packages/runtime/test/integration/delegate-flow-review.integration.test.ts
git commit -m "test(runtime): scaffold delegate-flow-review integration test (skipIf gated)"
```

---

## Task 2: Approve 1 round の test

**Files:**
- Modify: `packages/runtime/test/integration/delegate-flow-review.integration.test.ts`

- [ ] **Step 1: test 本体を追加**

```typescript
  it('completes Director→Implementer→Reviewer(Codex)→approve in one round', async () => {
    const repo = await setupScratchRepo()
    try {
      // 1. setup runtime
      const db = new Database(':memory:')
      const instanceStore = new InstanceStore(db); instanceStore.initSchema()
      const agentInstanceStore = new AgentInstanceStore(db); agentInstanceStore.initSchema()
      const blackboardStore = new BlackboardStore(db); blackboardStore.initSchema()

      const claudeProvider = new ClaudeCodeAgentSDKProvider({ query })
      const codexProvider = new CodexSdkProvider()
      const providersByName = new Map([
        ['claude-code', claudeProvider],
        ['codex', codexProvider],
      ])

      const tmpl = await loadWorkflowTemplate(join(repo.path, 'workflows/feature-with-review.yaml'))

      // 2. trigger
      const wfId = await triggerWorkflow({
        template: tmpl,
        userPrompt: 'Add a function welcomeUser(name) to src/hello.ts that returns "Welcome, ${name}!". Commit with a clear message.',
        repoPath: repo.path,
        providersByName,
        instanceStore,
        agentInstanceStore,
        blackboardStore,
      })

      // 3. wait for completion
      await awaitWorkflow(instanceStore, wfId, 180_000)

      // 4. assertions
      const wf = instanceStore.get(wfId)
      expect(wf?.status).toBe('completed')

      const agents = agentInstanceStore.listByWorkflow(wfId)
      // 期待: Director, Implementer, Reviewer の最低 3 行
      expect(agents.length).toBeGreaterThanOrEqual(3)
      const director = agents.find((a) => a.roleNodeId === 'director')
      const implementer = agents.find((a) => a.roleNodeId === 'implementer')
      const reviewers = agents.filter((a) => a.roleNodeId === 'reviewer')
      expect(director).toBeDefined()
      expect(implementer).toBeDefined()
      expect(reviewers.length).toBeGreaterThanOrEqual(1)
      expect(reviewers[0].parentAgentInstanceId).toBe(implementer!.id)

      // Blackboard: system.review.decision に approve が 1 件以上
      const decisions = blackboardStore.listByWorkflow(wfId, { topic: 'system.review.decision' })
      expect(decisions.length).toBeGreaterThanOrEqual(1)
      const lastDecision = decisions[decisions.length - 1]
      expect((lastDecision.payload as { decision: string }).decision).toBe('approve')

      // Implementer の branch に commit が 2 つ以上 (初期 commit + Implementer's commit)
      const { $ } = await import('bun')
      const commits = (await $`git -C ${repo.path} log --oneline ${implementer!.branchName}`.text())
        .trim().split('\n')
      expect(commits.length).toBeGreaterThanOrEqual(2)
    } finally {
      await cleanupScratchRepo(repo)
    }
  }, 240_000)  // 4 分タイムアウト
```

- [ ] **Step 2: scratch-repo fixture が feature-with-review.yaml を含むことを確認**

```bash
grep -n "feature-with-review" packages/runtime/test/integration/fixtures/scratch-repo.ts
```

期待: あれば OK。無ければ helper を拡張:

```typescript
// scratch-repo.ts に追加
import { copyFile, mkdir } from 'node:fs/promises'

// setupScratchRepo() の末尾あたりで:
await mkdir(join(repo.path, 'workflows'), { recursive: true })
await copyFile(
  // legion root from this test file location
  join(import.meta.dir, '../../../../../workflows/feature-with-review.yaml'),
  join(repo.path, 'workflows/feature-with-review.yaml'),
)
```

- [ ] **Step 3: test を実行 (auth ありで)**

```bash
$env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-..."
# Codex auth は ~/.codex/auth.json があるか、CODEX_API_KEY が set 済
bun run test packages/runtime/test/integration/delegate-flow-review.integration.test.ts
```

期待: ~60〜120s で 1 pass。落ちたら順を追ってトラブルシュート:

- `wf?.status === 'completed'` でない: Director が `delegate(implementer)` で詰まっている可能性。a02 の DelegateToolHandler dynamic provider selection が動いているか確認。
- `reviewers.length === 0`: Implementer が `delegate(reviewer)` を呼んでいない。IMPLEMENTER_PROMPT (a05) が反映されているか、role-profile に `mcp__legion__delegate` が入っているか確認。
- `lastDecision.decision !== 'approve'`: Reviewer (Codex) が分かりやすく approve する prompt になっていない。userPrompt をシンプルに / 明確にする。

- [ ] **Step 4: commit**

```bash
git add packages/runtime/test/integration/delegate-flow-review.integration.test.ts \
        packages/runtime/test/integration/fixtures/scratch-repo.ts
git commit -m "test(runtime): real-SDK Phase 3 E2E for approve in one round"
```

---

## Task 3: Retry round の test (request-changes → 修正 → approve)

**Files:**
- Modify: `packages/runtime/test/integration/delegate-flow-review.integration.test.ts`

- [ ] **Step 1: retry を意図的に発火させる test を追加**

LLM ベースなので「絶対に最初は request-changes が出る」を保証するのは難しい。userPrompt と Reviewer prompt を工夫して **意図的に initial implementation を不完全にし、reviewer が指摘する**ように仕向ける。

```typescript
  it('handles request-changes round: Reviewer asks for changes, Implementer revises, approves', async () => {
    const repo = await setupScratchRepo()
    try {
      // setup (前 test と同じ)
      const db = new Database(':memory:')
      /* ... */

      // ★ retry を発火させる prompt
      const wfId = await triggerWorkflow({
        template: tmpl,
        userPrompt:
          'Add a function divide(a, b) to src/math.ts that divides a by b. ' +
          'IMPORTANT: in your first commit, intentionally omit the divide-by-zero check ' +
          '(no `if (b === 0)` guard). The Reviewer is expected to request changes; ' +
          'when it does, add the guard and re-commit.',
        repoPath: repo.path,
        providersByName,
        instanceStore,
        agentInstanceStore,
        blackboardStore,
      })
      await awaitWorkflow(instanceStore, wfId, 300_000)  // retry あるので長め

      // assertions
      const wf = instanceStore.get(wfId)
      expect(wf?.status).toBe('completed')

      const agents = agentInstanceStore.listByWorkflow(wfId)
      const reviewers = agents.filter((a) => a.roleNodeId === 'reviewer')
      // 2 回以上 Reviewer が呼ばれていることを期待
      expect(reviewers.length).toBeGreaterThanOrEqual(2)

      // 全 Reviewer は同じ Implementer の child
      const implementer = agents.find((a) => a.roleNodeId === 'implementer')!
      for (const r of reviewers) {
        expect(r.parentAgentInstanceId).toBe(implementer.id)
      }

      // Blackboard に request-changes が少なくとも 1 件、approve も少なくとも 1 件
      const decisions = blackboardStore.listByWorkflow(wfId, { topic: 'system.review.decision' })
        .map((m) => (m.payload as { decision: string }).decision)
      expect(decisions).toContain('request-changes')
      expect(decisions[decisions.length - 1]).toBe('approve')

      // Implementer branch に commit が 3 つ以上 (初期 + 初回実装 + 修正)
      const { $ } = await import('bun')
      const commits = (await $`git -C ${repo.path} log --oneline ${implementer.branchName}`.text())
        .trim().split('\n')
      expect(commits.length).toBeGreaterThanOrEqual(3)
    } finally {
      await cleanupScratchRepo(repo)
    }
  }, 360_000)  // 6 分タイムアウト
```

- [ ] **Step 2: test を実行**

```bash
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."
bun run test packages/runtime/test/integration/delegate-flow-review.integration.test.ts
```

期待: 2 tests / ~3〜5 分 / ~40〜80 cents で green。

retry test が unstable な場合 (LLM が prompt を無視して最初から正しい実装を出す等):

- prompt をより明示的に書く (例: "literally write `function divide(a, b) { return a / b }` without any zero-check on the FIRST commit")
- Reviewer prompt 側で「divide-by-zero check の有無を厳格に見ろ」と書く案もあるが、それは a05 の REVIEWER_PROMPT に項目を足すことになるので integration test の都合で prompt を歪めない。実装側の userPrompt で指示する方が clean。

- [ ] **Step 3: commit**

```bash
git add packages/runtime/test/integration/delegate-flow-review.integration.test.ts
git commit -m "test(runtime): real-SDK Phase 3 E2E for request-changes retry loop"
```

---

## Task 4: `user_test_manual.md` を Phase 3 用に補足

**Files:**
- Modify: `docs/dev/manuals/user_test_manual.md`

- [ ] **Step 1: 既存 manual を読む**

```bash
cat docs/dev/manuals/user_test_manual.md | head -80
```

期待: Phase 2 narrow の `feature-implementation` workflow の動作確認手順がある。

- [ ] **Step 2: Phase 3 用セクションを追加**

manual の末尾あたりに `## Phase 3 動作確認` セクションを追加。内容:

- Codex auth の前提 (`codex login` あるいは `CODEX_API_KEY` の取り扱い)
- `feature-with-review` workflow を trigger する手順
- UI 観察チェックリスト:
  - Canvas に Reviewer role node が現れること (status で色が変わる)
  - Events タブで Reviewer の events が見えること
  - Overview タブで Reviewer を選ぶと decision (approve / request-changes / reject) が表示されること
  - Blackboard タブで `system.review.decision` topic が見えること
  - retry の場合、Reviewer-1 と Reviewer-2 が agent_instances に並ぶこと
- 失敗時のトラブルシュート (decision が parse できないケース、Codex auth エラー時のメッセージ等)

具体 markdown (~50 行):

```markdown
## Phase 3 動作確認 (Reviewer + Codex)

### 前提

- Phase 2 narrow の前提 (bun, Claude OAuth, .env, scratch repo) に加えて:
- **Codex CLI authentication**: `codex login` で `~/.codex/auth.json` を作る。`OPENAI_API_KEY` は legion 側からセットしない (issue #3286 の OAuth override 罠あり)。
- 新しい workflow テンプレート `workflows/feature-with-review.yaml` がリポに含まれていること。

### Trigger

(Phase 2 と同じ legion API に templateId を渡すだけ)

```bash
curl -X POST http://localhost:3000/api/workflows/trigger \
  -H "Content-Type: application/json" \
  -d '{"templateId":"feature-with-review","userPrompt":"Add welcomeUser(name) to src/hello.ts"}'
```

### UI 観察チェックリスト

- [ ] Canvas に director / implementer / reviewer の 3 ノードが順に色付けされる
- [ ] Events タブで agent 別フィルタチップに `reviewer-1` が現れる
- [ ] Overview タブで reviewer ノードを選ぶと `Decision: approve` (または request-changes / reject) が見える
- [ ] Blackboard タブを開くと `system.delegate.start` / `system.review.decision` などの行が時系列に並ぶ
- [ ] Diff タブで implementer のコミットが表示される (reviewer は --detach なので diff には出ない)

### retry の確認

UserPrompt に「最初は意図的に不完全にして」と書くと Reviewer が request-changes を返す。UI 上で:

- Overview の implementer 詳細「Spawned」リストに reviewer-1, reviewer-2 と並ぶ
- Blackboard タブで `decision: request-changes` と `decision: approve` の 2 件が並ぶ

### トラブルシュート

- Codex auth エラー (`No authentication found`) → `codex login` を実行。`OPENAI_API_KEY` を unset するのも忘れない。
- decision が `undefined` で UI 上に出ない → Reviewer の最終応答が JSON でない可能性。Events タブの reviewer 最後の assistant_message を確認。
- retry が無限ループしている → 起きないはず (Implementer prompt の soft cap 3)。session が長引くなら手動 cleanup `legion cleanup --yes`。
```

- [ ] **Step 3: manual を読み返して整合性確認 (Phase 2 と Phase 3 セクションが矛盾しないか)**

- [ ] **Step 4: commit**

```bash
git add docs/dev/manuals/user_test_manual.md
git commit -m "docs(manuals): add Phase 3 UI verification section"
```

---

## Task 5: Phase 3 完了 verification と `phase3-end` タグ

- [ ] **Step 1: full typecheck**

```bash
bun run typecheck
```

期待: 全 5 パッケージ green。

- [ ] **Step 2: full test suite (auth なし baseline)**

```bash
bun run test
```

期待: 既存 + 新規全 pass。Phase 3 完了時の見込みは 240〜260 件程度 (auth 不要分のみ)。

- [ ] **Step 3: 全 contract test 手動実行 (CLAUDE.md "Test Policy" 規約の phase gate)**

```bash
# Codex contract
$env:CODEX_INTEGRATION = "1"
bun run test packages/runtime/test/adapter/codex/codex-provider.contract.test.ts

# Phase 2 Claude integration (Implementer delegate path の contract test)
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."
bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts

# Phase 3 Claude+Codex integration (Reviewer delegate path の contract test)
bun run test packages/runtime/test/integration/delegate-flow-review.integration.test.ts

# git real workspace
bun run test packages/runtime/test/workspace/git.test.ts
```

期待: 全 green。落ちる場合は mock fixture が現実と乖離しているので、CLAUDE.md 規約に沿って fixture とコメントを update してから再 run。

- [ ] **Step 4: ブラウザ手動 E2E (`docs/dev/manuals/user_test_manual.md` の Phase 3 セクション)**

manual のチェックリストを順に確認。すべて ✓ なら次の Step 5 へ。1 つでも falsify する事象が出たら、対応する a01〜a05 サブプランの担当箇所に戻る。

- [ ] **Step 5: `phase3-end` annotated tag を打つ**

```bash
git tag -a phase3-end -m "Phase 3 complete (Reviewer + Blackboard + Codex provider + worktreeAdd extension). All contract tests green, browser E2E verified."
git tag -l --format='%(refname:short) %(creatordate:short) %(subject)' | grep -E "phase[0-9]"
```

期待: tag list に `phase2-narrow-end` (歴史的) と `phase3-end` (新) が並ぶ。

- [ ] **Step 6: handoff doc を書く**

`docs/dev/handoff/2026-05-XX_phase3_complete.md` を作って次セッションへの引き継ぎを記録。内容: Phase 3 完了時点のリポ状態、テスト統計、open issues 整理、Phase 4 へ向けた方向性。

(commit は handoff 単独で OK)

```bash
git add docs/dev/handoff/2026-05-XX_phase3_complete.md
git commit -m "docs(handoff): Phase 3 complete"
```

---

## Done criteria

a06 完了 = **Phase 3 完了**。以下すべてが満たされている:

- `bun run test`: full suite green (~240〜260 件、auth 不要分)
- `bun run typecheck`: green
- `delegate-flow-review.integration.test.ts`: auth ありで 2 件 (approve 1 round + retry round) が green、合わせて ~3〜5 分 / ~40〜80 cents
- `codex-provider.contract.test.ts`: auth ありで green (mock の信憑性確認)
- `delegate-flow.integration.test.ts` (Phase 2): auth ありで green (regression なし)
- `git.test.ts` (workspace contract): green
- ブラウザ手動 E2E: 5 タブ表示、Reviewer decision UI、retry 履歴、Blackboard live 更新すべて確認
- `phase3-end` annotated tag が打たれている
- handoff doc が `docs/dev/handoff/` に書かれている

Phase 4 の候補スコープ:

- D-014 reactor / Inbox の本実装 (`subscribes` edge の runtime 実体化を伴う)
- 複数 Implementer 並列 + Layer 2 バブル展開 UI
- Codex を Director / Implementer にも使えるようにする (`codex app-server` 経由の approval flow が必要)
- Workflow Editor の編集機能 (Phase 3.5 候補)
- session 6 carry-forward の drive-by 対応 (legion cleanup --repo 等)
