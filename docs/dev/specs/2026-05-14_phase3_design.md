# Phase 3 設計仕様書

**作成日:** 2026-05-14
**ステータス:** 実装着手用ドラフト
**ブレスト原本:** 本仕様確定後に [../minutes/2026-05-14_phase3_brainstorming.md](../minutes/2026-05-14_phase3_brainstorming.md) として議事録を切り出す。主要決定は本書 §2〜§8 で D-046〜D-054 として記録済み。
**前提決定:** [../specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md)（Phase 2 narrow scope 設計）と D-001〜D-045

本書は Phase 3（Reviewer + Blackboard + Codex provider + workspace `--detach <branch>` 拡張）の設計を、実装着手者がそのまま読める形に凝縮したものです。Phase 3 のコードを書く前に読んでください。

## 1. 目的と完了定義

**Phase 3 の成果物:** Director→Implementer 委任に Reviewer を追加し、Implementer が自分の作業を Reviewer に投げ、approve まで retry できるフローを、Claude (Director/Implementer) + Codex (Reviewer) の異種 provider 混在で動かす。並行して Blackboard を導入し、agent 間の通信履歴とユーザー定義 publish イベントを永続化する。

具体的には:

- Director（Claude, per-workflow）がユーザープロンプトを受け取り、`delegate(role='implementer', prompt=...)` を 1 回呼ぶ。
- Implementer（Claude, per-task）がワークツリー内で編集・コミットしたあと、`delegate(role='reviewer', prompt=...)` を **自分で** 呼ぶ。
- legion runtime は Implementer の現在の branch を解決し、Reviewer 用ワークツリーを **`--detach <implementer の branch>`** で切る。
- Reviewer は Codex provider 上で起動し、read-only に diff を読み、`outputSchema` で構造化された `{decision, feedback}` を返す。
- Implementer は decision を読み、`approve` ならセッション終了、`request-changes` なら追加コミット → 再 `delegate(role='reviewer', ...)`、`reject` なら失敗サマリで終了。retry は prompt の soft cap で最大 3 回。
- legion runtime は delegate の start/result/decision を Blackboard に auto-publish。agent も `publish(topic, payload)` ツールで Blackboard に書ける。
- UI は Phase 2 narrow の 4 領域 (Canvas / Events / Overview / Diff) に **Blackboard タブ** を加え、Reviewer の参加と decision、retry の様子が見える。

Phase 3 では `subscribes` / `synthesizes` エッジの runtime、D-014 reactor / Inbox の本実装、Workflow Editor の編集機能、複数 Implementer 並列、Codex で Director/Implementer を駆動する用途は対象外（§13 参照）。

## 2. スコープと前提

### 2.1 D-046: Phase 3 scope

元 Phase 2 ロードマップで Phase 3 に defer された項目群（Reviewer + Blackboard + Codex provider + Workflow Editor 編集機能）のうち、Phase 3 で着手するのは以下:

- **含める**: Reviewer エージェント、retry loop、Blackboard runtime（auto-publish + agent publish ツール）、Codex provider、`worktreeAdd --detach <branch>` 拡張、新 Phase 3 workflow テンプレート
- **含めない**: agent subscribe semantics（`subscribes` / `synthesizes` エッジの runtime 実体化）、D-014 reactor / Inbox の本実装、Workflow Editor 編集機能、複数 Implementer 並列、Codex を Director / Implementer に使う構成

理由: Phase 2 と同じく、垂直スライスを 1 本通してから残りを足す。Director→Implementer→Reviewer の 3 エージェント協調が動くことを E2E で確認した上で、subscribe / reactor / 並列 を Phase 4 で重ねる方が手戻りが少ない。

### 2.2 D-047: retry loop アーキテクチャ = B2 (Implementer 主導の自己 delegate)

Reviewer の retry loop の実現方式として、次の 3 案を比較した:

- A: Implementer は 1 commit で終了。Director がループを回し、各 iteration は fresh Implementer。
- B1: Implementer は approve まで生存。Director が Reviewer を spawn し、結果を Implementer の Inbox に push して継続。
- **B2 (採用)**: Implementer は approve まで生存。Implementer 自身に `delegate(role='reviewer')` ツールを与え、自己 delegate で Reviewer を spawn、tool_result で decision を受け取る。

選定理由:

- B1 は D-014 reactor / Inbox の本実装を Phase 3 で前倒しすることになり、Phase 2 spec §13 で「Phase 3+」と defer したばかりの抽象を持ち込むコストが大きい。
- A は iteration ごとに LLM context がリセットされるため、Reviewer の feedback を再 prompt で catch-up させる必要があり、prompt が肥大化しやすい。
- B2 は Phase 2 の delegate-as-tool 機構をそのまま流用でき、追加抽象が小さい。LLM context が iteration を跨いで保持されるので、Reviewer feedback への対応も自然。`reviews` エッジを D-015 の edge type semantics として明示できる。

Implementer が orchestration の知識（"Reviewer に投げる"）を持つ代償はあるが、Phase 3 では許容する。完全に "Implementer は実装、Reviewer は判断" と分けたいケースが将来出てきたら、Director 主導の B1 経路を Phase 4+ で追加できる（D-014 reactor と一緒に）。

### 2.3 D-048: Reviewer の結果返し経路 = delegate-as-tool + Blackboard 履歴の併用

Reviewer の `{decision, feedback}` は次の 2 経路で同時に流す:

- **同期返し**: Phase 2 の delegate-as-tool パターンに従い、Reviewer 完了時に DelegateToolHandler が tool_result として Implementer に返す。Implementer の retry loop はこの値で駆動。
- **Blackboard 履歴**: 同じ内容を `system.review.decision` topic として Blackboard に auto-publish。UI / 将来の subscriber が観測可能。

選定理由:

- B2 の同期返し単独だと「Reviewer の決定が UI に live で見えない」状況になりやすい。同じデータを Blackboard にも書くことで observability を確保。
- Phase 4 で agent subscribe を入れたとき、`system.review.decision` を購読する agent が自然に書ける素地ができる。
- 2 経路に書く実装コストは DelegateToolHandler 内に publish 1 行を足すだけ。

### 2.4 D-049: Blackboard 中間スコープ

Blackboard の機能範囲を 3 段階で検討した:

- A: 最小（runtime auto-publish + UI subscribe のみ、agent 側に API なし）
- **B (採用)**: 中間（auto-publish + agent の `publish(topic, payload)` ツール + UI subscribe）
- C: フル（auto-publish + agent publish + agent subscribe = D-014 reactor 込み）

B を採用する理由:

- B2 アーキを選んだ時点で agent subscribe (= reactor / Inbox) を Phase 3 から外している。C はそれと矛盾。
- A だと `publishes` エッジ (D-015) の runtime 実体化が無くなり、エッジ semantics の検証が Phase 4 まで遅れる。B なら `publishes` を Phase 3 で半分動かせる（agent が publish できる、subscribe は未実装）。

### 2.5 D-050: Reviewer 役割の範囲 = retry loop までフル

Reviewer の振る舞いとして 3 段階を検討:

- A: Pure code reviewer（issue/suggestion を markdown で返すのみ）
- B: Approve/reject gate（structured decision を返す）
- **C (採用)**: Reviewer + retry loop（request-changes 時に Implementer が修正・再 review）

選定理由:

- A は decision が unstructured で Implementer 側の判断ロジックが肥大化する。
- B は decision を返すが loop semantics が無いので、Implementer は 1 回受けて終了。「approve まで通す」価値が小さい。
- C は実装コストが B より小さい（loop は Implementer の prompt と既存 delegate-as-tool で完結）。ユーザー価値（"レビューを通してマージ可能な状態にする"）が高い。

retry 上限は **prompt soft cap で 3 回**。runtime hard cap は Phase 3 では入れない（YAGNI; LLM 暴走時の hard cap は Phase 3.5 候補）。

### 2.6 D-051: Codex provider スコープ = `@openai/codex-sdk` 経由の最小実装

事前調査の結果、OpenAI Codex には `@openai/codex-sdk` という公式 TypeScript SDK が存在することが確認できた（subprocess 想定は早合点だった）。詳細は [[reference_codex_sdk_integration]] および本書 §5。

採用方針:

- **subprocess 手書きではなく `@openai/codex-sdk` を採用**。Phase 2 の Claude Agent SDK と完全対称の in-process library パターン。
- 利用範囲は **Reviewer のみ**。Director / Implementer は Claude のまま。canUseTool / custom tools が必要な役割に Codex は使わない（Codex SDK にこれらが無いため）。
- 認証は ChatGPT サブスク OAuth (`~/.codex/auth.json`) を default。`OPENAI_API_KEY` / `CODEX_API_KEY` は legion 側からセットしない（[issue #3286](https://github.com/openai/codex/issues/3286) の OAuth override 問題が Claude の `ANTHROPIC_API_KEY` 罠と同型）。
- Reviewer の構造化出力は SDK の `outputSchema` を活用。JSON code block 正規表現パースは採用しない。

## 3. アーキテクチャ全体図

```text
[User] POST /api/workflows/trigger {templateId, userPrompt}
  │
  ▼
[legion server]
  │  graph walk: trigger→director エッジ (Phase 2 既存)
  │  Director session spawn (Claude provider, per-workflow)
  │  agent_instances row for Director
  ▼
[Director (Claude)]
  │  allowedTools: Read/Glob/Grep + mcp__legion__delegate (role='implementer') + mcp__legion__publish
  │  delegate('implementer', prompt=...)
  ▼
[DelegateToolHandler (Phase 2 既存, +Phase 3 拡張)]
  │  worktree -b legion/<wf>/impl-1 from baseCommitSha
  │  spawn Implementer (Claude)
  │  Blackboard auto-publish: system.delegate.start                        ★ Phase 3 新規
  ▼
[Implementer (Claude)]                                                     ★ Phase 3 で長寿命化 (B2)
  │  allowedTools: EDIT_TOOLS + Bash(git*) + mcp__legion__delegate (role='reviewer') + mcp__legion__publish
  │  実装 → git add -A && git commit
  │  ─ 自己 delegate ─
  │  delegate('reviewer', prompt='Review my changes...', rationale='...')
  ▼
[DelegateToolHandler]                                                      ★ reviews エッジ判定 + reviewTargetBranch 自動解決
  │  caller (Implementer) の branch_name を agent_instances から引く
  │  worktree --detach <reviewTargetBranch>                                ★ Concern #3 解消
  │  spawn Reviewer with CodexSdkProvider                                  ★ Phase 3 新規
  │  Blackboard auto-publish: system.delegate.start
  ▼
[Reviewer (Codex)]                                                         ★ 新 provider
  │  sandboxMode: 'read-only', approvalPolicy: 'never'
  │  outputSchema: { decision, feedback, notes }                           ★ 構造化出力
  │  diff を読み、judgement
  ▲
  │  ThreadEvent → AgentEvent 変換、最終 message は schema-conformant JSON
[DelegateToolHandler (resumed)]
  │  agent_instances UPDATE (ended_at)
  │  Blackboard auto-publish: system.delegate.result + system.review.decision
  │  return tool_result: { decision, feedback, branchName, summary, ... }
  ▲
  │  tool_result
[Implementer (resumed)]
  │  decision='approve'         → wrap-up & end session
  │  decision='request-changes' → 修正 commit → 再 delegate('reviewer', ...)  (soft cap 3 回)
  │  decision='reject'          → 失敗サマリで end session
  ▲
  │  tool_result (Director→Implementer delegate)
[Director (resumed)]
  │  user 向け wrap-up
  ▼
[legion server] WorkflowInstance.status = 'completed'
```

★ で示した部分が Phase 2 narrow からの新規 / 変更コンポーネント。

## 4. データモデル

### 4.1 D-052: `AgentInstance` / `agent_instances` テーブルはスキーマ変更なし

Phase 2 で導入した `parent_agent_instance_id` がそのまま Reviewer に効く。

- Phase 2 narrow の parent chain: Director ──parent── Implementer
- Phase 3 の parent chain: Director ──parent── Implementer ──parent── Reviewer (B2 アーキ)

Implementer の retry loop で Reviewer が複数回呼ばれた場合、**Reviewer-1, Reviewer-2 はいずれも parent = 同じ Implementer** で agent_instances に行が増える（seq 番号で識別）。Implementer 自体は 1 行のまま（B2: 同一 session 継続）。

### 4.2 `DelegateToolOutput` の拡張

Phase 2 の型に Reviewer 用フィールドを追加（`packages/core/src/types/delegate.ts`）:

```ts
export interface DelegateToolOutput {
  agentInstanceId: string
  branchName: string                                       // Reviewer の場合: review 対象 branch (= caller の branch)
  status: 'completed' | 'failed'
  decision?: 'approve' | 'request-changes' | 'reject'      // ★ Reviewer のみセット
  feedback?: string                                         // ★ decision='request-changes' のときの修正指示
  summary: string
  error?: string
}
```

decision/feedback は Reviewer 限定。Implementer の delegate からの戻り（Phase 2 既存経路）には現れない。

### 4.3 `blackboard_messages` テーブル（新規）

`packages/runtime/src/store/blackboard-store.ts`（新規）に切る:

```sql
CREATE TABLE blackboard_messages (
  id                   TEXT PRIMARY KEY,          -- ULID
  workflow_instance_id TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  topic                TEXT NOT NULL,
  publisher_agent_id   TEXT REFERENCES agent_instances(id),   -- NULL = runtime auto-publish
  payload              TEXT NOT NULL,             -- JSON-stringified
  published_at         INTEGER NOT NULL
);

CREATE INDEX idx_blackboard_workflow ON blackboard_messages(workflow_instance_id);
CREATE INDEX idx_blackboard_topic    ON blackboard_messages(workflow_instance_id, topic);
```

`workflow_instances` の `ON DELETE CASCADE` で workflow 削除時に自動消去。Phase 3 では history retention 設定はなし（YAGNI）。

Topic 命名規約:

| Topic | Publisher | 内容 |
| --- | --- | --- |
| `system.delegate.start` | runtime (auto) | delegate call の開始時 |
| `system.delegate.result` | runtime (auto) | delegate call の完了時 |
| `system.review.decision` | runtime (auto) | Reviewer 完了時、decision を抜粋 |
| `<user-defined>` | agent (publish ツール) | 任意 |

### 4.4 Store API

```ts
class BlackboardStore {
  insert(row: BlackboardRow): void
  listByWorkflow(workflowInstanceId: string, opts?: { topic?: string; afterSeq?: number; limit?: number }): BlackboardRow[]
  byId(id: string): BlackboardRow | undefined
}
```

予測行数: store 本体 ~120 行、テスト ~140 行。

### 4.5 `WorkspaceCreateInput` 拡張（Concern #3 解消）

Phase 2 の `LocalWorktreeProvider.create()` は `DETACHED_ROLES = new Set(['director', 'reviewer'])` に対して常に `baseCommitSha` で `--detach` する設計だった ([local-worktree-provider.ts:20-34](packages/runtime/src/workspace/local-worktree-provider.ts#L20-L34))。Phase 3 では Reviewer が **Implementer の branch tip** に detach する必要があるため、`reviewTargetBranch?` を追加:

```ts
interface WorkspaceCreateInput {
  workflowInstanceId: string
  agentInstanceId: string
  role: string
  seq: number
  baseCommitSha: string
  reviewTargetBranch?: string  // ★ 新規: role=reviewer 時に detach 対象として優先
}
```

`LocalWorktreeProvider.create()` の Reviewer 分岐:

```ts
if (DETACHED_ROLES.has(input.role)) {
  const target = input.reviewTargetBranch ?? input.baseCommitSha
  await worktreeAdd(this.opts.repoPath, { path, commit: target, detach: true })
  return { ref: { kind: 'owned', path }, path }
}
```

[git.ts](packages/runtime/src/workspace/git.ts) 自体は変更不要（`commit: <branch-ref>` + `detach: true` を既に受理する）。差分は LocalWorktreeProvider 内で ~5 行。

### 4.6 reviewTargetBranch の自動解決

Implementer が `delegate('reviewer', prompt=..., rationale=...)` を呼んだとき、Implementer は **自分の branch 名を知らなくてよい**。DelegateToolHandler が:

1. caller の agent_instance を `bySessionId` で引く（Implementer の row）
2. `branch_name` 列を取り出す
3. それを `reviewTargetBranch` として `WorkspaceCreateInput` に渡す

これで Implementer の prompt はシンプル: 「commit したら `delegate('reviewer', prompt='Please review my changes against the original task')` を呼べ」だけ。

### 4.7 Core types の場所

| 型 | ファイル |
| --- | --- |
| `DelegateToolOutput.decision`, `feedback` 拡張 | `packages/core/src/types/delegate.ts` |
| `BlackboardMessage` | `packages/core/src/types/blackboard.ts`（新規, ~30 行） |
| `WorkspaceCreateInput.reviewTargetBranch` | 既存 `packages/runtime/src/workspace/provider.ts` |
| `LaunchRequest.outputSchema` | `packages/core/src/types/agent-provider.ts` |
| `WorkflowTemplate` の `reviews` edge type 追加 | 既存 `packages/core/src/types/workflow.ts`（1 行 union 拡張） |

## 5. Codex provider — `@openai/codex-sdk` ベース

### 5.1 採用方針

- Phase 2 の Claude provider が `@anthropic-ai/claude-agent-sdk` を in-process library として使ったのと完全に対称的なパターン。
- Codex SDK の中身も CLI subprocess を spawn する形だが、JSONL のパースは SDK が肩代わりするので legion 側からは pure API として扱える。
- 認証は ChatGPT サブスク OAuth（`~/.codex/auth.json`）を default。`OPENAI_API_KEY` / `CODEX_API_KEY` は legion 側からは渡さない（[issue #3286](https://github.com/openai/codex/issues/3286)）。
- Phase 3 の唯一の用途は Reviewer。

### 5.2 ファイル配置

```
packages/runtime/src/adapter/
  ├── provider.ts                    (Phase 2: ClaudeCodeAgentSDKProvider)
  ├── provider/launch.ts             (Phase 2 既存)
  ├── provider/stream.ts             (Phase 2 既存)
  ├── codex/
  │     ├── codex-provider.ts        ★ 新規 ~100 行 (CodexSdkProvider クラス)
  │     ├── codex-launch.ts          ★ 新規 ~50 行 (Thread 起動)
  │     └── codex-stream.ts          ★ 新規 ~80 行 (ThreadEvent → AgentEvent 変換)
```

### 5.3 `CodexSdkProvider` API surface

```ts
import { Codex, type Thread, type ThreadEvent } from '@openai/codex-sdk'
import type { AgentProvider, LaunchRequest, SessionHandle, AgentEvent, AgentCapabilities } from '@legion/core'

export interface CodexSdkProviderOptions {
  /** Inject the Codex factory. In tests, pass a mock factory. */
  codexFactory?: (opts?: ConstructorParameters<typeof Codex>[0]) => Codex
}

export class CodexSdkProvider implements AgentProvider {
  id = 'codex'
  displayName = 'OpenAI Codex (codex-sdk)'
  capabilities: AgentCapabilities = {
    supportsCheckpoint: false,
    supportsResume: false,
    supportsAttach: false,
    supportsApprovalFlow: false,   // Claude との最大の差
  }

  private codex: Codex
  private store = new CodexSessionStore()

  constructor(opts: CodexSdkProviderOptions = {}) {
    const factory = opts.codexFactory ?? ((o) => new Codex(o))
    this.codex = factory()                    // ChatGPT OAuth (~/.codex/auth.json) を期待
  }

  async launch(req: LaunchRequest): Promise<SessionHandle> {
    const sessionId = ulid()
    const thread = this.codex.startThread({
      workingDirectory: req.workdir,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      ...(req.model !== undefined ? { model: req.model } : {}),
    })
    this.store.set({ sessionId, thread, prompt: req.initialPrompt, outputSchema: req.outputSchema, role: req.role })
    return { sessionId }
  }

  stream(sessionId: string): AsyncIterable<AgentEvent> {
    return streamCodexSession(this.store, sessionId)
  }

  // approve/deny は no-op (approvalPolicy=never)、send/resume は throw
  // detect, authenticate, status, checkpoint, shutdown, exportTranscript は Phase 2 と同じパターン
}
```

### 5.4 `LaunchRequest` の拡張

```ts
interface LaunchRequest {
  // ... 既存 (workdir, role, initialPrompt, model?, env?, mcpServers?)
  outputSchema?: unknown   // ★ Phase 3 新規: JSON Schema (Reviewer の構造化出力用)
}
```

Codex provider は `outputSchema` 指定時に `thread.runStreamed(prompt, { outputSchema })` に転送する。Claude provider は Phase 3 では `outputSchema` を ignore（Phase 4 で対応検討）。

### 5.5 outputSchema による Reviewer decision 抽出

```ts
const reviewSchema = {
  type: 'object',
  properties: {
    decision:  { type: 'string', enum: ['approve', 'request-changes', 'reject'] },
    feedback:  { type: 'string' },
    notes:     { type: 'string' },
  },
  required: ['decision'],
} as const

// DelegateToolHandler が role='reviewer' で delegate するときに LaunchRequest.outputSchema にセット
```

stream の最後の `assistant_message` は schema-conformant JSON 文字列なので、`JSON.parse()` で `{decision, feedback, notes}` を取得して `DelegateToolOutput` にセット。

### 5.6 ThreadEvent → AgentEvent 変換 (`codex-stream.ts`)

| Codex SDK ThreadEvent | legion AgentEvent |
| --- | --- |
| `thread.started` / `turn.started` / `item.started` (Reasoning) | drop |
| `item.completed` (AgentMessageItem) | `assistant_message` { content } |
| `item.completed` (CommandExecutionItem) | `tool_use` { tool: 'shell', input } |
| `item.completed` (McpToolCallItem) | `tool_use` { tool, input } |
| `turn.completed` | `session_end` { status: 'completed', usage } |
| `turn.failed` / `error` | `session_end` { status: 'failed', error } |

Reviewer は read-only なので CommandExecutionItem / FileChangeItem は通常出ない。

### 5.7 capabilities チェックと boot 時 assertion

DelegateToolHandler が role='reviewer' で delegate するとき:

1. workflow template の reviewer ノードから `provider` 名を読む（`codex` を期待）
2. server の `providers: Map<string, AgentProvider>` から CodexSdkProvider を取得
3. capability check: `supportsApprovalFlow=false` で OK
4. Codex を Director / Implementer に使う構成は `template-validate` で拒否（§7 参照）

`startApp` 起動時に Codex provider が登録されている場合、`~/.codex/auth.json` または `CODEX_API_KEY` の存在を assert。なければ warning を出す（session 6 で出た「boot 時 token assert」アイデアと統合）。

## 6. delegate tool / role profile / prompts

### 6.1 D-053: `DelegateToolHandler` の Phase 3 拡張点

`packages/runtime/src/orchestrator/delegate-tool.ts`（Phase 2 ~140 行）に追加する処理:

1. **role='reviewer' 呼び出しの判定**: caller の agent_instance を `bySessionId` で引き、graph-walker の `resolveDelegateTargets` で `edgeType` を確定。
2. **reviewTargetBranch 自動解決**: edgeType='reviews' のとき caller の `branch_name` を取り出して `WorkspaceCreateInput.reviewTargetBranch` に渡す。
3. **provider 動的選択**: workflow template の target ノードの `provider` フィールドに応じて `ctx.providers` から選ぶ。
4. **outputSchema 注入**: role='reviewer' のとき `LaunchRequest.outputSchema` に reviewSchema をセット。
5. **decision 抽出**: Reviewer の最終 assistant_message を JSON.parse して `DelegateToolOutput.decision/feedback/notes` を埋める。パース失敗時は `decision=undefined`, summary に raw text を残し、status='completed' のまま Implementer に渡す（degrade gracefully）。
6. **Blackboard auto-publish**: delegate 開始時に `system.delegate.start`、完了時に `system.delegate.result`、role='reviewer' のとき追加で `system.review.decision`。

Phase 2 の 140 行に +60 行で総計 ~200 行。

### 6.2 graph walker の拡張

`resolveDelegateTargets` の戻り値に `edgeType` を追加:

```ts
export function resolveDelegateTargets(
  template: WorkflowTemplate,
  fromRoleNodeId: string,
): { roleNodeId: string; roleName: string; edgeType: 'delegates' | 'reviews' }[]
```

DelegateToolHandler は `edgeType='reviews'` を `--detach` worktree のトリガとして使う。

### 6.3 role-profile.ts の拡張

```ts
// packages/runtime/src/adapter/role-profile.ts
const PROFILES: Record<string, readonly string[]> = {
  director: [...READ_TOOLS, 'mcp__legion__delegate', 'mcp__legion__publish'],
  implementer: [
    ...EDIT_TOOLS,
    ...IMPLEMENTER_BASH_WHITELIST,
    'Bash(git add*)', 'Bash(git commit*)', 'Bash(git status*)', 'Bash(git diff*)',
    'mcp__legion__delegate',     // ★ 新: 自己 delegate (role='reviewer' のみ runtime で制限)
    'mcp__legion__publish',      // ★ 新
  ],
  reviewer: [
    ...READ_TOOLS,
    'mcp__legion__publish',      // Reviewer も publish 可能
  ],
}
```

`mcp__legion__delegate` の role 制限は **runtime 側** で行う。`DelegateToolHandler` が template の delegates/reviews エッジを `resolveDelegateTargets` で引き、許可された role 以外を弾く。

### 6.4 prompt の更新（`role-prompts.ts`）

- **DIRECTOR_PROMPT**: Phase 2 と同じ、変更なし。
- **IMPLEMENTER_PROMPT**: Phase 2 から拡張。"After you commit, call `delegate(role='reviewer', ...)` to get reviewed. Loop on request-changes up to 3 times." を追加（~+20 行）。
- **REVIEWER_PROMPT**: 新規 ~50 行。"You are a Reviewer agent... your final response will be structured JSON with `decision`, `feedback`, `notes`."。outputSchema が強制するので prompt は構造化を要求するヒント程度で十分。

## 7. Workflow YAML 拡張と template-validate

### 7.1 既存テンプレートとの位置関係

既存 [feature-implementation.yaml](workflows/feature-implementation.yaml) は Phase 4+ 想定の完成系（`{ from: implementer, to: diff-ready, type: publishes }` + `{ from: diff-ready, to: reviewer, type: subscribes }`）。Phase 3 では agent subscribe は実装しないので、この既存テンプレートはそのままでは動かない。対応:

- 既存 `feature-implementation.yaml` は **Phase 4 target として残す**（削除も改変もしない）。
- Phase 3 用に新規 **`workflows/feature-with-review.yaml`** を作る（B2 アーキ用のエッジ）。

### 7.2 新 edge type: `reviews`

```yaml
edges:
  - { from: implementer, to: reviewer, type: reviews }
```

- 意味: "Implementer は Reviewer に自分の作業をレビューさせることができる"。
- runtime 解釈: caller (Implementer) の session に `mcp__legion__delegate` を与え、target role への delegate のとき DelegateToolHandler が `--detach <caller's branch>` worktree を作る。Reviewer の provider は target ノードの `provider` に従う。

### 7.3 publishes edge の runtime 範囲

```yaml
nodes:
  - id: review-results
    type: blackboard
    schema: { decision: string, feedback: string }
edges:
  - { from: reviewer, to: review-results, type: publishes }
```

- agent 主導 publish: agent に `mcp__legion__publish(topic, payload)` ツールを与え、topic は template で publishes edge が引かれているもののみ許可（graph-walker で resolve）。
- runtime auto-publish: DelegateToolHandler が `system.*` prefix で書く（template の publishes edge と独立）。
- schema validation: Phase 3 では `schema` フィールドは型 hint として保持するのみ、publish 時に強制しない（Phase 4 候補）。

### 7.4 新 Phase 3 workflow テンプレート

`workflows/feature-with-review.yaml`:

```yaml
id: feature-with-review
name: Feature with Reviewer (Phase 3)
description: Director delegates to Implementer; Implementer commits then requests Reviewer; retry until approve (soft cap).

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

### 7.5 template-validate（新規 ~40 行）

`packages/runtime/src/orchestrator/template-validate.ts`:

- すべての role ノードが `provider` フィールドを持つこと
- `provider` は registered providers（`claude-code`, `codex`）のいずれか
- `provider=codex` の role が `director` / `implementer` でないこと（Phase 3 制約）
- `reviews` エッジの target が `reviewer` role に限定
- `publishes` エッジの target が `type=blackboard` ノードに限定
- `subscribes` / `synthesizes` エッジが存在する場合は **warn only**（Phase 4 で実装予定なのでロード失敗にはしない）

## 8. UI 変更

### 8.1 D-054: Layer 1 のままで運用、Layer 2 バブル展開は引き続き defer

Phase 2 spec §8.1 (D-043) で「Layer 2 バブル展開は Phase 3 に defer」と書いたが、Phase 3 では複数 Implementer 並列がまだ無い（Reviewer の retry は同じ Implementer の子だが、UI 上で Reviewer-1, Reviewer-2 が並ぶのは Overview タブで十分）。Layer 2 展開は Phase 4 に再 defer する。

### 8.2 影響ファイル一覧

| ファイル | 改修内容 | 予測増減 |
| --- | --- | --- |
| `web/src/components/CanvasOverlay.tsx` | Reviewer 表示が自然に乗る（既存 StatusNode で対応） | +15 |
| `web/src/components/EventLogPane.tsx` | Blackboard 重畳表示モード（filter chip 追加） | +30 |
| `web/src/components/sidebar-tabs/Overview.tsx` | Reviewer の decision 表示、retry 履歴 | +25 |
| `web/src/components/sidebar-tabs/Diff.tsx` | 文言調整のみ | ~0 |
| `web/src/components/sidebar-tabs/Blackboard.tsx` | 新規タブ | +120 |
| `web/src/components/SidebarTabs.tsx` | Blackboard 列追加 + props スレッディング | +20 |
| `web/src/pages/InstanceDetail.tsx` | blackboardMessages fetch | +10 |
| `web/src/api/instances.ts` | type 拡張 | +10 |
| `web/src/types/blackboard.ts`（新規） | BlackboardMessageView | +25 |
| WS ハンドラ（EventLogPane 内） | blackboard.message live 更新 | +15 |

合計 web 側 ~270 行追加。

### 8.3 Blackboard タブ表示

```text
┌─ Blackboard ─────────────────────────────────────┐
│ [All ▾] [system.*] [user]    [Topic: ▾]          │
├──────────────────────────────────────────────────┤
│ 12:00:01 system.delegate.start    →  Director→Implementer
│ 12:00:23 system.delegate.start    →  Implementer→Reviewer-1
│ 12:00:35 system.review.decision   →  request-changes
│ 12:00:55 system.delegate.start    →  Implementer→Reviewer-2
│ 12:01:08 system.review.decision   →  approve
│ 12:01:08 system.delegate.result   →  ...
└──────────────────────────────────────────────────┘
```

行 click で payload JSON を expand。フィルタは topic prefix と publisher_agent。

### 8.4 server API 拡張

- `GET /api/instances/:id` のレスポンスに `blackboardMessages` フィールドを追加（デフォルト最新 200 件、`?since=<seq>` でページング）
- Reviewer の decision は `agent_instances` には保存せず、Blackboard の `system.review.decision` topic を SELECT して取り出す（single source of truth）
- WS event-stream で `blackboard.message` event を broadcast（live 更新）

予測増減: ~+50 行（route + WS）。

## 9. テスト戦略

### 9.1 規約参照

テストカバレッジは [.claude/CLAUDE.md](.claude/CLAUDE.md) の "Test Policy: Mocks Require Contract Tests" に従う。本セクションでは Phase 3 で追加される具体的なテスト一覧と、各 mock に対応する contract test の対応表を示す。

### 9.2 追加テスト一覧

| 種別 | 対象 | 場所 | 行数 |
| --- | --- | --- | --- |
| unit (no mock) | `BlackboardStore` の CRUD と filter | `runtime/test/store/blackboard-store.test.ts` | ~140 |
| unit (no mock) | `template-validate` の各拒否ルール | `runtime/test/orchestrator/template-validate.test.ts` | ~120 |
| unit (mock) | `DelegateToolHandler` の Reviewer 分岐、reviewTargetBranch 解決、decision 抽出、Blackboard auto-publish | `runtime/test/orchestrator/delegate-tool.test.ts` 追加 | ~180 |
| unit (mock) | `CodexSdkProvider`（codexFactory injection） | `runtime/test/adapter/codex/codex-provider.test.ts` | ~140 |
| unit (mock) | `LocalWorktreeProvider.create` の reviewTargetBranch 分岐 | `runtime/test/workspace/local-worktree-provider.test.ts` 追加 | ~50 |
| **contract** | `@openai/codex-sdk` の Thread/Event 契約 verification（real Codex API） | `runtime/test/adapter/codex/codex-provider.contract.test.ts`（新規, `skipIf(!CODEX_INTEGRATION)`） | ~80 |
| integration (E2E) | Claude (Director+Implementer) + Codex (Reviewer) で approve まで 1 round | `runtime/test/integration/delegate-flow-review.integration.test.ts` | ~220 |
| integration (E2E retry) | request-changes → 再 delegate → approve | 同上ファイルに追加 | ~80 |
| server | `GET /api/instances/:id` の blackboardMessages | `server/test/routes/instances.test.ts` 追加 | ~60 |
| server | WS `blackboard.message` broadcast | `server/test/ws/event-stream.test.ts` 追加 | ~50 |
| web | Blackboard タブ表示 | `web/test/components/blackboard.test.tsx` | ~80 |
| web | Overview の Reviewer decision 表示 | `web/test/components/sidebar-tabs/overview.test.tsx` 追加 | ~40 |

合計 ~1,240 行。

### 9.3 mock ↔ contract test 対応表

| Mock | 対応する contract test |
| --- | --- |
| DelegateToolHandler unit test 内の `AgentProvider` / `WorktreeManager` mock | `delegate-flow.integration.test.ts`（Phase 2 既存、Phase 3 では Implementer→Reviewer 経路含む `delegate-flow-review.integration.test.ts` も） |
| CodexSdkProvider unit test の `codexFactory` mock | `codex-provider.contract.test.ts`（新規, `skipIf(!CODEX_INTEGRATION)`, `~/.codex/auth.json` または `CODEX_API_KEY` 必要） |
| LocalWorktreeProvider unit test の `$` shell mock | `runtime/test/workspace/git.test.ts`（Phase 1 既存、real git） |

各 mock fixture には CLAUDE.md 規約に従って `representing / verified on / invalidated when / contract test` の 4 項目ヘッダを付ける。

### 9.4 実行コスト

- Phase 2 narrow の `delegate-flow.integration.test.ts` が 38.7s / ~10〜20 cents。
- Phase 3 の retry-loop E2E は Implementer × 2 + Reviewer × 2 で ~70s / ~25〜40 cents の見込み。
- Codex contract test は ~10s / 数 cents（auth あり時のみ）。
- `skipIf` で auth 未設定時はスキップ。

### 9.5 `bun run test` 注意（Phase 2 lesson #5 継承）

`bun test` ではなく `bun run test` を使うこと。Phase 3 plan の各サブプランの執行 prompt にも明記。

## 10. 完了定義

以下すべてが満たされたら Phase 3 完了を `phase3-end` annotated tag でマーク:

1. `bun run test`: full suite green、新規 integration test `delegate-flow-review.integration.test.ts` が auth あり環境で実行成功
2. `bun run typecheck`: green
3. すべての contract test を手動で 1 度走らせて green を確認（CLAUDE.md 規約に基づく phase gate）
4. **ブラウザでの手動 E2E**: `feature-with-review` workflow をユーザーが UI から trigger、Director → Implementer → Reviewer(Codex) → approve まで Canvas / Events / Overview / Diff / Blackboard タブで確認
5. retry 経路の確認: prompt を工夫して Reviewer が `request-changes` を 1 回返すケースも UI で確認（Reviewer-1 / Reviewer-2 が agent_instances に並ぶこと）

## 11. 予測行数まとめ

| カテゴリ | 行数目安 |
| --- | --- |
| core types 拡張（DelegateToolOutput, BlackboardMessage, LaunchRequest.outputSchema, WorkspaceCreateInput, WorkflowTemplate edges） | +50 |
| runtime: store/blackboard-store.ts | 新規 ~120 |
| runtime: orchestrator/delegate-tool.ts | +60（Phase 2 140 → 200） |
| runtime: orchestrator/graph-walker.ts | +20 |
| runtime: orchestrator/template-validate.ts | 新規 ~40 |
| runtime: adapter/codex/codex-provider.ts | 新規 ~100 |
| runtime: adapter/codex/codex-launch.ts | 新規 ~50 |
| runtime: adapter/codex/codex-stream.ts | 新規 ~80 |
| runtime: adapter/role-profile.ts | +10 |
| runtime: adapter/role-prompts.ts | +70（REVIEWER_PROMPT 新規 + IMPLEMENTER_PROMPT 拡張） |
| runtime: adapter/provider.ts（capabilities, LaunchRequest.outputSchema） | +15 |
| runtime: workspace/local-worktree-provider.ts | +10 |
| server: routes/instances.ts（blackboardMessages） | +50 |
| server: ws/event-stream.ts（blackboard.message） | +30 |
| server: app.ts（Codex provider 登録 + boot assertion） | +25 |
| web: 全 UI 変更（§8.2 内訳） | +270 |
| workflows/feature-with-review.yaml | 新規 ~30 |
| tests（§9.2） | ~1,240 |

実装本体（テスト除く）≈ **+1,030 行**。テスト込みで ~+2,270 行。Phase 2 narrow が ~+1,607 行 / -271 行だったので、それより 1.4 倍ほど大きいスコープ。各ファイルは <500 行を維持。

## 12. 実装順（案）

詳細は writing-plans で詰めるが、依存関係から想定される順序:

1. **a01 runtime core**: §4（DelegateToolOutput 拡張、blackboard_messages テーブル、WorkspaceCreateInput.reviewTargetBranch）、§6.1〜6.3（DelegateToolHandler 拡張、graph-walker reviews、role-profile）、§7.5（template-validate）。
2. **a02 Codex provider**: §5 全部（CodexSdkProvider, codex-launch, codex-stream, LaunchRequest.outputSchema, capabilities 拡張, boot 時 assertion）。
3. **a03 server expansion**: §8.4（blackboardMessages レスポンス、WS blackboard.message event、instance-detail 拡張）。
4. **a04 web UI**: §8.2〜8.3（CanvasOverlay / EventLogPane / OverviewTab / DiffTab / BlackboardTab / SidebarTabs / InstanceDetail / 型 / WS ハンドラ）。
5. **a05 workflow YAML + role prompts**: §7.4（feature-with-review.yaml）、§6.4（REVIEWER_PROMPT 新規 + IMPLEMENTER_PROMPT 拡張）。
6. **a06 real-SDK + real-Codex integration tests**: §9（delegate-flow-review.integration.test, codex-provider.contract.test）。

a02 と a03 は a01 完了後に並列実装可能。a04 は a03 に依存。a05 は a01 以降ならどこでも入る。a06 が最終 gate。

a01〜a02 は contract test を先に書く（CLAUDE.md 規約）。失敗 skeleton から始めて実装で green にする。

## 13. Phase 3 で意図的に defer する項目

| 項目 | defer 理由 | 着手時期 |
| --- | --- | --- |
| **D-014 reactor / Inbox 抽象**（`tasks` / `inbox` / `subscriptions` の本実装） | B2 採用で Phase 3 では不要。Implementer 長寿命化は session 継続で達成 | Phase 4+ |
| **`subscribes` edge runtime**（agent が Blackboard を購読して起動） | reactor が前提 | Phase 4 |
| **`synthesizes` edge runtime** | reactor + multi-source aggregation 設計が必要 | Phase 4+ |
| **複数 Implementer 並列**（Layer 2 バブル展開含む） | Phase 2 §8.1 (D-043) で Phase 3 defer 決定 → さらに defer | Phase 4 |
| **Workflow Editor の編集機能** | UI 中心タスク、runtime 設計と独立 | Phase 3.5 候補 |
| **`codex app-server` 経由の bidirectional approval flow** | Reviewer は read-only なので不要 | 必要が出たら検討 |
| **Codex で Director / Implementer を動かす** | canUseTool / custom tool 注入が必須なので Codex SDK 単体では不可 | Phase 4+ |
| **per-task workspace の cleanup タイミング最適化** | retry loop で Reviewer worktree が累積する可能性を observation で確認 | Phase 3.5 候補 |
| **retry の hard cap（runtime 強制）** | Phase 3 は prompt soft cap のみ | Phase 3.5 候補 |
| **publishes edge の schema validation** | Phase 3 では hint のみ | Phase 4 |
| **WorkspaceRef.shared runtime** | D-024 で owned 固定継続 | Phase 4+ |
| **legion cleanup --repo**（session 6 carry-forward） | Phase 3 と独立 | drive-by 候補 |

## 14. 既存仕様との接続点

| 既存 D | Phase 3 での扱い |
| --- | --- |
| **D-013 / D-014**（Role / Agent Instance / Task 三層） | Agent Instance 層は引き続き完全実装。Task 層と Inbox / Subscription は Phase 3 でも空のまま保持し、Phase 4 で本実装。 |
| **D-015**（エッジ種別） | `triggers` / `delegates` に加えて Phase 3 で **`reviews` / `publishes`** を runtime 実装。`subscribes` / `synthesizes` は warn-only。 |
| **D-020**（Role lifetime） | per-workflow（Director）/ per-task（Implementer, Reviewer）を継続。Implementer は B2 アーキで approve まで生存するが lifetime は per-task の意味（review loop 完了まで = 1 task）。 |
| **D-023**（`AgentWorkspace` 抽象） | `LocalWorktreeProvider` を `reviewTargetBranch` で拡張。 |
| **D-024**（`WorkspaceRef.owned` のみ） | Phase 3 でも owned のみ。 |
| **D-027**（base commit SHA snapshot） | Implementer は引き続き baseCommitSha から、Reviewer は Implementer の branch tip から。 |
| **D-032**（Claude Code Agent SDK in-process embed） | Director / Implementer は Claude のまま。Reviewer は Codex SDK in-process embed（対称パターン）。 |
| **D-033**（allowedTools プロファイル） | Implementer に `mcp__legion__delegate` / `mcp__legion__publish` 追加。Reviewer は read-only + publish。 |
| **D-041**（`ctx.adapters` rekey） | Phase 3 で `ctx.providersByName: Map<string, AgentProvider>` に簡素化（Claude / Codex の 2 種を server boot 時に登録）。 |
| **D-044**（real-SDK integration test 必須） | Phase 3 でも継続。さらに CLAUDE.md "Test Policy" の contract test 規約を導入し、mock の信頼性を補強。 |

---

*本仕様は 2026-05-14 Phase 3 ブレストの設計状態を凝縮したもの。後続の決定が項目を変更・置換した場合は更新すること。新規 decision の番号は D-046〜D-054。*
