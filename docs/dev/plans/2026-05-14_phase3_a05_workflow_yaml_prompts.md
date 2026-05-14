# Phase 3 a05: Workflow YAML + Role Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 用の新規 workflow テンプレート `feature-with-review.yaml` を追加し、`role-prompts.ts` に **REVIEWER_PROMPT** を新規追加、**IMPLEMENTER_PROMPT** を拡張して retry loop semantics を LLM に教える。a01〜a04 でランタイム / Codex provider / server / UI を揃えたので、a05 は LLM に挙動を教える層に集中する。

**Architecture:** workflow テンプレートが `reviews` エッジを宣言することで、a01 の graph-walker が Implementer に `delegate(role='reviewer')` を許可する。Implementer の system prompt が「commit したら Reviewer を呼べ、`request-changes` なら追加修正、approve なら end、最大 3 回」を明示。Reviewer の system prompt が outputSchema に従った JSON で `{decision, feedback, notes}` を返すよう指示。

**Tech Stack:** YAML、TypeScript (role-prompts.ts)、`bun:test`。

**Spec reference:** [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md) § 6.4 (prompts) と § 7.4 (workflow YAML)。

**Depends on:** [a01 runtime core plan](2026-05-14_phase3_a01_runtime.md) (graph-walker reviews edge、template-validate)。a02〜a04 はランタイム動作には必要だが、a05 自体は a01 完了で書けて test できる。a02 完了後でないと feature-with-review.yaml を実 trigger するときに Codex provider が動かない。

---

## File Structure

### Create

| Path | Responsibility |
| --- | --- |
| `workflows/feature-with-review.yaml` | Phase 3 用 workflow テンプレート (Director→Implementer→Reviewer の reviews エッジ + blackboard node) |
| `packages/runtime/test/adapter/role-prompts.test.ts` (拡張) | REVIEWER_PROMPT の test 追加 |

### Modify

| Path | Change |
| --- | --- |
| `packages/runtime/src/adapter/role-prompts.ts` | REVIEWER_PROMPT 追加、IMPLEMENTER_PROMPT 拡張 |
| `packages/runtime/src/adapter/role-profile.ts` (Phase 2 既存) | `defaultSystemPromptFor('reviewer')` が新 prompt を返すように line を 1 行追加 (実装方式による) |

---

## Pre-flight

- [ ] **a01 完了確認 (graph-walker reviews edge と template-validate がいる)**

```bash
git log --oneline -15
```

期待: a01 の "graph-walker recognizes reviews edges" / "validateTemplate for Phase 3" コミットが見える。

- [ ] **test green**

```bash
bun run test
```

期待: 累積 baseline (a04 完了なら ~220 件)。

---

## Task 1: REVIEWER_PROMPT を新規追加 (TDD)

**Files:**
- Modify: `packages/runtime/src/adapter/role-prompts.ts`
- Modify: `packages/runtime/test/adapter/role-prompts.test.ts`

- [ ] **Step 1: 既存 `role-prompts.ts` を読む**

```bash
cat packages/runtime/src/adapter/role-prompts.ts
```

期待: Phase 2 narrow で `DIRECTOR_PROMPT`, `IMPLEMENTER_PROMPT` と `defaultSystemPromptFor(role)` がある。

- [ ] **Step 2: failing test を追加 (REVIEWER_PROMPT が存在する)**

`packages/runtime/test/adapter/role-prompts.test.ts` に追加:

```typescript
import { defaultSystemPromptFor } from '../../src/adapter/role-prompts'

describe('REVIEWER_PROMPT (Phase 3)', () => {
  it('returns a prompt for reviewer role that mentions structured output', () => {
    const p = defaultSystemPromptFor('reviewer')
    expect(p).toBeDefined()
    expect(p).toMatch(/Reviewer/i)
    expect(p).toMatch(/decision/i)
    expect(p).toMatch(/approve|request-changes|reject/i)
    // outputSchema の話 (raw JSON で返すこと) を含むはず
    expect(p).toMatch(/JSON|schema/i)
  })

  it('reviewer prompt does NOT instruct edits or commits', () => {
    const p = defaultSystemPromptFor('reviewer')
    expect(p).not.toMatch(/git add/i)
    expect(p).not.toMatch(/git commit/i)
    expect(p).not.toMatch(/edit files|modify files/i)
  })
})
```

- [ ] **Step 3: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/adapter/role-prompts.test.ts
```

期待: `defaultSystemPromptFor('reviewer')` が Phase 2 のものを返すので "decision" などのマッチが取れず FAIL。

- [ ] **Step 4: REVIEWER_PROMPT を実装**

```typescript
// packages/runtime/src/adapter/role-prompts.ts

const REVIEWER_PROMPT = `You are a Reviewer agent in legion. You operate in a read-only git worktree
that has been checked out (detached HEAD) at the tip of the branch under review.
You can read files but cannot edit, commit, or run shell commands beyond read-only inspection.

Your job: review the changes on this branch against the prompt the Implementer was given,
and return a decision.

You SHOULD:
1. Use Read / Glob / Grep to inspect the files that changed.
2. Evaluate correctness, simplicity, and adherence to the original task.
3. Write free-form review notes (these will appear in the agent's transcript).
4. END YOUR RESPONSE with a JSON object matching this schema:
   {
     "decision": "approve" | "request-changes" | "reject",
     "feedback": "<markdown describing required changes; omit when decision is approve>",
     "notes": "<short rationale for the decision>"
   }

The legion runtime enforces the JSON schema via the Codex SDK's outputSchema option,
so your final assistant message will be parsed automatically. Be concise. The Implementer
reads your feedback to decide whether to revise and re-request review.

Use 'approve' only when you have no concrete change to request.
Use 'reject' only when the work is unsalvageable; otherwise prefer 'request-changes'.
`.trim()

// 既存 PROMPTS map (DIRECTOR_PROMPT, IMPLEMENTER_PROMPT) に追加:
const PROMPTS: Record<string, string> = {
  director: DIRECTOR_PROMPT,
  implementer: IMPLEMENTER_PROMPT,
  reviewer: REVIEWER_PROMPT,   // ★ Phase 3
}

export function defaultSystemPromptFor(role: string): string {
  return PROMPTS[role] ?? ''
}
```

- [ ] **Step 5: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/adapter/role-prompts.test.ts
```

期待: REVIEWER_PROMPT test 2 件 pass。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/adapter/role-prompts.ts \
        packages/runtime/test/adapter/role-prompts.test.ts
git commit -m "feat(runtime): add REVIEWER_PROMPT with structured output instructions"
```

---

## Task 2: IMPLEMENTER_PROMPT を拡張 — retry loop semantics

**Files:**
- Modify: `packages/runtime/src/adapter/role-prompts.ts`
- Modify: `packages/runtime/test/adapter/role-prompts.test.ts`

- [ ] **Step 1: failing test を追加 (IMPLEMENTER_PROMPT が Reviewer ループを教える)**

```typescript
describe('IMPLEMENTER_PROMPT (Phase 3 retry loop)', () => {
  it('instructs Implementer to call delegate(role="reviewer") after committing', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toMatch(/delegate.*reviewer/i)
    expect(p).toMatch(/after.*commit/i)
  })

  it('instructs the loop: approve → end, request-changes → revise + recommit + re-review', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toMatch(/approve/i)
    expect(p).toMatch(/request-changes/i)
    expect(p).toMatch(/reject/i)
  })

  it('enforces a soft cap of up to 3 review iterations', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toMatch(/3|three/i)
    expect(p).toMatch(/iterations?|times?/i)
  })

  it('retains Phase 2 IMPLEMENTER instructions (read, edit, commit)', () => {
    const p = defaultSystemPromptFor('implementer')
    expect(p).toMatch(/git add/i)
    expect(p).toMatch(/git commit/i)
    expect(p).toMatch(/worktree/i)
  })
})
```

- [ ] **Step 2: test 実行で失敗を確認**

```bash
bun run test packages/runtime/test/adapter/role-prompts.test.ts
```

期待: Phase 2 prompt は Reviewer ループの記述を含まないので FAIL。

- [ ] **Step 3: IMPLEMENTER_PROMPT を拡張**

```typescript
const IMPLEMENTER_PROMPT = `You are an Implementer agent in legion. You operate inside a git worktree
that was created specifically for this task. The Director has handed you a self-contained
sub-task.

You SHOULD:
1. Read the files relevant to the task.
2. Make the requested edits.
3. Run any quick verification command if applicable (e.g. typecheck).
4. Commit your changes with \`git add -A && git commit -m "<concise message>"\`.
   This is REQUIRED — your branch is how the Director and Reviewer see your work.

After you commit, if a reviewer is configured for this workflow (you will have access to
a 'delegate' tool with role='reviewer'), you SHOULD invoke it:

  delegate(role='reviewer', prompt='Please review the changes I just committed on this branch.',
           rationale='request review')

The reviewer runs synchronously and returns a structured result with fields:
  { decision: 'approve' | 'request-changes' | 'reject', feedback?: string, notes?: string }

How to handle each decision:
- 'approve': summarize what you did, mention the branch name, and end the session.
- 'request-changes': read the feedback, make additional edits, commit again, then call
  delegate(role='reviewer', ...) once more.
- 'reject': end the session with a brief failure summary; do not retry.

Soft cap: do NOT call delegate(role='reviewer') more than 3 times for a single task.
After 3 iterations, end the session with the best result you have regardless of the
latest decision (mention this in your summary).

If no reviewer is configured (no delegate tool available), commit your changes and end
the session as in Phase 2.

You MUST commit before ending. An uncommitted worktree is treated as a failed delegate
by the Director.
`.trim()
```

- [ ] **Step 4: test 実行で pass を確認**

```bash
bun run test packages/runtime/test/adapter/role-prompts.test.ts
```

期待: IMPLEMENTER_PROMPT の 4 件と REVIEWER_PROMPT の 2 件、計 6 件 pass。

- [ ] **Step 5: 既存 Phase 2 real-SDK delegate-flow が引き続き green (Implementer prompt が拡張されたが、Reviewer なしの workflow でも問題なく動くこと)**

```bash
# Windows
$env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-..."; bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: 38.7s で green。"If no reviewer is configured" の分岐が Phase 2 narrow workflow で発火する。

- [ ] **Step 6: commit**

```bash
git add packages/runtime/src/adapter/role-prompts.ts \
        packages/runtime/test/adapter/role-prompts.test.ts
git commit -m "feat(runtime): extend IMPLEMENTER_PROMPT for Reviewer retry loop"
```

---

## Task 3: `feature-with-review.yaml` を作成

**Files:**
- Create: `workflows/feature-with-review.yaml`

- [ ] **Step 1: YAML を作成**

```yaml
# workflows/feature-with-review.yaml
id: feature-with-review
name: Feature with Reviewer (Phase 3)
description: |
  Director delegates to Implementer; Implementer commits and then requests a Reviewer
  (Codex). Retry up to 3 times if the Reviewer requests changes. End on approve / reject
  or after the soft cap.

nodes:
  - id: trigger
    type: trigger
    kind: manual

  - id: director
    type: role
    role: director
    provider: claude-code
    lifetime: per-workflow

  - id: implementer
    type: role
    role: implementer
    provider: claude-code
    lifetime: per-task

  - id: reviewer
    type: role
    role: reviewer
    provider: codex
    lifetime: per-task

  - id: review-results
    type: blackboard
    schema:
      decision: string
      feedback: string

edges:
  - { from: trigger,     to: director,        type: triggers }
  - { from: director,    to: implementer,     type: delegates }
  - { from: implementer, to: reviewer,        type: reviews }
  - { from: reviewer,    to: review-results,  type: publishes }
```

- [ ] **Step 2: template loader test を追加 (既存テストファイルに 1 件追加)**

a01 で template-validate を test 済なので、ここでは loader 側で "feature-with-review.yaml が template-validate を通る" ことを確認。

```typescript
// packages/runtime/test/orchestrator/template-loader.test.ts (新規 or 既存) に追加
it('loads and validates feature-with-review.yaml without errors', async () => {
  const path = join(import.meta.dir, '../../../../workflows/feature-with-review.yaml')
  const tmpl = await loadWorkflowTemplate(path)
  const result = validateTemplate(tmpl, new Set(['claude-code', 'codex']))
  expect(result.errors).toEqual([])
})
```

(関数名 `loadWorkflowTemplate` は Phase 1/2 既存。`import.meta.dir` で test ファイル位置から workflows/ を引く relative path を組む。)

- [ ] **Step 3: test 実行で pass を確認 (YAML 構文 + validate)**

```bash
bun run test packages/runtime/test/orchestrator/
```

期待: green。

- [ ] **Step 4: commit**

```bash
git add workflows/feature-with-review.yaml \
        packages/runtime/test/orchestrator/template-loader.test.ts
git commit -m "feat(workflows): add feature-with-review.yaml (Phase 3 template)"
```

---

## Task 4: 全体 verification

- [ ] **Step 1: full typecheck + test**

```bash
bun run typecheck && bun run test
```

期待: green、~6 件追加 (REVIEWER 2 + IMPLEMENTER 4 + template loader 1)。

- [ ] **Step 2: 既存 Phase 2 delegate-flow integration test (auth ありなら)**

```bash
$env:CLAUDE_CODE_OAUTH_TOKEN = "..."; bun run test packages/runtime/test/integration/delegate-flow.integration.test.ts
```

期待: green。Phase 3 で Implementer prompt が拡張されたが、Phase 2 narrow の `feature-implementation.yaml` には reviews edge がないので、Implementer は "If no reviewer is configured" 分岐に入って Phase 2 と同じ挙動になる。

---

## Done criteria

a05 完了時点で:

- `defaultSystemPromptFor('reviewer')` が REVIEWER_PROMPT を返す
- `defaultSystemPromptFor('implementer')` が retry loop semantics を含む拡張版を返す
- `workflows/feature-with-review.yaml` が validateTemplate を通る
- `bun run test`: green、~6 件追加
- `bun run typecheck`: green
- 既存 Phase 2 `delegate-flow.integration.test.ts` が引き続き green (回帰なし)
- 手動: 拡張版 IMPLEMENTER_PROMPT を Phase 2 narrow workflow (reviewer なし) で動かしたとき、Implementer が "no reviewer configured" 分岐で正常終了することをログで確認

次の a06 では Phase 3 全機能を E2E で繋ぐ real-SDK integration test (`delegate-flow-review.integration.test.ts`) を書き、retry loop + Codex Reviewer の動作を verify する。a05 完了で全構成要素が揃った状態。
