# Phase 1 / a01: Worktree 実装計画

> **エージェント worker 向け:** 必須 sub-skill: `superpowers:subagent-driven-development` (推奨) または `superpowers:executing-plans` を使い、本計画を 1 task ずつ実装してください。Steps は checkbox (`- [ ]`) で進捗管理。

**Goal:** Phase 1 spec §3〜§4 (D-023〜D-031) に従って、`AgentWorkspace` 抽象と `LocalWorktreeProvider`、`.legion.yaml` ローダ、setup フックランナー、`legion cleanup` コマンドを実装し、CLI から worktree を生成・破棄できる状態にする。

**Architecture:** `packages/core` に型追加 (`WorkspaceRef`, `LegionConfig`)。`packages/runtime` に worktree 操作と config ローダ。新規 `packages/cli` に `legion cleanup` を置く。git は subprocess 呼び出しで使う (Node.js / Bun の git ラッパは導入しない)。テストは bun:test、ハーミティック (一時ディレクトリで実 git を回す)。

**Tech Stack:** TypeScript 5.7 / Bun 1.3.14 / bun:test 内蔵 / `git` CLI / 新規依存 `ulid` / 新規依存 `yaml`。

**Spec reference:** [../specs/2026-05-13_phase1_design.md](../specs/2026-05-13_phase1_design.md) §3, §4
**Decisions reference:** D-023, D-024, D-025, D-026, D-027, D-028, D-031

---

## File Structure

新規作成:

- `packages/core/src/types/workspace.ts` — `WorkspaceRef` 型 (D-024)
- `packages/core/src/types/config.ts` — `LegionConfig` 型 (`.legion.yaml` スキーマ、D-028)
- `packages/runtime/src/workspace/provider.ts` — `WorkspaceProvider` interface (D-023)
- `packages/runtime/src/workspace/local-worktree-provider.ts` — `LocalWorktreeProvider` 実装
- `packages/runtime/src/workspace/repo-fingerprint.ts` — repo の fingerprint 生成 (D-025)
- `packages/runtime/src/workspace/branch-naming.ts` — `legion/<wfShortId>/<role>-<seq>` 生成 (D-026)
- `packages/runtime/src/workspace/git.ts` — git subprocess の薄いラッパ (`git worktree add` / `git worktree remove` / `git branch` / `git rev-parse`)
- `packages/runtime/src/config/loader.ts` — `.legion.yaml` ローダ (D-028)
- `packages/runtime/src/config/setup-runner.ts` — setup フック実行ランナー
- `packages/runtime/src/cleanup/cleanup.ts` — `legion cleanup` ロジック (D-031)
- `packages/cli/package.json` — 新規 CLI パッケージ
- `packages/cli/tsconfig.json`
- `packages/cli/src/index.ts` — CLI エントリポイント
- `packages/cli/src/commands/cleanup.ts` — cleanup サブコマンド
- `packages/cli/bin/legion.ts` — bun 実行用 shim
- `packages/runtime/test/workspace/repo-fingerprint.test.ts`
- `packages/runtime/test/workspace/branch-naming.test.ts`
- `packages/runtime/test/workspace/local-worktree-provider.test.ts`
- `packages/runtime/test/config/loader.test.ts`
- `packages/runtime/test/config/setup-runner.test.ts`
- `packages/runtime/test/cleanup/cleanup.test.ts`
- `packages/runtime/test/helpers/temp-repo.ts` — テスト用 helper (一時 git repo を立てる)

修正:

- `packages/core/src/types/agent-provider.ts` — `attach` を optional、`PtyHandle` の用途明文化
- `packages/core/src/index.ts` — 新規型の再 export
- `packages/runtime/src/index.ts` — 新規 module の再 export
- `packages/runtime/package.json` — `ulid`, `yaml` 追加、`test` script 追加
- `packages/runtime/tsconfig.json` — `include` を `test/**/*` も拾うよう更新
- `package.json` — `cli` workspace の追加確認 / `test` script 追加

---

## 予測行数 (実装完了時の安定状態想定、実測と突合する)

CLAUDE.md の Line Count Awareness / Refactoring Policy (関数 100 / クラス 500 / ファイル 1000) を計画段階で逸脱しないことを確認する。

### 実装ファイル

| ファイル | 予測行数 | 主要内訳 | 上限への余裕 |
| --- | ---: | --- | --- |
| `core/src/types/workspace.ts` | 10 | `WorkspaceRef` union | 余裕大 |
| `core/src/types/config.ts` | 18 | `LegionConfig` + `LegionWorktreeConfig` | 余裕大 |
| `runtime/src/workspace/provider.ts` | 25 | `WorkspaceProvider` interface + I/O 型 | 余裕大 |
| `runtime/src/workspace/local-worktree-provider.ts` | 75 | `LocalWorktreeProvider` クラス (create 25 / destroy 10 / list 20 / private 10) | クラス上限 500 / 関数上限 100 ともに余裕大 |
| `runtime/src/workspace/repo-fingerprint.ts` | 10 | 1 関数 | 余裕大 |
| `runtime/src/workspace/branch-naming.ts` | 25 | `wfShortId` + `branchName` 2 関数 + 定数 | 余裕大 |
| `runtime/src/workspace/git.ts` | 85 | 6 関数 + `parseWorktreeListPorcelain` (~30) | 余裕大 |
| `runtime/src/config/loader.ts` | 55 | `loadLegionConfig` + `validate` (~25) + `ensureStringArray` | 余裕大 |
| `runtime/src/config/setup-runner.ts` | 40 | `runWorktreeSetup` 1 関数 | 余裕大 |
| `runtime/src/cleanup/cleanup.ts` | 85 | `classifyForCleanup` (~25) + `runCleanup` (~35) + 型 | 余裕大 |
| `runtime/src/version.ts` | 2 | 定数のみ | 余裕大 |
| `runtime/src/index.ts` (修正) | 14 | re-export 集約 | 余裕大 |
| `cli/src/index.ts` | 30 | `runCli` (~25) | 余裕大 |
| `cli/src/commands/cleanup.ts` | 30 | `cleanupCommand` 1 関数 | 余裕大 |
| `cli/bin/legion.ts` | 5 | shim | 余裕大 |
| **実装小計** | **509** | | |

### テストファイル

| ファイル | 予測行数 |
| --- | ---: |
| `core/test/types/workspace.test.ts` | 25 |
| `core/test/types/config.test.ts` | 25 |
| `core/test/types/agent-provider.test.ts` | 25 |
| `runtime/test/helpers/temp-repo.ts` | 30 |
| `runtime/test/helpers/temp-repo.smoke.test.ts` | 20 |
| `runtime/test/workspace/repo-fingerprint.test.ts` | 35 |
| `runtime/test/workspace/branch-naming.test.ts` | 35 |
| `runtime/test/workspace/git.test.ts` | 80 |
| `runtime/test/workspace/local-worktree-provider.test.ts` | 130 |
| `runtime/test/config/loader.test.ts` | 50 |
| `runtime/test/config/setup-runner.test.ts` | 80 |
| `runtime/test/cleanup/cleanup.test.ts` | 110 |
| **テスト小計** | **645** |

### 粒度評価

- 最大ファイル予測 = `git.ts` 85 行 (上限 1000 に対して 8.5%)。`local-worktree-provider.ts` 75 行が次点。
- 最大関数予測 = `parseWorktreeListPorcelain` 30 行 (上限 100 に対して 30%)。
- クラス予測最大 = `LocalWorktreeProvider` 70 行 (上限 500 に対して 14%)。
- いずれも上限に対して **3〜10 倍の安全余裕**。本計画レベルでの過剰分割なし、不足分割もなし。
- 1 ファイル 1 責務 (e.g. branch 命名は `branch-naming.ts`、fingerprint は `repo-fingerprint.ts`) で読みやすさ優先の split を採用しているため、行数だけでなく concern 分離の意味でも妥当。
- 実装着手後、各ファイルが予測の ±30% 以内に収まるかを確認すること。逸脱があれば本計画末尾「実測との突合」セクションに記録する。

---

## Task 1: 新規依存 (`ulid`, `yaml`) の D-010 チェックリスト承認

D-010 (サードパーティ健全性監視) では依存追加前に以下をチェックする。本タスクはチェック実施と user 承認取得まで。

**Files:**
- 修正: なし (調査のみ)

- [ ] **Step 1: `ulid` パッケージの健全性を調査**

確認項目:
- npm 上の最新版とリリース日
- メンテナンス状況 (直近 6ヶ月の更新有無)
- 既知のセキュリティアドバイザリ (`bun audit` または npm advisories 検索)
- 代替候補 (`nanoid`, `uuid` v7) との比較

実行:

```bash
bun pm view ulid versions --json | head -5
bun pm view ulid time --json | tail -10
```

期待: ulid (npm) は安定パッケージ。代替の `ulid-workers`, `ulidx` (TypeScript-native fork) と比較し、TS 親和性が高い方を選定。

- [ ] **Step 2: `yaml` パッケージの健全性を調査**

確認項目: 同上。

実行:

```bash
bun pm view yaml versions --json | head -5
bun pm view yaml time --json | tail -10
```

期待: `yaml` (npm) は eemeli/yaml の TypeScript-native 実装。最近の侵害履歴は無い見込み。`js-yaml` (より古典的) と比較する。

- [ ] **Step 3: 調査結果を要約して user 承認を要求**

Claude が user に提示する内容:

```
D-010 checklist 結果:
- ulid (or ulidx):
  - 直近版: ...
  - 直近リリース: ...
  - インシデント: 無し
  - 推奨: ulidx (TS-native, 0 deps)
- yaml:
  - 直近版: ...
  - 直近リリース: ...
  - インシデント: 無し
  - 推奨: yaml (eemeli/yaml)
採用してよいですか？
```

期待: user 承認。承認なしでは Task 2 以降に進まない。

- [ ] **Step 4: 承認後、依存を追加**

```bash
bun add ulidx yaml --filter @legion/runtime
```

(またはユーザーが別パッケージを指定したらそれを使う)

期待: `packages/runtime/package.json` に `dependencies` として追加され、`bun.lockb` が更新される。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/package.json bun.lockb
git commit -m "deps: add ulidx and yaml to runtime per D-010"
```

---

## Task 2: `WorkspaceRef` 型を core に追加

**Files:**
- Create: `packages/core/src/types/workspace.ts`
- Modify: `packages/core/src/index.ts` (export 追加)

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/types/workspace.test.ts` を新規作成 (パッケージ core にテスト dir が無ければ追加):

```ts
import { describe, test, expect } from 'bun:test'
import type { WorkspaceRef } from '@legion/core'

describe('WorkspaceRef type', () => {
  test('owned variant accepts path and optional branch', () => {
    const ref: WorkspaceRef = {
      kind: 'owned',
      path: '/tmp/wt',
      branch: 'legion/wf01j9x/impl-1',
    }
    expect(ref.kind).toBe('owned')
  })

  test('owned variant allows omitting branch (detached)', () => {
    const ref: WorkspaceRef = { kind: 'owned', path: '/tmp/wt' }
    expect(ref.kind).toBe('owned')
  })

  test('shared variant has targetInstanceId and mode', () => {
    const ref: WorkspaceRef = {
      kind: 'shared',
      targetInstanceId: 'inst-1',
      mode: 'ro',
    }
    expect(ref.kind).toBe('shared')
  })
})
```

このテストが現状 `WorkspaceRef` 型が無いので tsc レベルで失敗する。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
bun test packages/core/test/types/workspace.test.ts
```

期待: TypeScript エラー (`Cannot find name 'WorkspaceRef'`)。

- [ ] **Step 3: `WorkspaceRef` 型を追加**

`packages/core/src/types/workspace.ts` を新規作成:

```ts
// D-024: One Agent Instance owns one WorkspaceRef.
// In Phase 1 only the `owned` variant is implemented at runtime; `shared` is reserved.

export type WorkspaceRef =
  | { kind: 'owned'; path: string; branch?: string }
  | { kind: 'shared'; targetInstanceId: string; mode: 'ro' | 'rw' }
```

`packages/core/src/index.ts` に追加:

```ts
export * from './types/template'
export * from './types/instance'
export * from './types/task'
export * from './types/agent-provider'
export * from './types/blackboard'
export * from './types/event'
export * from './types/workspace'
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
bun test packages/core/test/types/workspace.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/workspace.ts packages/core/src/index.ts packages/core/test/types/workspace.test.ts
git commit -m "feat(core): add WorkspaceRef type per D-024"
```

---

## Task 3: `LegionConfig` 型 (`.legion.yaml` スキーマ) を core に追加

**Files:**
- Create: `packages/core/src/types/config.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/test/types/config.test.ts`:

```ts
import { describe, test, expect } from 'bun:test'
import type { LegionConfig } from '@legion/core'

describe('LegionConfig type', () => {
  test('minimal config with no worktree section is valid', () => {
    const cfg: LegionConfig = {}
    expect(cfg).toBeDefined()
  })

  test('worktree section has setup and copyFiles arrays', () => {
    const cfg: LegionConfig = {
      worktree: {
        setup: ['bun install'],
        copyFiles: ['.env.local'],
      },
    }
    expect(cfg.worktree?.setup).toEqual(['bun install'])
  })

  test('worktree.ports area is reserved (empty record allowed)', () => {
    const cfg: LegionConfig = { worktree: { ports: {} } }
    expect(cfg.worktree?.ports).toEqual({})
  })
})
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
bun test packages/core/test/types/config.test.ts
```

期待: `Cannot find name 'LegionConfig'`。

- [ ] **Step 3: `LegionConfig` 型を追加**

`packages/core/src/types/config.ts`:

```ts
// D-028: .legion.yaml schema. Phase 1 implements worktree.setup and worktree.copyFiles.
// worktree.ports is reserved for Phase 3 (D-029).

export interface LegionWorktreeConfig {
  setup?: string[]
  copyFiles?: string[]
  ports?: Record<string, unknown>
}

export interface LegionConfig {
  worktree?: LegionWorktreeConfig
}
```

`packages/core/src/index.ts` に export 追加:

```ts
export * from './types/config'
```

- [ ] **Step 4: テストを実行して成功を確認**

```bash
bun test packages/core/test/types/config.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/config.ts packages/core/src/index.ts packages/core/test/types/config.test.ts
git commit -m "feat(core): add LegionConfig type for .legion.yaml per D-028"
```

---

## Task 4: `AgentProvider` 型の Phase 1 調整 (attach を optional 化)

**Files:**
- Modify: `packages/core/src/types/agent-provider.ts`

- [ ] **Step 1: 既存の `agent-provider.ts` を読む**

```bash
cat packages/core/src/types/agent-provider.ts
```

該当: 88 行目あたりの `attach(sessionId: string): Promise<PtyHandle>`。

- [ ] **Step 2: 失敗するテストを書く**

`packages/core/test/types/agent-provider.test.ts`:

```ts
import { describe, test, expect } from 'bun:test'
import type { AgentProvider } from '@legion/core'

describe('AgentProvider type', () => {
  test('attach is optional in Phase 1', () => {
    // Provider without attach must compile (no error)
    const noAttach: Pick<AgentProvider, 'id' | 'displayName' | 'capabilities'> = {
      id: 'test',
      displayName: 'Test',
      capabilities: {
        supportsCheckpoint: false,
        supportsResume: false,
        supportsAttach: false,
        supportsApprovalFlow: false,
      },
    }
    expect(noAttach.capabilities.supportsAttach).toBe(false)
  })
})
```

このテスト自体は AgentProvider の `attach` が required のままだと意味的にはパスしうるが、目的の確認のため後段で full implementation テストを追加する。

- [ ] **Step 3: `agent-provider.ts` を編集して `attach` を optional に**

`packages/core/src/types/agent-provider.ts` の該当部分を:

```ts
  // D-032: attach() and PtyHandle are unused in Phase 1 (Agent SDK has no PTY).
  // Implementations whose capabilities.supportsAttach is false may omit this method.
  attach?(sessionId: string): Promise<PtyHandle>
```

に修正。`PtyHandle` 自体は将来 (CLI provider 等) のため残す。

- [ ] **Step 4: tsc + テスト**

```bash
bun run typecheck
bun test packages/core/test/types/agent-provider.test.ts
```

期待: tsc pass、1 test passed。

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/agent-provider.ts packages/core/test/types/agent-provider.test.ts
git commit -m "refactor(core): make AgentProvider.attach optional per D-032"
```

---

## Task 5: `repo-fingerprint.ts` の実装

`<repo-fingerprint>` = `${repoBasename}-${shortHashOfFullPath}` (D-025)。

**Files:**
- Create: `packages/runtime/src/workspace/repo-fingerprint.ts`
- Create: `packages/runtime/test/workspace/repo-fingerprint.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { repoFingerprint } from '@legion/runtime/workspace/repo-fingerprint'

describe('repoFingerprint', () => {
  test('combines basename and short hash of absolute path', () => {
    const fp = repoFingerprint('/home/me/code/legion')
    expect(fp).toMatch(/^legion-[a-f0-9]{8}$/)
  })

  test('same path produces same fingerprint (deterministic)', () => {
    const a = repoFingerprint('/home/me/code/legion')
    const b = repoFingerprint('/home/me/code/legion')
    expect(a).toBe(b)
  })

  test('different paths with same basename produce different fingerprints', () => {
    const a = repoFingerprint('/home/me/code/legion')
    const b = repoFingerprint('/tmp/other/legion')
    expect(a).not.toBe(b)
  })

  test('Windows-style path is accepted (normalized)', () => {
    const fp = repoFingerprint('D:\\Projects\\Misc\\legion')
    expect(fp).toMatch(/^legion-[a-f0-9]{8}$/)
  })
})
```

- [ ] **Step 2: 実行して失敗を確認**

```bash
bun test packages/runtime/test/workspace/repo-fingerprint.test.ts
```

期待: module not found エラー。

- [ ] **Step 3: 実装**

`packages/runtime/src/workspace/repo-fingerprint.ts`:

```ts
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function repoFingerprint(repoPath: string): string {
  const absolute = resolve(repoPath)
  const name = basename(absolute)
  const hash = createHash('sha1').update(absolute).digest('hex').slice(0, 8)
  return `${name}-${hash}`
}
```

(`resolve` で Windows/POSIX 双方の path を正規化する。)

- [ ] **Step 4: 実行して成功を確認**

```bash
bun test packages/runtime/test/workspace/repo-fingerprint.test.ts
```

期待: 4 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/workspace/repo-fingerprint.ts packages/runtime/test/workspace/repo-fingerprint.test.ts
git commit -m "feat(runtime): add repoFingerprint helper per D-025"
```

---

## Task 6: `branch-naming.ts` の実装

`legion/<wfShortId>/<role>-<seq>` (D-026)。

**Files:**
- Create: `packages/runtime/src/workspace/branch-naming.ts`
- Create: `packages/runtime/test/workspace/branch-naming.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect } from 'bun:test'
import { branchName, wfShortId } from '@legion/runtime/workspace/branch-naming'

describe('wfShortId', () => {
  test('returns first 8 chars of a ULID-shaped string', () => {
    const ulid = '01J9X5Z8YK0123456789ABCDEF'
    expect(wfShortId(ulid)).toBe('01j9x5z8')
  })

  test('lower-cases the input', () => {
    expect(wfShortId('01J9X5Z8YK0000000000000000')).toBe('01j9x5z8')
  })
})

describe('branchName', () => {
  test('formats as legion/<wfShortId>/<role>-<seq>', () => {
    expect(branchName('01j9x5z8', 'implementer', 1)).toBe('legion/01j9x5z8/impl-1')
  })

  test('uses canonical role abbreviation', () => {
    expect(branchName('01j9x5z8', 'director', 1)).toBe('legion/01j9x5z8/director')
    expect(branchName('01j9x5z8', 'reviewer', 1)).toBe('legion/01j9x5z8/reviewer-1')
  })

  test('zero seq throws (sequence must be >= 1)', () => {
    expect(() => branchName('01j9x5z8', 'implementer', 0)).toThrow()
  })
})
```

(role abbreviation のルール: `implementer` → `impl`、その他は role 名そのまま。Director は per-workflow なので seq=1 でも `director` (seq 省略) とする。)

- [ ] **Step 2: 実行して失敗を確認**

```bash
bun test packages/runtime/test/workspace/branch-naming.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/workspace/branch-naming.ts`:

```ts
export function wfShortId(workflowInstanceId: string): string {
  return workflowInstanceId.slice(0, 8).toLowerCase()
}

const ROLE_ABBREVIATION: Record<string, string> = {
  implementer: 'impl',
}

const SINGLETON_ROLES = new Set(['director'])

export function branchName(wfShortId: string, role: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error(`branchName: seq must be a positive integer, got ${seq}`)
  }
  const abbr = ROLE_ABBREVIATION[role] ?? role
  if (SINGLETON_ROLES.has(role)) {
    return `legion/${wfShortId}/${abbr}`
  }
  return `legion/${wfShortId}/${abbr}-${seq}`
}
```

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/workspace/branch-naming.test.ts
```

期待: 5 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/workspace/branch-naming.ts packages/runtime/test/workspace/branch-naming.test.ts
git commit -m "feat(runtime): add branch naming helper per D-026"
```

---

## Task 7: テスト用 helper (`temp-repo.ts`) を作成

git 実行を伴うテストはハーミティックでなければならない。OS の temp dir に scratch repo を立てる helper を整備。

**Files:**
- Create: `packages/runtime/test/helpers/temp-repo.ts`

- [ ] **Step 1: helper を実装**

```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'

export interface TempRepo {
  path: string
  cleanup: () => Promise<void>
}

/**
 * Initializes a git repo in a fresh temp directory with one initial commit on
 * a branch named "main". Returns the absolute path and a cleanup function.
 */
export async function makeTempRepo(): Promise<TempRepo> {
  const path = await mkdtemp(join(tmpdir(), 'legion-test-'))
  await $`git init -b main`.cwd(path).quiet()
  await $`git config user.email test@legion.local`.cwd(path).quiet()
  await $`git config user.name "legion test"`.cwd(path).quiet()
  await writeFile(join(path, 'README.md'), '# scratch\n')
  await $`git add README.md`.cwd(path).quiet()
  await $`git commit -m "initial"`.cwd(path).quiet()
  return {
    path,
    cleanup: async () => {
      await rm(path, { recursive: true, force: true })
    },
  }
}
```

(Bun shell `$` を使う。Bun 1.3 で安定機能。)

- [ ] **Step 2: helper 単体の smoke テスト**

`packages/runtime/test/helpers/temp-repo.smoke.test.ts`:

```ts
import { describe, test, expect } from 'bun:test'
import { $ } from 'bun'
import { makeTempRepo } from './temp-repo'

describe('makeTempRepo', () => {
  test('initializes a git repo on main with one commit', async () => {
    const repo = await makeTempRepo()
    try {
      const result = await $`git rev-parse --abbrev-ref HEAD`.cwd(repo.path).quiet().text()
      expect(result.trim()).toBe('main')
      const count = await $`git rev-list --count HEAD`.cwd(repo.path).quiet().text()
      expect(parseInt(count.trim(), 10)).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })
})
```

- [ ] **Step 3: smoke テスト実行**

```bash
bun test packages/runtime/test/helpers/temp-repo.smoke.test.ts
```

期待: 1 test passed。

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/test/helpers/temp-repo.ts packages/runtime/test/helpers/temp-repo.smoke.test.ts
git commit -m "test(runtime): add temp-repo helper for hermetic git tests"
```

---

## Task 8: `git.ts` の薄いラッパ実装

`git worktree add` / `git worktree remove` / `git worktree list` / `git rev-parse` / `git branch -d` を subprocess で呼ぶ薄い層。

**Files:**
- Create: `packages/runtime/src/workspace/git.ts`
- Create: `packages/runtime/test/workspace/git.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import {
  resolveCommitSha,
  worktreeAdd,
  worktreeRemove,
  worktreeList,
  branchExists,
  branchDelete,
} from '@legion/runtime/workspace/git'

let repo: TempRepo

beforeEach(async () => {
  repo = await makeTempRepo()
})

afterEach(async () => {
  await repo.cleanup()
})

describe('resolveCommitSha', () => {
  test('resolves HEAD to a 40-char SHA', async () => {
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    expect(sha).toMatch(/^[a-f0-9]{40}$/)
  })

  test('resolves main branch to same SHA as HEAD', async () => {
    const a = await resolveCommitSha(repo.path, 'HEAD')
    const b = await resolveCommitSha(repo.path, 'main')
    expect(a).toBe(b)
  })
})

describe('worktreeAdd / worktreeRemove / worktreeList', () => {
  test('adds and removes a detached worktree', async () => {
    const wtPath = join(repo.path, '..', 'wt-detached')
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await worktreeAdd(repo.path, { path: wtPath, commit: sha, detach: true })
    const list = await worktreeList(repo.path)
    expect(list.some((w) => w.path === wtPath)).toBe(true)
    await worktreeRemove(repo.path, wtPath)
    const after = await worktreeList(repo.path)
    expect(after.some((w) => w.path === wtPath)).toBe(false)
  })

  test('adds a branched worktree on a new branch', async () => {
    const wtPath = join(repo.path, '..', 'wt-branched')
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await worktreeAdd(repo.path, {
      path: wtPath,
      commit: sha,
      branch: 'legion/test01/impl-1',
    })
    expect(await branchExists(repo.path, 'legion/test01/impl-1')).toBe(true)
    await worktreeRemove(repo.path, wtPath)
    await branchDelete(repo.path, 'legion/test01/impl-1')
    expect(await branchExists(repo.path, 'legion/test01/impl-1')).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/workspace/git.test.ts
```

期待: module not found。

- [ ] **Step 3: 実装**

`packages/runtime/src/workspace/git.ts`:

```ts
import { $ } from 'bun'

export interface WorktreeAddOptions {
  path: string
  commit: string
  branch?: string
  detach?: boolean
}

export interface WorktreeListEntry {
  path: string
  head: string
  branch?: string
  detached: boolean
}

export async function resolveCommitSha(repoCwd: string, ref: string): Promise<string> {
  const out = await $`git rev-parse ${ref}`.cwd(repoCwd).quiet().text()
  const sha = out.trim()
  if (!/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error(`resolveCommitSha: unexpected output for ref ${ref}: ${sha}`)
  }
  return sha
}

export async function worktreeAdd(repoCwd: string, opts: WorktreeAddOptions): Promise<void> {
  if (opts.branch && opts.detach) {
    throw new Error('worktreeAdd: cannot use both branch and detach')
  }
  if (opts.branch) {
    await $`git worktree add -b ${opts.branch} ${opts.path} ${opts.commit}`
      .cwd(repoCwd)
      .quiet()
    return
  }
  if (opts.detach) {
    await $`git worktree add --detach ${opts.path} ${opts.commit}`.cwd(repoCwd).quiet()
    return
  }
  throw new Error('worktreeAdd: must specify branch or detach=true')
}

export async function worktreeRemove(repoCwd: string, wtPath: string): Promise<void> {
  await $`git worktree remove ${wtPath}`.cwd(repoCwd).quiet()
}

export async function worktreeList(repoCwd: string): Promise<WorktreeListEntry[]> {
  const out = await $`git worktree list --porcelain`.cwd(repoCwd).quiet().text()
  return parseWorktreeListPorcelain(out)
}

function parseWorktreeListPorcelain(text: string): WorktreeListEntry[] {
  const entries: WorktreeListEntry[] = []
  let current: Partial<WorktreeListEntry> = {}
  for (const line of text.split('\n')) {
    if (line === '') {
      if (current.path && current.head) {
        entries.push({
          path: current.path,
          head: current.head,
          branch: current.branch,
          detached: current.detached ?? false,
        })
      }
      current = {}
      continue
    }
    const [key, ...rest] = line.split(' ')
    const value = rest.join(' ')
    if (key === 'worktree') current.path = value
    else if (key === 'HEAD') current.head = value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'detached') current.detached = true
  }
  if (current.path && current.head) {
    entries.push({
      path: current.path,
      head: current.head,
      branch: current.branch,
      detached: current.detached ?? false,
    })
  }
  return entries
}

export async function branchExists(repoCwd: string, branch: string): Promise<boolean> {
  const proc = await $`git show-ref --verify --quiet refs/heads/${branch}`
    .cwd(repoCwd)
    .quiet()
    .nothrow()
  return proc.exitCode === 0
}

export async function branchDelete(repoCwd: string, branch: string): Promise<void> {
  await $`git branch -D ${branch}`.cwd(repoCwd).quiet()
}
```

(ファイル長: ~80 行。CLAUDE.md の 100 行関数 / 1000 行ファイル制限内。`parseWorktreeListPorcelain` は分離関数として独立。)

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/workspace/git.test.ts
```

期待: 4 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/workspace/git.ts packages/runtime/test/workspace/git.test.ts
git commit -m "feat(runtime): add thin git subprocess wrapper for worktree ops"
```

---

## Task 9: `WorkspaceProvider` interface を定義

D-023 で AgentWorkspace を概念第一級にする件。runtime レイヤの interface。

**Files:**
- Create: `packages/runtime/src/workspace/provider.ts`

- [ ] **Step 1: interface ファイルを作成**

`packages/runtime/src/workspace/provider.ts`:

```ts
// D-023: AgentWorkspace is the first-class runtime concept. Phase 1 provides
// LocalWorktreeProvider; Phase 4 will add RemoteCloneProvider.

import type { WorkspaceRef } from '@legion/core'

export interface WorkspaceCreateInput {
  workflowInstanceId: string
  agentInstanceId: string
  role: string
  seq: number
  baseCommitSha: string
}

export interface WorkspaceDescriptor {
  ref: WorkspaceRef
  path: string
}

export interface WorkspaceProvider {
  /** Create the workspace and return its descriptor. */
  create(input: WorkspaceCreateInput): Promise<WorkspaceDescriptor>

  /** Destroy the workspace; idempotent (no-op if already gone). */
  destroy(descriptor: WorkspaceDescriptor): Promise<void>

  /** List existing workspaces for cleanup / observability. */
  list(workflowInstanceId?: string): Promise<WorkspaceDescriptor[]>
}
```

- [ ] **Step 2: tsc 確認**

```bash
bun run typecheck
```

期待: pass。型 only、テスト不要。

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/src/workspace/provider.ts
git commit -m "feat(runtime): add WorkspaceProvider interface per D-023"
```

---

## Task 10: `LocalWorktreeProvider` の create 実装

**Files:**
- Create: `packages/runtime/src/workspace/local-worktree-provider.ts`
- Create: `packages/runtime/test/workspace/local-worktree-provider.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { resolveCommitSha } from '@legion/runtime/workspace/git'

let repo: TempRepo
let baseDir: string

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-wt-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('LocalWorktreeProvider.create', () => {
  test('creates a branched worktree for Implementer role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl-a',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    expect(desc.ref).toEqual({
      kind: 'owned',
      path: desc.path,
      branch: 'legion/01j9x5z8/impl-1',
    })
    expect(desc.path).toContain(join('legion-', ''))
    // The path should exist
    const stat = await Bun.file(join(desc.path, 'README.md')).exists()
    expect(stat).toBe(true)
  })

  test('creates a detached worktree for Director role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-dir',
      role: 'director',
      seq: 1,
      baseCommitSha: sha,
    })
    expect(desc.ref).toEqual({
      kind: 'owned',
      path: desc.path,
      // no branch for detached
    })
  })

  test('creates a detached worktree for Reviewer role', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    expect((desc.ref as { kind: 'owned' }).kind).toBe('owned')
    expect((desc.ref as { branch?: string }).branch).toBeUndefined()
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/workspace/local-worktree-provider.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/workspace/local-worktree-provider.ts`:

```ts
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { WorkspaceRef } from '@legion/core'
import { resolveCommitSha, worktreeAdd, worktreeRemove, worktreeList } from './git'
import { branchName, wfShortId } from './branch-naming'
import { repoFingerprint } from './repo-fingerprint'
import type {
  WorkspaceCreateInput,
  WorkspaceDescriptor,
  WorkspaceProvider,
} from './provider'

export interface LocalWorktreeProviderOptions {
  /** Path to the target repository (the user's project repo). */
  repoPath: string
  /** Base directory where worktrees are created. Default: ~/.legion/worktrees */
  baseDir: string
}

const DETACHED_ROLES = new Set(['director', 'reviewer'])

export class LocalWorktreeProvider implements WorkspaceProvider {
  constructor(private readonly opts: LocalWorktreeProviderOptions) {}

  async create(input: WorkspaceCreateInput): Promise<WorkspaceDescriptor> {
    const path = this.pathFor(input)
    await mkdir(join(path, '..'), { recursive: true })
    if (DETACHED_ROLES.has(input.role)) {
      await worktreeAdd(this.opts.repoPath, {
        path,
        commit: input.baseCommitSha,
        detach: true,
      })
      return { ref: { kind: 'owned', path }, path }
    }
    const branch = branchName(wfShortId(input.workflowInstanceId), input.role, input.seq)
    await worktreeAdd(this.opts.repoPath, {
      path,
      commit: input.baseCommitSha,
      branch,
    })
    return { ref: { kind: 'owned', path, branch }, path }
  }

  async destroy(descriptor: WorkspaceDescriptor): Promise<void> {
    // idempotent: ignore if already gone
    const list = await worktreeList(this.opts.repoPath)
    if (!list.some((w) => w.path === descriptor.path)) return
    await worktreeRemove(this.opts.repoPath, descriptor.path)
  }

  async list(workflowInstanceId?: string): Promise<WorkspaceDescriptor[]> {
    const all = await worktreeList(this.opts.repoPath)
    const prefix = workflowInstanceId
      ? join(this.opts.baseDir, repoFingerprint(this.opts.repoPath), workflowInstanceId)
      : join(this.opts.baseDir, repoFingerprint(this.opts.repoPath))
    return all
      .filter((w) => w.path.startsWith(prefix))
      .map((w) => ({
        path: w.path,
        ref: w.branch
          ? ({ kind: 'owned', path: w.path, branch: w.branch } as WorkspaceRef)
          : ({ kind: 'owned', path: w.path } as WorkspaceRef),
      }))
  }

  private pathFor(input: WorkspaceCreateInput): string {
    return join(
      this.opts.baseDir,
      repoFingerprint(this.opts.repoPath),
      input.workflowInstanceId,
      input.agentInstanceId,
    )
  }
}
```

(ファイル長: ~70 行。)

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/workspace/local-worktree-provider.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/workspace/local-worktree-provider.ts packages/runtime/test/workspace/local-worktree-provider.test.ts
git commit -m "feat(runtime): LocalWorktreeProvider.create per D-024/D-025/D-026"
```

---

## Task 11: `LocalWorktreeProvider.destroy` と `list` の追加テスト

(create は Task 10 で動いたが、destroy / list はテストカバーが薄い。)

**Files:**
- Modify: `packages/runtime/test/workspace/local-worktree-provider.test.ts`

- [ ] **Step 1: テスト追加**

`local-worktree-provider.test.ts` に describe block を追加:

```ts
describe('LocalWorktreeProvider.destroy', () => {
  test('removes a previously created worktree', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-x',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.destroy(desc)
    const remaining = await provider.list('01j9x5z8yk0000000000000000')
    expect(remaining.map((w) => w.path)).not.toContain(desc.path)
  })

  test('is idempotent: calling destroy twice does not throw', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-y',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.destroy(desc)
    await provider.destroy(desc) // second call: no-op
  })
})

describe('LocalWorktreeProvider.list', () => {
  test('lists only worktrees under the given workflow instance', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-a',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    await provider.create({
      workflowInstanceId: '01j9OTHER999000000000000000',
      agentInstanceId: 'inst-b',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    const list = await provider.list('01j9x5z8yk0000000000000000')
    expect(list.length).toBe(1)
  })
})
```

- [ ] **Step 2: テスト成功を確認**

```bash
bun test packages/runtime/test/workspace/local-worktree-provider.test.ts
```

期待: 6 tests passed (前回 3 + 今回 3)。

- [ ] **Step 3: Commit**

```bash
git add packages/runtime/test/workspace/local-worktree-provider.test.ts
git commit -m "test(runtime): cover LocalWorktreeProvider.destroy and list"
```

---

## Task 12: `.legion.yaml` ローダ

**Files:**
- Create: `packages/runtime/src/config/loader.ts`
- Create: `packages/runtime/test/config/loader.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLegionConfig } from '@legion/runtime/config/loader'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'legion-cfg-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadLegionConfig', () => {
  test('returns empty config when .legion.yaml is absent', async () => {
    const cfg = await loadLegionConfig(dir)
    expect(cfg).toEqual({})
  })

  test('parses worktree.setup and worktree.copyFiles arrays', async () => {
    await writeFile(
      join(dir, '.legion.yaml'),
      'worktree:\n  setup:\n    - bun install\n  copyFiles:\n    - .env.local\n',
    )
    const cfg = await loadLegionConfig(dir)
    expect(cfg.worktree?.setup).toEqual(['bun install'])
    expect(cfg.worktree?.copyFiles).toEqual(['.env.local'])
  })

  test('throws on malformed yaml', async () => {
    await writeFile(join(dir, '.legion.yaml'), 'worktree:\n  setup: not-an-array\n')
    await expect(loadLegionConfig(dir)).rejects.toThrow(/setup/)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/config/loader.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/config/loader.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { LegionConfig } from '@legion/core'

export async function loadLegionConfig(repoPath: string): Promise<LegionConfig> {
  const path = join(repoPath, '.legion.yaml')
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  const parsed = parseYaml(raw) as unknown
  return validate(parsed)
}

function validate(parsed: unknown): LegionConfig {
  if (parsed == null) return {}
  if (typeof parsed !== 'object') {
    throw new Error('.legion.yaml: top-level must be an object')
  }
  const cfg = parsed as Record<string, unknown>
  const out: LegionConfig = {}
  if (cfg.worktree !== undefined) {
    if (typeof cfg.worktree !== 'object' || cfg.worktree === null) {
      throw new Error('.legion.yaml: worktree must be an object')
    }
    const wt = cfg.worktree as Record<string, unknown>
    const setupArr = ensureStringArray(wt.setup, 'worktree.setup')
    const copyArr = ensureStringArray(wt.copyFiles, 'worktree.copyFiles')
    out.worktree = {}
    if (setupArr !== undefined) out.worktree.setup = setupArr
    if (copyArr !== undefined) out.worktree.copyFiles = copyArr
    if (wt.ports !== undefined) {
      if (typeof wt.ports !== 'object' || wt.ports === null) {
        throw new Error('.legion.yaml: worktree.ports must be an object (reserved)')
      }
      out.worktree.ports = wt.ports as Record<string, unknown>
    }
  }
  return out
}

function ensureStringArray(v: unknown, key: string): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error(`.legion.yaml: ${key} must be an array of strings`)
  }
  return v
}
```

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/config/loader.test.ts
```

期待: 3 tests passed。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/config/loader.ts packages/runtime/test/config/loader.test.ts
git commit -m "feat(runtime): add .legion.yaml loader per D-028"
```

---

## Task 13: Setup フック ランナー

`.legion.yaml` の `setup` / `copyFiles` を worktree 上で実行する層。

**Files:**
- Create: `packages/runtime/src/config/setup-runner.ts`
- Create: `packages/runtime/test/config/setup-runner.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorktreeSetup } from '@legion/runtime/config/setup-runner'

let mainRepo: string
let worktree: string

beforeEach(async () => {
  mainRepo = await mkdtemp(join(tmpdir(), 'legion-setup-main-'))
  worktree = await mkdtemp(join(tmpdir(), 'legion-setup-wt-'))
})

afterEach(async () => {
  await rm(mainRepo, { recursive: true, force: true })
  await rm(worktree, { recursive: true, force: true })
})

describe('runWorktreeSetup', () => {
  test('copies files listed in copyFiles from main repo to worktree', async () => {
    await writeFile(join(mainRepo, '.env.local'), 'KEY=value\n')
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: { worktree: { copyFiles: ['.env.local'] } },
    })
    const copied = await readFile(join(worktree, '.env.local'), 'utf-8')
    expect(copied).toBe('KEY=value\n')
  })

  test('runs each setup command in worktree cwd', async () => {
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: { worktree: { setup: ['echo hello > marker.txt'] } },
    })
    const marker = await readFile(join(worktree, 'marker.txt'), 'utf-8')
    expect(marker.trim()).toBe('hello')
  })

  test('throws when a setup command exits non-zero', async () => {
    await expect(
      runWorktreeSetup({
        mainRepoPath: mainRepo,
        worktreePath: worktree,
        config: { worktree: { setup: ['exit 1'] } },
      }),
    ).rejects.toThrow()
  })

  test('is a no-op when worktree section is empty', async () => {
    await runWorktreeSetup({
      mainRepoPath: mainRepo,
      worktreePath: worktree,
      config: {},
    })
    // No assertion needed — completing without error is the success criterion.
  })

  test('missing copyFiles source raises a clear error', async () => {
    await expect(
      runWorktreeSetup({
        mainRepoPath: mainRepo,
        worktreePath: worktree,
        config: { worktree: { copyFiles: ['.env.missing'] } },
      }),
    ).rejects.toThrow(/\.env\.missing/)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/config/setup-runner.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/config/setup-runner.ts`:

```ts
import { copyFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { $ } from 'bun'
import type { LegionConfig } from '@legion/core'

export interface RunWorktreeSetupInput {
  mainRepoPath: string
  worktreePath: string
  config: LegionConfig
}

export async function runWorktreeSetup(input: RunWorktreeSetupInput): Promise<void> {
  const wt = input.config.worktree
  if (!wt) return
  if (wt.copyFiles) {
    for (const rel of wt.copyFiles) {
      const src = join(input.mainRepoPath, rel)
      const dst = join(input.worktreePath, rel)
      try {
        await access(src)
      } catch {
        throw new Error(`copyFiles: source not found: ${rel}`)
      }
      await mkdir(dirname(dst), { recursive: true })
      await copyFile(src, dst)
    }
  }
  if (wt.setup) {
    for (const cmd of wt.setup) {
      // Use a shell for compatibility with arbitrary user-specified commands.
      const proc = await $`sh -c ${cmd}`.cwd(input.worktreePath).quiet().nothrow()
      if (proc.exitCode !== 0) {
        throw new Error(
          `setup command failed (exit ${proc.exitCode}): ${cmd}\nstderr: ${proc.stderr.toString()}`,
        )
      }
    }
  }
}
```

(Windows のテスト実行性向上のため、`sh -c` が無い環境を想定するなら `pwsh -Command` フォールバックを将来追加。Phase 1 では Bun の `sh` バンドル前提とする。)

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/config/setup-runner.test.ts
```

期待: 5 tests passed。Windows 環境では `sh -c` が無い場合があるので、不可ならスキップマークを追加し PR で別途対応 (本 task ではテストが通る前提とする)。

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/config/setup-runner.ts packages/runtime/test/config/setup-runner.test.ts
git commit -m "feat(runtime): add setup-runner for .legion.yaml hooks"
```

---

## Task 14: `packages/cli` パッケージのスキャフォールド

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/bin/legion.ts`

- [ ] **Step 1: package.json を作成**

`packages/cli/package.json`:

```json
{
  "name": "@legion/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "legion": "./bin/legion.ts"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@legion/core": "workspace:*",
    "@legion/runtime": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*", "bin/**/*"]
}
```

- [ ] **Step 3: エントリスタブを作成**

`packages/cli/src/index.ts`:

```ts
export const CLI_VERSION = '0.0.0'
```

`packages/cli/bin/legion.ts`:

```ts
#!/usr/bin/env bun
import { runCli } from '../src/index'

await runCli(process.argv.slice(2))
```

(`runCli` は次の Task で実装。本 step ではスタブとして index.ts を以下に書き換える:)

`packages/cli/src/index.ts` (改訂):

```ts
export const CLI_VERSION = '0.0.0'

export async function runCli(args: string[]): Promise<void> {
  const [cmd] = args
  if (cmd === '--version' || cmd === '-v') {
    console.log(CLI_VERSION)
    return
  }
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('legion <command>\n\nCommands:\n  cleanup     Remove worktrees and branches')
    return
  }
  if (cmd === 'cleanup') {
    throw new Error('cleanup: not yet implemented (Task 15)')
  }
  throw new Error(`Unknown command: ${cmd}`)
}
```

- [ ] **Step 4: 型チェック**

```bash
bun run typecheck
```

期待: pass。`bun install` が必要なら以下を実行:

```bash
bun install
```

- [ ] **Step 5: スタブ動作確認**

```bash
bun run packages/cli/bin/legion.ts --version
```

期待: `0.0.0` が出力される。

- [ ] **Step 6: Commit**

```bash
git add packages/cli/
git commit -m "feat(cli): scaffold legion CLI package"
```

---

## Task 15: `legion cleanup` の実装

D-031: retain がデフォルト、明示削除コマンド。安全装置: branch がマージ済み or commit 0 件のものだけ無確認削除可、それ以外は警告して確認。

**Files:**
- Create: `packages/runtime/src/cleanup/cleanup.ts`
- Create: `packages/runtime/test/cleanup/cleanup.test.ts`
- Create: `packages/cli/src/commands/cleanup.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeTempRepo, type TempRepo } from '../helpers/temp-repo'
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { resolveCommitSha, worktreeList } from '@legion/runtime/workspace/git'
import { classifyForCleanup, runCleanup } from '@legion/runtime/cleanup/cleanup'

let repo: TempRepo
let baseDir: string

beforeEach(async () => {
  repo = await makeTempRepo()
  baseDir = await mkdtemp(join(tmpdir(), 'legion-cln-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
  await repo.cleanup()
})

describe('classifyForCleanup', () => {
  test('a detached worktree is safe to remove (no branch involvement)', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-rev',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('safe')
  })

  test('a branched worktree with no commits ahead is safe', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('safe')
  })

  test('a branched worktree with unmerged commits requires confirmation', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    const desc = await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'inst-impl',
      role: 'implementer',
      seq: 1,
      baseCommitSha: sha,
    })
    // Create an unmerged commit on the worktree branch
    const { $ } = await import('bun')
    await $`git config user.email t@t.local && git config user.name t`.cwd(desc.path).quiet()
    await Bun.write(join(desc.path, 'change.txt'), 'modified\n')
    await $`git add change.txt && git commit -m work`.cwd(desc.path).quiet()
    const c = await classifyForCleanup(repo.path, desc)
    expect(c.kind).toBe('confirm-required')
    expect(c.reason).toMatch(/unmerged|commits/i)
  })
})

describe('runCleanup', () => {
  test('removes safe worktrees and skips confirm-required ones in dry mode', async () => {
    const provider = new LocalWorktreeProvider({ repoPath: repo.path, baseDir })
    const sha = await resolveCommitSha(repo.path, 'HEAD')
    await provider.create({
      workflowInstanceId: '01j9x5z8yk0000000000000000',
      agentInstanceId: 'safe',
      role: 'reviewer',
      seq: 1,
      baseCommitSha: sha,
    })
    const result = await runCleanup({
      provider,
      repoPath: repo.path,
      mode: 'safe-only',
    })
    expect(result.removed.length).toBe(1)
    expect(result.skipped.length).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認**

```bash
bun test packages/runtime/test/cleanup/cleanup.test.ts
```

- [ ] **Step 3: 実装**

`packages/runtime/src/cleanup/cleanup.ts`:

```ts
import { $ } from 'bun'
import type { WorkspaceProvider, WorkspaceDescriptor } from '../workspace/provider'
import { branchDelete, branchExists } from '../workspace/git'

export type Classification =
  | { kind: 'safe' }
  | { kind: 'confirm-required'; reason: string }

export async function classifyForCleanup(
  repoCwd: string,
  desc: WorkspaceDescriptor,
): Promise<Classification> {
  const branch = (desc.ref as { branch?: string }).branch
  if (!branch) return { kind: 'safe' }
  if (!(await branchExists(repoCwd, branch))) return { kind: 'safe' }
  const ahead = await $`git rev-list --count main..${branch}`
    .cwd(repoCwd)
    .quiet()
    .nothrow()
    .text()
  const aheadCount = parseInt(ahead.trim() || '0', 10)
  if (aheadCount === 0) return { kind: 'safe' }
  return {
    kind: 'confirm-required',
    reason: `branch ${branch} has ${aheadCount} unmerged commits`,
  }
}

export interface RunCleanupInput {
  provider: WorkspaceProvider
  repoPath: string
  /**
   * - 'safe-only': remove only safe ones, skip confirm-required (silent).
   * - 'confirm-each': caller-supplied confirmation callback per confirm-required entry.
   */
  mode: 'safe-only' | 'confirm-each'
  workflowInstanceId?: string
  onConfirm?: (desc: WorkspaceDescriptor, reason: string) => Promise<boolean>
}

export interface RunCleanupResult {
  removed: WorkspaceDescriptor[]
  skipped: { desc: WorkspaceDescriptor; reason: string }[]
}

export async function runCleanup(input: RunCleanupInput): Promise<RunCleanupResult> {
  const list = await input.provider.list(input.workflowInstanceId)
  const removed: WorkspaceDescriptor[] = []
  const skipped: { desc: WorkspaceDescriptor; reason: string }[] = []
  for (const desc of list) {
    const c = await classifyForCleanup(input.repoPath, desc)
    if (c.kind === 'safe') {
      await input.provider.destroy(desc)
      const branch = (desc.ref as { branch?: string }).branch
      if (branch && (await branchExists(input.repoPath, branch))) {
        await branchDelete(input.repoPath, branch)
      }
      removed.push(desc)
      continue
    }
    if (input.mode === 'safe-only') {
      skipped.push({ desc, reason: c.reason })
      continue
    }
    const ok = input.onConfirm ? await input.onConfirm(desc, c.reason) : false
    if (!ok) {
      skipped.push({ desc, reason: c.reason })
      continue
    }
    await input.provider.destroy(desc)
    const branch = (desc.ref as { branch?: string }).branch
    if (branch && (await branchExists(input.repoPath, branch))) {
      await branchDelete(input.repoPath, branch)
    }
    removed.push(desc)
  }
  return { removed, skipped }
}
```

(ファイル長: ~80 行、CLAUDE.md 制約内。)

- [ ] **Step 4: テスト成功を確認**

```bash
bun test packages/runtime/test/cleanup/cleanup.test.ts
```

期待: 4 tests passed。

- [ ] **Step 5: CLI コマンドを実装**

`packages/cli/src/commands/cleanup.ts`:

```ts
import { LocalWorktreeProvider } from '@legion/runtime/workspace/local-worktree-provider'
import { runCleanup } from '@legion/runtime/cleanup/cleanup'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface CleanupArgs {
  repoPath: string
  workflowInstanceId?: string
  yes?: boolean
}

export async function cleanupCommand(args: CleanupArgs): Promise<void> {
  const baseDir = process.env['LEGION_WT_BASE'] ?? join(homedir(), '.legion', 'worktrees')
  const provider = new LocalWorktreeProvider({ repoPath: args.repoPath, baseDir })
  const result = await runCleanup({
    provider,
    repoPath: args.repoPath,
    mode: args.yes ? 'confirm-each' : 'safe-only',
    workflowInstanceId: args.workflowInstanceId,
    onConfirm: args.yes ? async () => true : undefined,
  })
  console.log(`removed: ${result.removed.length}`)
  for (const r of result.removed) console.log(`  - ${r.path}`)
  if (result.skipped.length > 0) {
    console.log(`skipped (unmerged): ${result.skipped.length}`)
    for (const s of result.skipped) console.log(`  - ${s.desc.path}: ${s.reason}`)
    console.log('Run with --yes to force-remove unmerged branches.')
  }
}
```

- [ ] **Step 6: CLI エントリ更新**

`packages/cli/src/index.ts`:

```ts
import { cleanupCommand } from './commands/cleanup'

export const CLI_VERSION = '0.0.0'

export async function runCli(args: string[]): Promise<void> {
  const [cmd, ...rest] = args
  if (cmd === '--version' || cmd === '-v') {
    console.log(CLI_VERSION)
    return
  }
  if (cmd === undefined || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log('legion <command>\n\nCommands:\n  cleanup [--yes] [--workflow <id>]   Remove worktrees and branches')
    return
  }
  if (cmd === 'cleanup') {
    const yes = rest.includes('--yes')
    const wfFlagIdx = rest.indexOf('--workflow')
    const workflowInstanceId = wfFlagIdx >= 0 ? rest[wfFlagIdx + 1] : undefined
    await cleanupCommand({
      repoPath: process.cwd(),
      workflowInstanceId,
      yes,
    })
    return
  }
  throw new Error(`Unknown command: ${cmd}`)
}
```

- [ ] **Step 7: 型チェック**

```bash
bun run typecheck
```

期待: pass。

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/cleanup/ packages/runtime/test/cleanup/ packages/cli/src/
git commit -m "feat: implement legion cleanup command per D-031"
```

---

## Task 16: ルート `package.json` の `test` script を整備

**Files:**
- Modify: `package.json`
- Modify: `packages/runtime/package.json`
- Modify: `packages/core/package.json`

- [ ] **Step 1: 各パッケージに test script を追加**

`packages/runtime/package.json` の scripts セクションに追加:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

`packages/core/package.json` の scripts セクションに追加:

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "bun test"
}
```

ルート `package.json` の scripts を更新:

```json
"scripts": {
  "typecheck": "bun run --filter='*' typecheck",
  "test": "bun run --filter='*' test"
}
```

- [ ] **Step 2: 全テスト実行**

```bash
bun run test
```

期待: 全 task のテストがパス。

- [ ] **Step 3: Commit**

```bash
git add package.json packages/runtime/package.json packages/core/package.json
git commit -m "chore: wire up bun test across workspaces"
```

---

## 完了条件

- [ ] 全 task のテストがパス (合計 30 弱の test cases)
- [ ] `bun run typecheck` がパス
- [ ] `bun run packages/cli/bin/legion.ts --help` が cleanup コマンドの help を表示
- [ ] 一時 repo で worktree create → destroy → cleanup が手動で動く

## 次の計画

a01 完了後、[a02 Claude Code adapter](2026-05-13_phase1_a02_adapter.md) に進む。a02 は a01 の `LocalWorktreeProvider` に依存する (agent に渡す cwd を取得するため)。

---

## 実測との突合 (実装完了後に記入)

実装フェーズ終了時、各ファイルの実測行数を取得し本計画の予測値と比較する。

実測コマンド例:

```bash
wc -l packages/core/src/types/workspace.ts \
     packages/core/src/types/config.ts \
     packages/runtime/src/workspace/*.ts \
     packages/runtime/src/config/*.ts \
     packages/runtime/src/cleanup/*.ts \
     packages/cli/src/**/*.ts
```

突合表 (実装着手者が埋める):

| ファイル | 予測 | 実測 | 差 (±%) | 上限超過? |
| --- | ---: | ---: | ---: | --- |
| (実装後に記入) | | | | |

差が ±30% を超えた項目について短い原因コメントを残す (見落とした case、抽象化漏れ、想定外の boilerplate 等)。
