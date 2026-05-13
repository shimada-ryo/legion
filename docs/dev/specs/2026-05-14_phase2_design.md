# Phase 2 設計仕様書

**作成日:** 2026-05-14
**ステータス:** 実装着手用ドラフト
**ブレスト原本:** 本仕様確定後に [../minutes/2026-05-14_phase2_brainstorming.md](../minutes/2026-05-14_phase2_brainstorming.md) として議事録を切り出す。主要決定は本書 §2〜§9 で D-036〜D-045 として記録済み。
**前提決定:** [../specs/2026-05-13_phase1_design.md](../specs/2026-05-13_phase1_design.md)（Phase 1 仕様）と D-001〜D-035

本書は Phase 2 narrow scope（Director→Implementer の 1 対 1 委任）の設計を、実装着手者がそのまま読める形に凝縮したものです。Phase 2 のコードを書く前に読んでください。

## 1. 目的と完了定義

**Phase 2 narrow scope の成果物:** Director エージェントが `delegate(role, prompt)` ツールを呼んで Implementer エージェントを 1 体起こし、Implementer がワークツリー内で編集・コミットして自然に終了、Director が結果サマリを受け取って自然に終了するフローを、エンドツーエンドで動かす。

具体的には:

- Director（per-workflow, allowedTools = Read/Glob/Grep + delegate）がユーザープロンプトを受け取り、必要に応じてコードベースを読んだあと、`delegate(role="implementer", prompt=...)` を 1 回呼ぶ。
- legion runtime は delegate ハンドラ内で Implementer 用ワークツリーを切り、Implementer セッションを spawn、完了まで同期 blocking で待つ。
- Implementer は編集後に `git add -A && git commit -m "..."` でコミットし、ブランチを残して終了。
- Director は tool_result として {agentInstanceId, branchName, status, summary} を受け取り、ユーザー向けサマリを書いて終了。
- legion は Director の終了を検知して WorkflowInstance.status = 'completed' に遷移。
- UI 上は Layer 1 canvas で Director / Implementer の role node が status 別の色で塗り分けられ、Events タブで agent 別フィルタが効き、Diff タブで Implementer のコミットが見える。

Phase 2 narrow scope では Reviewer / Blackboard runtime / Codex adapter / Workflow Editor 編集機能は対象外（§13 参照）。

## 2. スコープと前提

### 2.1 D-036: Phase 2 narrow scope

Phase 2 の元構想（初期ブレスト ロードマップ）は「Director–Worker orchestration + Blackboard service + Worker role profile + Codex adapter + Workflow Editor の runtime 接続」と幅広いが、Phase 2 では以下に絞る:

- **含める**: Orchestration core（Director→Implementer delegate）、agent_instances テーブル、UI の最小拡張（Layer 1 ノード塗り分け、Events フィルタ、Diff per-agent）
- **含めない**: Reviewer 経路、Blackboard SQLite 実装、`publishes/subscribes` エッジの semantics、Codex adapter、Workflow Editor の編集機能

理由: 一度に扱うサブシステムを絞り、Director→Implementer の 1 経路を堅く動かしてから残りを順次足す。各サブシステムは互いに独立度が高く、まとめて 1 spec にすると設計議論も実装も発散しやすい。

### 2.2 D-037: 委任メカニズム = Delegate-as-tool

Director に legion 提供の `delegate` カスタムツールを見せる。Director の LLM がこれを呼ぶ → Agent SDK 経由で legion ランタイム内のハンドラに到達 → ハンドラが Implementer を spawn する。

選定理由:

- D-015 で `delegates` と `publishes/subscribes` を別エッジ種別として定義しているので、実装も別レイヤに分けるのが整合的。
- Phase 2 narrow scope で Blackboard SQLite 実装を見送るので、delegate を Blackboard 経由で実装する必要が無い。
- Agent SDK の custom tool / MCP server は採用済み技術スタックの典型機能で、追加依存が要らない。
- Phase 3 で `publishes/subscribes` を Blackboard 実装と一緒に新規追加するときに、delegate 経路とは独立に作れる。

### 2.3 D-038: delegate ツールのセマンティクス = 同期 blocking

`delegate(role, prompt)` は Implementer のセッションが完了するまで戻らない。完了時に `{agentInstanceId, branchName, status, summary}` を tool_result として Director に返す。Director の Claude セッションは Implementer の実行中は tool 呼び出し内で待機する。

選定理由:

- Phase 2 narrow scope では Director に並行作業が無い。同期で十分。
- LLM 視点で「`delegate(...)` 1 行でサブタスクを実行させて結果を受け取る」が完結し、prompt 設計が単純になる。
- Phase 3 以降で 1 対多や並列 delegate が必要になった場合、非同期版（`wait_for_agent` 等）を追加 API として後付けできる（既存の同期版を壊さない）。

### 2.4 D-039: Workflow 終了条件 = Director セッション終了

Director の lifetime は per-workflow（D-020）。Phase 2 narrow scope では Director のセッション終了が WorkflowInstance の終了の唯一のトリガ。同期 blocking のおかげで Implementer の完了は Director の終了に先行することが保証される。

| Director 終了の起因 | WorkflowInstance.status |
| --- | --- |
| Director が wrap-up メッセージを書いて自然終了 | `completed` |
| Director の Claude セッションが throw | `failed` |
| legion server がクラッシュ後リスタート | boot 時に `running` の WorkflowInstance を `failed` に書き直す（orphan recovery） |

## 3. アーキテクチャ全体図

```text
[User]
  │ POST /api/workflows/trigger {templateId, userPrompt}
  ▼
[legion server]
  │ create WorkflowInstance, persist baseCommitSha
  │ graph walk: trigger→director エッジを辿る                    ★ 新規 graph-walker
  │ spawn Director session (per-workflow)
  │ persist agent_instances row for Director                      ★ 新規 SQLite table
  ▼
[Director (Claude Code session)]
  │  allowedTools: Read/Glob/Grep + delegate                      ★ delegate custom tool
  │  user prompt をもとに、Director が delegate("implementer", ...) を call
  ▼
[legion runtime: DelegateToolHandler]                              ★ 新規
  │ generate agentInstanceId, branch名, worktree path
  │ persist agent_instances row for Implementer (parent = Director)
  │ git worktree add -b <branch> <path> <baseCommitSha>
  │ run .legion.yaml setup hooks
  │ provider.launch(Implementer)
  │ for await Implementer の AgentEvent → event log
  │ Implementer session 完了を検知 → agent_instances UPDATE
  │ return tool_result { agentInstanceId, branchName, status, summary }
  ▲
  │ tool_result
[Director (resumed)]
  │ summarize for user, end session
  ▼
[legion server]
  │ detect Director session end → mark WorkflowInstance completed
```

Phase 1 からの新規 / 変更コンポーネントは ★ で示した部分。

## 4. データモデル

### 4.1 D-040: `AgentInstance` 型の拡張

`packages/core/src/types/instance.ts` の `AgentInstance` に以下のフィールドを追加する:

```ts
export interface AgentInstance {
  id: string
  roleNodeId: string
  workflowInstanceId: string
  sessionId: string
  status: AgentStatus
  parentAgentInstanceId?: string          // ★ 親 agent (Director→Implementer なら Director の id)
  spawnEdgeId?: string                    // ★ どの template edge で生まれたか (例: "director→implementer")
  workspace: WorkspaceRef                 // ★ Phase 1 では trigger.ts ローカル変数だったものを正規化
  branchName?: string                     // ★ implementer 系のみ。Director/Reviewer は --detach なので未設定
  tasks: Task[]                           // Phase 2 narrow では常に空 (Phase 3+ で本実装)
  inbox: InboundMessage[]                 // Phase 2 narrow では常に空 (delegate は tool 経由)
  subscriptions: SubscriptionState[]      // Phase 2 narrow では常に空
  startedAt: Date
  endedAt?: Date
}
```

`tasks` / `inbox` / `subscriptions` は Phase 2 では空のまま保持する。D-014 の design intent を消さず、Phase 3+ の本実装時に drop-in できる形にしておく。

### 4.2 SQLite テーブル

`packages/runtime/src/store/agent-instance-store.ts`（新規）に以下のテーブルを切る:

```sql
CREATE TABLE agent_instances (
  id                       TEXT PRIMARY KEY,           -- ULID
  workflow_instance_id     TEXT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  role_node_id             TEXT NOT NULL,              -- template snapshot 内の node id
  session_id               TEXT NOT NULL UNIQUE,       -- provider 発行
  parent_agent_instance_id TEXT REFERENCES agent_instances(id),
  spawn_edge_id            TEXT,                       -- "<fromNodeId>→<toNodeId>" or NULL (trigger 経由なら NULL)
  status                   TEXT NOT NULL,              -- AgentStatus
  workspace_kind           TEXT NOT NULL,              -- 'owned' (Phase 1 と同じ)
  workspace_path           TEXT NOT NULL,
  branch_name              TEXT,                       -- NULL for --detach (Director)
  started_at               INTEGER NOT NULL,
  ended_at                 INTEGER
);

CREATE INDEX idx_agent_instances_workflow  ON agent_instances(workflow_instance_id);
CREATE INDEX idx_agent_instances_session   ON agent_instances(session_id);
CREATE INDEX idx_agent_instances_parent    ON agent_instances(parent_agent_instance_id);
```

`workspace_kind` は Phase 1 では `'owned'` 固定だが、`shared` の余地を残して将来 migration をスムーズにする。

### 4.3 Store API

```ts
class AgentInstanceStore {
  insert(row: AgentInstanceRow): void
  updateStatus(id: string, status: AgentStatus): void
  setEndedAt(id: string, endedAt: Date): void
  byId(id: string): AgentInstanceRow | undefined
  bySessionId(sessionId: string): AgentInstanceRow | undefined
  listByWorkflow(workflowInstanceId: string): AgentInstanceRow[]
  listChildren(parentAgentInstanceId: string): AgentInstanceRow[]
}
```

Phase 1 の `InstanceStore`（workflow_instances 管理）と同じパターン。予測行数: store 本体 ~120 行、テスト ~150 行。

### 4.4 D-041: `ctx.adapters` の値を adapter のみに簡素化し、approvalId→sessionId の side map を追加

Phase 1 の `ctx.adapters` は `Map<workflowInstanceId, { adapter, sessionId }>` で、1 workflow = 1 agent = 1 sessionId の前提で値に sessionId を埋め込んでいた。Phase 2 では 1 workflow に複数 agent が乗るため、この埋め込みが破綻する。

採用する形:

- `adapters: Map<workflowInstanceId, AgentProvider>` — Director と Implementer は同じ Claude Code provider インスタンスを共有するので、provider は 1 workflow に 1 つで十分。値から sessionId を外す。
- `approvalIdToSessionId: Map<approvalId, sessionId>` — server プロセス内に新設。`ApprovalOrchestrator` が `permission_request` を emit するときに同時にこの map に登録する。

`POST /api/instances/:id/approvals/:approvalId` の解決経路:

1. URL から `instanceId` と `approvalId` を取り出す。
2. `approvalIdToSessionId.get(approvalId)` → sessionId。
3. `adapters.get(instanceId)` → provider。
4. `provider.approve(sessionId, approvalId)`。

crash 後リスタートで未承認の approval は失われるが、Phase 2 narrow scope では Director も同様にロストする前提（orphan recovery で workflow ごと `failed` に書き直す）なので許容する。

（初期ブレインストーミング時の方針は「`adapters` のキーを sessionId に rewrite」だったが、実装計画化時に refine。「同一 workflow の全 agent が同じ provider インスタンスを共有する」事実を踏まえると、provider lookup と session 識別を分離する方が API surface が小さくなる。）

これは Phase 1 引き継ぎ書の「Phase 2 enablement concern #1」への対応。

## 5. delegate ツール

### 5.1 ツール schema

`packages/core/src/types/delegate.ts`（新規）に追加:

```ts
export interface DelegateToolInput {
  role: string                  // Phase 2 narrow では 'implementer' のみ受理
  prompt: string                // Implementer 用のサブタスク指示
  rationale?: string            // (任意) なぜこの delegate を行うかの一文。event log にのみ書く
}

export interface DelegateToolOutput {
  agentInstanceId: string       // Implementer の AgentInstance.id
  branchName: string            // 例: "legion/wf01j9x/impl-1"
  status: 'completed' | 'failed'
  summary: string               // Implementer の最終 assistant message を要約
  error?: string                // status='failed' のときのみ
}
```

### 5.2 ハンドラ実装

`packages/runtime/src/orchestrator/delegate-tool.ts`（新規, ~140 行）に集約:

```ts
class DelegateToolHandler {
  constructor(private deps: {
    workflowInstanceId: string
    parentAgentInstanceId: string         // Director の id
    parentSessionId: string
    agentInstanceStore: AgentInstanceStore
    worktreeManager: WorktreeManager
    provider: AgentProvider               // Phase 2 narrow では Director と同じ Claude Code provider
    eventLog: EventLog
    template: WorkflowTemplate            // graph 検証用
    baseCommitSha: string
  }) {}

  async handle(input: DelegateToolInput): Promise<DelegateToolOutput> {
    // 1. role を検証 (Phase 2 narrow では 'implementer' のみ)
    // 2. template の delegates エッジで Director → Implementer が定義されているか resolveDelegateTargets で検証
    // 3. agent_instances row を INSERT (status='starting', parent=Director, spawn_edge_id)
    // 4. worktree を切る: git worktree add -b legion/<wfShortId>/impl-<seq> <path> <baseCommitSha>
    // 5. .legion.yaml setup hooks を流す
    // 6. provider.launch(req) で Implementer session を起動
    // 7. for await Implementer events → event log に書き、最終 assistant message を summary として保持
    // 8. session 完了 (sdk done) を検知 → agent_instances を ended_at で UPDATE
    // 9. DelegateToolOutput を組み立てて return
  }
}
```

このハンドラは Agent SDK の tools option（in-process MCP server パターン）として Director の session にだけ inject する。`provider.launch()` のシグネチャに `customTools?: unknown[]` を増やす。

### 5.3 `provider.ts` への変更点

`launch()` 内の `query()` 呼び出しに条件分岐を 1 行追加するのみ:

```ts
const iter = this.opts.query({
  prompt: req.initialPrompt,
  options: {
    cwd: req.workdir,
    allowedTools: allowed,
    permissionMode: 'default',
    canUseTool: async (toolName, input) => { /* 既存 */ },
    ...(req.customTools !== undefined ? { tools: req.customTools } : {}),  // ★追加
    ...(req.model !== undefined ? { model: req.model } : {}),
    ...(req.env !== undefined ? { env: req.env } : {}),
  },
})
```

`LaunchRequest` 型に `customTools?: unknown[]` を 1 フィールド追加。Phase 1 の呼び出し側（Implementer 単独 spawn）は無変更。

## 6. ロール profile

### 6.1 D-042: ロール profile = (allowedTools, systemPrompt) の対

Phase 1 では `allowedTools` のみハードコーディングされていた。Phase 2 では Director / Implementer の役割を LLM に伝える system prompt が必要になるため、両者を 1 箇所に集約する。

#### 6.1.1 allowedTools の更新（`packages/runtime/src/adapter/role-profile.ts`）

```ts
const PROFILES: Record<string, readonly string[]> = {
  director: [...READ_TOOLS, 'mcp__legion__delegate'],                       // ★ delegate 追加
  implementer: [
    ...EDIT_TOOLS,
    ...IMPLEMENTER_BASH_WHITELIST,
    'Bash(git add*)',                                                       // ★ I-9 解消
    'Bash(git commit*)',                                                    // ★ I-9 解消
    'Bash(git status*)',                                                    // ★ I-9 解消
    'Bash(git diff*)',                                                      // ★ I-9 解消
  ],
  reviewer: READ_TOOLS,
}
```

`mcp__legion__delegate` という命名は in-process MCP server を採用する場合の慣例。SDK の tools option の実装方式（custom tool vs MCP）は writing-plans で確定。

#### 6.1.2 system prompt（`packages/runtime/src/adapter/role-prompts.ts`, 新規 ~80 行）

```text
DIRECTOR_PROMPT:
  You are the Director agent in legion. Your job is to receive a user task,
  decide what sub-task to delegate to an Implementer, and report the result.

  Available tools:
  - Read / Glob / Grep — to investigate the codebase before delegating.
  - delegate(role, prompt) — to spawn an Implementer agent. This is a BLOCKING
    call: it returns only after the Implementer has finished. The return value
    contains the branch name and a summary of what the Implementer did.

  You SHOULD:
  1. Optionally read a few files to understand the task scope.
  2. Write a precise, self-contained prompt for the Implementer that describes
     what to change, in which file, and any relevant constraints. The Implementer
     does NOT see the original user prompt — only what you pass to delegate.
  3. Call delegate exactly once with role='implementer'.
  4. After delegate returns, summarize the result for the user. Mention the
     branch name. Do not call delegate again.

  You MUST NOT attempt to edit files yourself. Your toolset does not include
  Edit/Write — that is intentional.

IMPLEMENTER_PROMPT:
  You are an Implementer agent in legion. You operate inside a git worktree
  that was created specifically for this task. The Director has handed you
  a self-contained sub-task.

  You SHOULD:
  1. Read the files relevant to the task.
  2. Make the requested edits.
  3. Run any quick verification command if applicable (e.g. typecheck).
  4. Commit your changes with 'git add -A && git commit -m "<concise message>"'.
     This is REQUIRED — your branch is how the Director and Reviewer see your work.
  5. Briefly summarize what you changed and end the session.

  You MUST commit before ending. An uncommitted worktree is treated as a failed
  delegate by the Director.
```

### 6.2 `defaultSystemPromptFor` API

`defaultAllowedToolsFor(role)` の隣に `defaultSystemPromptFor(role): string` を追加。`buildInitialPrompt`（既存）が role に応じて system prompt をプリペンドするように改修。

### 6.3 I-9 解消

Phase 1 引き継ぎ書の I-9（Implementer がブランチに commit しない問題）は、上記 IMPLEMENTER_PROMPT と allowedTools の `Bash(git add*)` / `Bash(git commit*)` 追加で解消。Phase 2 では Diff タブで Implementer のコミットが確認できる状態を完了条件に含める。

## 7. Termination model と graph walker

### 7.1 Workflow lifecycle

```text
WorkflowInstance.status の遷移:

  running ──── Director session ends normally ───► completed
  running ──── Director session throws ──────────► failed
  running ──── legion server crash + restart ────► failed (orphan recovery)
```

### 7.2 Implementer 失敗時の挙動

`DelegateToolHandler.handle()` 内で Implementer の session が異常終了した場合:

| Implementer 状態 | tool_result | Director の挙動 |
| --- | --- | --- |
| 正常完了 | `{status: 'completed', branchName, summary}` | summary を読んで wrap-up |
| ツール拒否で停滞して終了 | `{status: 'completed', branchName, summary: '(no progress)'}` | wrap-up（Director の判断で「失敗」と user に報告） |
| Provider が throw | `{status: 'failed', error}` | Director が判断（再 delegate or 諦め） |

Phase 2 narrow scope では「Director が再 delegate するべきか」は prompt の自由度に任せる。明示的な retry policy は導入しない（YAGNI）。

### 7.3 orphan recovery

legion server boot 時に SQLite の `workflow_instances` から status='running' の行を読み、いずれも `failed` に書き直す（agent_instances の `endedAt` が未設定の行も合わせて閉じる）。Phase 1 では未対応だった処理を Phase 2 でまとめて入れる。~20 行の追加処理。

### 7.4 Graph walker（Phase 2 enablement concern #4）

`packages/runtime/src/orchestrator/graph-walker.ts`（新規, ~80 行）:

```ts
export function resolveTriggerTargets(template: WorkflowTemplate): RoleNode[] {
  // trigger ノードから 'triggers' エッジを 1 ホップたどって到達する role ノードを返す
  // Phase 2 narrow では戻り値は常に 1 件 (Director)
}

export function resolveDelegateTargets(
  template: WorkflowTemplate,
  fromRoleNodeId: string,
): { roleNodeId: string; roleName: string }[] {
  // fromRoleNodeId から 'delegates' エッジを 1 ホップたどる role ノードを返す
  // DelegateToolHandler が delegate(role="implementer") を受けたとき、
  // template snapshot 上で本当に Director → Implementer の delegates エッジが
  // 引かれているか検証するのに使う (workflow YAML の制約をランタイムで強制)
}
```

Phase 1 の `firstRoleNode`（doc-order fallback あり）を `resolveTriggerTargets` に置き換え、fallback は廃止する。明示的な `triggers` エッジを要求する形で固める。

## 8. UI 変更

### 8.1 D-043: Layer 2 overlay の方針

D-013 では「Layer 2 のブロックは Agent Instance、Instance 内に Task/Step」と定めている。理想的には Layer 1 の Role ノードを Layer 2 で「複数の Agent Instance バブル」に展開したいが、Phase 2 narrow scope では各 role の agent は 1 体ずつなので、**Phase 2 では Layer 1 のノードを status で塗るだけに留め、Layer 2 のバブル展開は Phase 3 に defer する**。

理由: 複数 Implementer が並列で走る Phase 3+ になって初めてノード分割 UI が意味を持つ。Phase 2 で UI レイアウトを劇変させると、回帰リスクが上がる。

### 8.2 CanvasOverlay の改修（Phase 2 enablement concern #5）

現状の `deriveActiveRoles` は「event が 1 件でも来たら全 role node をハイライト」する fake。これを `agent_instances` ベースに置き換える:

```ts
function deriveActiveRoles(agentInstances: AgentInstance[]): Map<string, AgentStatus> {
  const m = new Map<string, AgentStatus>()
  for (const ai of agentInstances) {
    m.set(ai.roleNodeId, mergeStatus(m.get(ai.roleNodeId), ai.status))
  }
  return m
}
```

ノード背景色を status で塗り分け:

| status | 背景色 |
| --- | --- |
| `running` / `starting` | 青系 |
| `completed` | 薄緑 |
| `failed` | 薄赤 |
| agent_instance が無い role | 白（Phase 1 と同じ） |

### 8.3 Events タブ — agent フィルタ

Events タブ上部に agent selector を追加。`AgentEvent.sessionId` でフィルタする:

```text
┌─ Events ─────────────────────────────────┐
│ [All ▾]  [Director]  [Implementer-1]     │
├───────────────────────────────────────────┤
│ 12:00:01  Director       Read foo.ts      │
│ 12:00:03  Director       calling delegate │
│ 12:00:04  Implementer-1  Edit foo.ts      │
│ 12:00:05  Implementer-1  Bash git commit  │
│ 12:00:06  Director       (resumed)        │
└───────────────────────────────────────────┘
```

各行に role 名 + seq の prefix を入れる。既存 `EventLogPane.tsx` に filter state を 1 つ足す改修。

### 8.4 Overview タブ — parent / children セクション

agent_instances の `parentAgentInstanceId` を使って親子関係を表示:

```text
─ Overview (Implementer-1) ─
Role          : implementer
Status        : completed
Lifetime      : per-task
Workspace     : ~/.legion/worktrees/<...>/impl-1
Branch        : legion/wf01j9x/impl-1
Started       : 12:00:04
Ended         : 12:00:05

▼ Spawned by
  Director (delegate edge)
```

Director を選んだ場合は逆に `▼ Spawned` で Implementer-1 を表示。

### 8.5 Diff タブ — agent ごとのセクション

`/api/instances/:id/diff` を per-agent 集約に拡張する。Phase 2 narrow scope では Implementer 1 体のみだが、複数を許容する設計にしておく:

```text
─ Diff ─
▼ Implementer-1 (legion/wf01j9x/impl-1)
  └ src/foo.ts  (+12, -3)
  └ README.md   (+1, -0)
```

Director は `--detach` で commit を残さないので diff セクションには出ない。

### 8.6 影響ファイル一覧

| ファイル | 改修内容 | 予測増減 |
| --- | --- | --- |
| `web/src/components/CanvasOverlay.tsx` | `deriveActiveRoles` 書き換え、props 拡張 | +20 / -10 |
| `web/src/components/EventLogPane.tsx` | agent フィルタ UI | +30 |
| `web/src/components/sidebar-tabs/Overview.tsx` | parent/children セクション | +40 |
| `web/src/components/sidebar-tabs/Diff.tsx` | per-agent セクション化 | +20 |
| `web/src/pages/InstanceDetail.tsx` | `agentInstances` を fetch して props に流す | +15 |
| `server/src/routes/instances.ts` (diff) | per-agent 集約 | +25 |

合計 web 側で ~150 行の追加・修正。

## 9. Phase 1 carry-forward の扱い

| ID | 内容 | Phase 2 narrow に含めるか | 理由 |
| --- | --- | --- | --- |
| **I-1** | `provider.ts` の分割（≈ 163 行、200 行で split 予定） | 含める | Phase 2 で `customTools` 注入と `LaunchRequest` 拡張を追加するので確実に 200 行を超える。 |
| **I-2** | WebSocket history/tail race | 含める（軽量版） | Phase 1 では 1 agent で顕在化しなかったが、Phase 2 で 2 agent が並走するとレース窓が広がる。`EventLogReader.history({ afterSeq })` + subscribe-first に変更（~30 行）。 |
| **I-3** | `legion cleanup --yes` の警告プロンプト | 含めない | CLI UX 改善。Phase 2 の core 価値に直接寄与しない。 |
| **I-4** | `branch-naming.ts` の dead `SINGLETON_ROLES` 分岐 | 含める（ついで） | graph walker 改修と同じファイル群を触るので drive-by で削除可能（~10 行）。 |
| **I-5** | 21 subpath exports の curate vs flat | 含めない | API surface 設計判断は Phase 2 後の独立タスクで扱う。 |
| **I-9** | Implementer が commit しない | 含める | §6.3 で対応済み。 |

### 9.1 D-045: `provider.ts` の分割

Phase 2 で `launch` が 60 行超過の見込みのため、以下に分割:

- `provider.ts`: クラス本体と外向き API（capabilities 宣言、detect/authenticate、各メソッドの薄い委譲）。~80 行。
- `provider/launch.ts`（新規）: `launchSession` 関数として `launch` の中身を切り出し。`customTools` の組み立て、`canUseTool` の合成、`SessionStore.set` まで。~100 行。
- `provider/stream.ts`（新規）: `streamSession` 関数として `stream` の中身を切り出し。SDK iter と EventInjector の merge ロジック。~70 行。

クラス本体は薄い orchestrator になる（refactoring policy の責務分離基準を満たす）。

## 10. テスト戦略

### 10.1 D-044: real-SDK integration test を必須化

Phase 1 smoke discoveries の教訓は「mock 中心テストでは SDK option key の typo（I-6）や `canUseTool` vs `PreToolUse`（I-8）などの 『spec said X, impl did Y』 ギャップを捉えられない」だった。Phase 2 では critical flow ごとに real-SDK integration test を 1 本追加する。

### 10.2 追加テスト一覧

| テスト種別 | 対象 | 場所 | 行数 |
| --- | --- | --- | --- |
| unit | `AgentInstanceStore` の CRUD と parent-child クエリ | `runtime/test/store/agent-instance-store.test.ts` | ~150 |
| unit | `resolveTriggerTargets` / `resolveDelegateTargets` | `runtime/test/orchestrator/graph-walker.test.ts` | ~120 |
| unit | `DelegateToolHandler.handle()` を mock provider 相手に駆動 | `runtime/test/orchestrator/delegate-tool.test.ts` | ~200 |
| integration (real-SDK) | Director session を実 Claude Code SDK で起動し、`delegate` を 1 回呼ぶ流れを完走させる。Implementer が commit を残すこと、agent_instances テーブルに 2 行入ることを assert。`skipIf` で `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` 不在時はスキップ | `runtime/test/integration/delegate-flow.integration.test.ts` | ~180 |
| server | `GET /api/instances/:id` が `agentInstances[]` を実データで返すこと | `server/test/routes/instances.test.ts` への追加 | ~60 |
| web | `CanvasOverlay` が `agentInstances` props を受けて status に応じて背景色を変えること | `web/test/components/canvas-overlay.test.tsx` への追加 | ~50 |

合計 ~760 行のテスト追加。Phase 1 の 126 件に対して 30〜40 件 increment の目安。

## 11. 予測行数まとめ

| カテゴリ | 新規 / 改修 | 行数目安 |
| --- | --- | --- |
| core types 追加（DelegateTool, AgentInstance 拡張） | 新規 + 改修 | ~60 |
| runtime: agent-instance-store.ts | 新規 | ~120 |
| runtime: orchestrator/graph-walker.ts | 新規 | ~80 |
| runtime: orchestrator/delegate-tool.ts | 新規 | ~140 |
| runtime: adapter/role-prompts.ts | 新規 | ~80 |
| runtime: adapter/role-profile.ts | 改修 | +15 |
| runtime: adapter/provider.ts + provider/launch.ts + provider/stream.ts | 分割 + 改修 | net +60 |
| runtime: orchestrator/trigger.ts | 改修（graph walker 呼び出し + agent_instances INSERT） | +30 / -20 |
| runtime: orchestrator/spawn-agent.ts (initial prompt 改修) | 改修 | +20 |
| server: routes/instances.ts (`agentInstances` 返却 / per-agent diff) | 改修 | +50 |
| server: WS race fix (I-2) | 改修 | +30 |
| server: boot 時 orphan recovery | 改修 | +20 |
| web: CanvasOverlay / Overview / Events / Diff / InstanceDetail | 改修 | net +130 |
| branch-naming.ts (I-4 dead branch 削除) | 改修 | -10 |
| tests (§10.2) | 新規 | ~760 |

実装本体（テスト除く）≈ **+795 行 / -30 行**。Phase 1 が ~2,500 行規模だったので、それより小さいスコープに収まる。各ファイルは <500 行を維持。

## 12. 実装順（案）

writing-plans で詳細化するが、依存関係から想定される順序:

1. **型追加と Store**: `DelegateToolInput/Output` 型、`AgentInstance` 拡張、`AgentInstanceStore` と unit test。
2. **Graph walker**: `resolveTriggerTargets` / `resolveDelegateTargets` と unit test。Phase 1 の `firstRoleNode` を置換。`branch-naming.ts` の I-4 ついで削除。
3. **provider.ts 分割**（I-1）: launch / stream 抽出。`customTools` パラメータ追加。Phase 1 テストが引き続き green であることを確認。
4. **Role prompts**: `role-prompts.ts` 新規、`role-profile.ts` で delegate ツールと git コマンドを追加、`defaultSystemPromptFor` API、`buildInitialPrompt` 改修。
5. **DelegateToolHandler**: 新規実装と unit test。
6. **trigger.ts 改修 + ctx.adapters rekey**（D-041）: graph walker 経由で Director を spawn し、agent_instances に persist。`ctx.adapters` を sessionId キーに。
7. **orphan recovery**: server boot 時の `running` → `failed` 書き換え処理。
8. **server: per-agent diff と instance detail レスポンス拡張**。
9. **WS race fix**（I-2）: history/tail race を subscribe-first に。
10. **web: CanvasOverlay / Events / Overview / Diff の改修**。
11. **integration test**（D-044）: real-SDK で Director→Implementer 1 往復を完走させる。

ステップ 1〜2 はテストファースト、ステップ 3 以降は既存テストの green を維持しつつ進める。

## 13. Phase 2 で意図的に defer する項目

| 項目 | defer 理由 | 着手時期 |
| --- | --- | --- |
| Reviewer 経路（`reviews` エッジ実体化、`worktreeAdd` の `--detach <branch>` 拡張） | Phase 2 narrow scope の外。Director→Implementer フローを固めた後に追加する方が安全 | Phase 3 |
| Blackboard SQLite 実装 + `publishes/subscribes` エッジの runtime | delegate を tool 経由にした（D-037）ので Phase 2 では未使用。Reviewer 経路と同時に実装すると無駄が無い | Phase 3 |
| Codex adapter | Phase 2 narrow scope の外。Reviewer で Codex を採用するタイミングで実装 | Phase 3 |
| Workflow Editor の編集機能（Layer 1 の編集可能化） | UI 中心タスクで runtime 設計とは独立。専用 phase で扱う | Phase 3.5 候補 |
| D-014 reactor の本格実装（Implementer の長寿命化 + Inbox） | per-task Implementer の単発 spawn では reactor 抽象を導入する利益が薄い | Phase 3+ |
| `WorkspaceRef.shared` の runtime | D-024 で owned のみと決定済み | Phase 3+ |
| `legion cleanup --yes` の警告プロンプト（I-3） | CLI UX、core 価値に直接寄与しない | drive-by 候補 |
| 21 subpath exports の curate（I-5） | API surface 設計判断は独立タスク | Phase 2 後 |

## 14. 既存仕様との接続点

| 既存 D | Phase 2 での扱い |
| --- | --- |
| **D-013 / D-014** (Role / Agent Instance / Task 三層) | Phase 2 narrow scope では Agent Instance 層まで実装。Task 層と Inbox / Subscription は Phase 3+ に defer。 |
| **D-015** (エッジ種別) | `triggers` と `delegates` を Phase 2 で本実装。`publishes/subscribes/reviews/synthesizes` は Phase 3 以降。 |
| **D-020** (Role lifetime) | per-workflow（Director）と per-task（Implementer）を本実装。`persistent` は引き続き defer。 |
| **D-023** (`AgentWorkspace` 抽象) | Phase 1 の `LocalWorktreeProvider` をそのまま継続使用。Implementer の worktree 生成のみ delegate-tool.ts から呼ぶ形に追加。 |
| **D-024** (`WorkspaceRef.owned` のみ) | Phase 2 でも `owned` のみ。 |
| **D-027** (base commit SHA snapshot) | `WorkflowInstance.baseCommitSha` を Implementer worktree 作成時にそのまま使う。 |
| **D-032** (Claude Code Agent SDK in-process embed) | Director と Implementer の両方で同じ provider を使用。`customTools` で delegate を Director にだけ injection。 |
| **D-033** (allowedTools プロファイル) | `delegate` ツールと `Bash(git *)` を Director / Implementer のプロファイルに追加。 |

---

*本仕様は 2026-05-14 Phase 2 narrow scope ブレストの設計状態を凝縮したもの。後続の決定が項目を変更・置換した場合は更新すること。新規 decision の番号は D-036〜D-045。*
