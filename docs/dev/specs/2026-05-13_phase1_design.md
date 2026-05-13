# Phase 1 設計仕様書

**作成日:** 2026-05-13
**ステータス:** 実装着手用ドラフト
**ブレスト原本:** [../minutes/2026-05-13_phase1_brainstorming.md](../minutes/2026-05-13_phase1_brainstorming.md)
**前提決定:** [../minutes/2026-05-13_initial_brainstorming.md](../minutes/2026-05-13_initial_brainstorming.md) (D-001〜D-020)

本書は Phase 1 のブレストで確定した D-021〜D-035 を、実装着手者がそのまま読める形に凝縮したものです。Phase 1 のコードを書く前に読んでください。

## 1. 目的と完了定義

**Phase 1 の成果物:** Claude Code エージェントを隔離された git worktree 内で走らせ、二層モデルをプレビューする最小 Web UI から観測できる状態にする。

具体的には:

- Workflow を trigger → legion が `WorkflowInstance` を生成 → 専用 worktree 内に `AgentInstance` を spawn → Claude Code Agent SDK 経由でドライブ → 構造化イベントを捕捉 → Web UI に描画。
- Web UI には Layer 1 Template エディタの非インタラクティブな静的モックアップも含む (Track B)。
- Director–Worker 連携はまだ無い (Phase 2 範囲)。Phase 1 では `WorkflowInstance` あたり 1 つの agent を spawn して runtime をエンドツーエンドで検証するレベルで足りる。

## 2. 進行戦略

### 2.1 Track の進行順 (D-021, D-022)

Phase 1 は時期スライスではなく順序連続で進める:

1. **Track A 先行** — headless runtime + 最小 Web UI (Instance 系)。
2. **Track B 後行** — Layer 1 Template エディタの静的モックアップ。

理由: R-001 (UI が runtime に先んじる齟齬) が中核懸念。runtime の方が難所であり、静的モックアップは型が固まれば視覚的な仕事が中心。

### 2.2 Interface lock

両 Track は [`packages/core/src/types/`](../../../packages/core/src/types/) の型を共有 interface として参照する。Track A 実装中にここを変更したら、Track B モックアップ確定前に反映する。

## 3. アーキテクチャ

### 3.1 AgentWorkspace 抽象 (D-023)

D-002「git worktree を第一級」の再解釈:

- runtime API レイヤの第一級概念は **`AgentWorkspace`**。
- Phase 1 実装: `LocalWorktreeProvider` (`git worktree add` を使う)。
- Phase 4 実装 (今回スコープ外): `RemoteCloneProvider` (中央 git に対する `git clone` を使う)。

ローカル運用で worktree が clone に勝つのは `.git` 共有由来のため:

- Director の観測性: `git log --all` で全 Implementer ブランチが即座に見える
- Reviewer の差分取得: `fetch` 不要で `git diff` 可能
- 巨大 repo での setup コスト / ディスク使用量の節約

「同一ブランチを 2 つの worktree に check out できない」制約は legion の運用では発火しない (Implementer は task 単位の独立ブランチ、Director / Reviewer は `--detach`)。

### 3.2 Workspace ↔ Instance マッピング (D-024)

`AgentInstance` 1 つにつき `WorkspaceRef` を 1 つ持つ。Ref の中身は owned か shared の 2 形態:

```ts
type WorkspaceRef =
  | { kind: 'owned'; path: string; branch?: string }
  | { kind: 'shared'; targetInstanceId: string; mode: 'ro' | 'rw' }
```

**Phase 1 では `owned` のみ runtime 実装する。** `shared` は型に予約しておくが、実コードは将来。

Role 別のデフォルト構成:

| Role | lifetime | WorkspaceRef | 何を見るか |
| --- | --- | --- | --- |
| Director | per-workflow | `owned`, workflow 開始 commit に `--detach` | 共有 `.git` 経由で全 worker のブランチを参照 |
| Implementer | per-task | `owned`, 専用ブランチ | 自分のブランチを編集・commit |
| Reviewer | per-task | `owned`, 対象 Implementer ブランチの HEAD に `--detach` | 対象ブランチの commit 済み状態をレビュー |

## 4. Worktree 規約

### 4.1 物理配置 (D-025)

デフォルト base path: `~/.legion/worktrees/<repo-fingerprint>/<workflowInstanceId>/<agentInstanceId>/`

- `<repo-fingerprint>` = `${repoBasename}-${shortHashOfFullPath}`。basename 同名の複数 repo を区別するため。
- `~/.legion/config.yaml` 等で base path を上書き可能 (設定キーの正式名称は実装時に確定)。

理由: 対象 repo を一切汚染しない、`rm -rf ~/.legion/worktrees` で全消去可能、複数 repo を一元管理。

### 4.2 ブランチ命名 (D-026)

パターン: `legion/<wfShortId>/<role>-<seq>`

- `wfShortId` = workflow instance の ULID 先頭 8 文字。
- `<role>` = `director` / `implementer` / `reviewer` 等。
- `<seq>` = この workflow 内の同一 role の並列インデックス (1, 2, 3, ...)。

例:

- `legion/wf01j9x/director`
- `legion/wf01j9x/impl-1`
- `legion/wf01j9x/impl-2`
- `legion/wf01j9x/reviewer-1`

Director / Reviewer の worktree は `--detach` (ブランチ無し) のため、本命名規約の適用対象は Implementer 等の書き手 role のみ。

### 4.3 base commit の選定 (D-027)

- Workflow trigger 時に UI で base ブランチを選ばせる。デフォルトは repo の現 HEAD ブランチ。
- 選ばれたブランチを trigger 時刻の commit SHA に解決して固定。
- 同一 workflow instance の全 Implementer worktree がこの SHA から分岐する。走行中に upstream の base ブランチが進んでも影響を受けない (再現性確保)。

### 4.4 setup フック (D-028)

repo root に置く `.legion.yaml` の最小スキーマ:

```yaml
worktree:
  setup:                          # worktree 作成後に実行
    - bun install
  copyFiles:                      # gitignored だが必要なファイル (.env.local 等)
    - .env.local
  # ports: Phase 3 のために予約 (D-029)
```

Worktree 作成シーケンス:

1. `git worktree add` で worktree を作成。
2. `copyFiles` の各エントリを main checkout から worktree 内に copy。
3. `setup` の各コマンドを worktree cwd で逐次実行。
4. 完了したら agent を spawn。

`.legion.yaml` 不在時は no-op で即 spawn。

### 4.5 ターゲットプロジェクトの port 割当 (D-029)

Phase 3 (review loop 期) に defer。Phase 1 ではスキーマに `worktree.ports` の領域を予約するのみ。

### 4.6 legion 本体の port (D-030)

legion の Bun HTTP/WS サーバは default で `5500` を listen する。`--port` フラグで上書き可能。

### 4.7 cleanup (D-031)

- **デフォルト挙動:** workflow 完了後も worktree とブランチを retain。
- `legion cleanup` コマンドで明示削除。安全側: ブランチが merge 済みか commit 0 件のものだけ無確認削除可、それ以外は警告して確認。
- Phase 3 で `.legion.yaml: worktree.retentionDays` の時間ベース自動掃除を足す。

## 5. Claude Code adapter

### 5.1 実装パターン (D-032)

`@anthropic-ai/claude-agent-sdk` を in-process で使用。`AgentInstance` ごとに `query()` を呼び、返ってくる `AsyncIterable<Message>` を消費する。

スケッチ:

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

class ClaudeCodeAgentSDKProvider implements AgentProvider {
  id = 'claude-code'
  capabilities = {
    supportsCheckpoint: false,
    supportsResume: true,
    supportsAttach: false,        // Phase 1 では未実装
    supportsApprovalFlow: true,
  }

  async launch(req: LaunchRequest): Promise<SessionHandle> {
    const sessionId = ulid()
    const iter = query({
      prompt: req.initialPrompt,
      options: {
        workingDirectory: req.workdir,
        allowedTools: this.profileFor(req.role),
        permissionMode: 'default',
        hooks: { PreToolUse: [(p) => this.onPermission(sessionId, p)] },
        model: req.model,
      },
    })
    this.sessions.set(sessionId, iter)
    return { sessionId }
  }

  async *stream(sessionId: string): AsyncIterable<AgentEvent> {
    const iter = this.sessions.get(sessionId)!
    for await (const msg of iter) {
      yield this.toAgentEvent(msg)
    }
  }
  // …
}
```

プロセス分離のトレードオフ: `query()` は legion プロセス内で走る。Phase 1 では `try/catch` で crash を抑えて対処する。隔離が重要になったタイミングで Bun の worker thread に移すことを Phase 2 以降で検討。

### 5.2 既存型への影響

[`packages/core/src/types/agent-provider.ts`](../../../packages/core/src/types/agent-provider.ts) には軽い調整が要る:

- `PtyHandle` と `AgentProvider.attach()` は Phase 1 で未使用。`attach` を optional 化するか、必須のまま「`supportsAttach: false` の実装では throw する」と方針を文書化する。
- `Checkpoint` / `checkpoint()` / `resume()` の Claude Code 上での意味: SDK には checkpoint プリミティブが無い。`resume(sessionId)` は `query()` の options に `resume: sessionId` を渡す形で実装。`checkpoint()` は no-op か現在の session id を返すだけにする。

### 5.3 Approval policy フレームワーク (D-033)

各 `RoleNode` がデフォルト `allowedTools` プロファイルを持ち、workflow YAML 側で個別 override 可能:

| Role | デフォルト `allowedTools` |
| --- | --- |
| Director | `Read`, `Glob`, `Grep` |
| Implementer | `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Bash(<test/typecheck 系コマンド>)` |
| Reviewer | `Read`, `Glob`, `Grep` |

`PreToolUse` hook 発火時の動き:

1. agent の `allowedTools` と照合する。
2. 許可されていれば即 permit。
3. 範囲外なら、`AgentEvent` の `permission_request` タイプ (既存 `agent-provider.ts` のイベント分類に合致) を event log に emit、WebSocket で Web UI にストリーム、人間の Approve / Deny を待ち、その判定を hook の戻り値にする。

これは D-013 / D-014 (Role を encapsulation 境界とする) と整合。Blackboard (Phase 2) は使わず、Phase 1 は event log + WebSocket subscription で approval を回す。

`permissionMode` の扱い: legion は `permissionMode: 'default'` を設定し、SDK は毎回 `PreToolUse` を呼ぶ。実際のポリシー判定は hook 側に置く。SDK ビルトインの `acceptEdits` / `bypassPermissions` モードは使わない (使うとポリシーが迂回されるため)。

## 6. Web UI

### 6.1 レイアウト方針 (D-034)

上部タブナビゲーション + n8n 風 3-panel 詳細ビューのハイブリッド:

- **上部タブ (グローバル nav):** `Templates`, `Instances`, `Settings`。
- **List view** (Templates 一覧 / Instances 一覧): シンプルなグリッド / kanban カード。canvas や panel は使わない。
- **Detail view** (Template editor / Instance detail): 3-panel — 中央 canvas、右 sidebar (node 詳細)、下部 event log。
- **Event log の scope:** コンテキスト連動 (α 案)。Instance detail 表示中はそのインスタンスのイベント、List ページではグローバルな最近の activity。

### 6.2 スクリーンインベントリ (D-035)

Phase 1 のルート:

| Route | 種別 | 内容 |
| --- | --- | --- |
| `/templates` | List | 利用可能 template のグリッド (名前 / description / node 数) |
| `/templates/:id` | Detail | React Flow で Layer 1 canvas を描画。**Phase 1 は静的** — pan/zoom のみ、編集不可 |
| `/instances` | List | ステータス別 (running / waiting / completed) の kanban カード |
| `/instances/:id` | Detail (3-panel) | Canvas = template snapshot 上の Layer 2 overlay。右 sidebar = 選択 node の詳細。下部 = このインスタンスの event log |
| `/settings` | Placeholder | Phase 1 では空。provider 設定 / auth 状態は Phase 1.5+ |

### 6.3 Instance detail の右 sidebar タブ

Canvas で Agent Instance ノードを選択すると、右 sidebar に以下のタブが現れる:

| タブ | 内容 |
| --- | --- |
| Overview | role, status, lifetime, workspace path, current task |
| Events | この agent の `AgentEvent` ストリームを構造化レンダリング |
| Diff | この agent の worktree の `git diff <base>..<HEAD>`。ファイル一覧 + 展開でフル diff |
| Tasks | intra-instance task DAG (D-014) とそれぞれの状態 |

**Events** タブが Track A roadmap の「session attach + log stream」を兼ねる。**Diff** タブが「diff viewer」。

### 6.4 構造化イベントレンダリング

D-032 でイベントは構造化される。Phase 1 で最低限以下の render を実装する:

| イベント subtype | レンダリング |
| --- | --- |
| Assistant message | markdown テキストバブル |
| Tool use | tool 名と引数を畳めるカード |
| Tool result | tool use カードの続きにインライン表示 |
| Permission request | 強調カード + Approve / Deny ボタン (D-033) |

## 7. 既存コードとの接続点

- `packages/core/src/types/`: トラック横断の interface としてそのまま維持。adapter 型 (5.2) と `WorkspaceRef` 追加 (3.2) で軽微修正。
- `packages/runtime/`: `LocalWorktreeProvider` / `WorktreeManager` / `ClaudeCodeAgentSDKProvider` / event log writer の置き場。
- `packages/server/`: Bun HTTP/WS サーバ、Control API エンドポイント、port 5500 (D-030) で listen。
- `packages/web/`: React + React Flow + Vite UI。Section 6.2 の 5 ルート。
- `workflows/`: 既存のサンプル YAML を Phase 1 フローの driver として使う。

## 8. Phase 1 で着手しないこと (明示 defer)

| 項目 | defer の理由 | 着手時期 |
| --- | --- | --- |
| Director–Worker オーケストレーション | Phase 1 ゴールの外 (D-021/D-022 で Track A スコープを絞る) | Phase 2 |
| 最小 event log を超える Blackboard 実装 | Phase 2 領域 | Phase 2 |
| Codex / Gemini アダプタ | D-007 で Claude Code 先行 | Phase 2 |
| `WorkspaceRef.shared` の runtime | D-024 で owned のみと決定 | Phase 2 |
| ターゲット dev server port 割当 | D-029 で Phase 1 では発火しない | Phase 3 |
| PR integration / review loop UI | Phase 3 領域 | Phase 3 |
| `worktree.retentionDays` 自動掃除 | D-031 の retain デフォルトで足りる | Phase 3 |
| リモート agent 実行 / `RemoteCloneProvider` | D-023 で Phase 4 用に予約 | Phase 4 |
| `AgentProvider.attach()` と `PtyHandle` の runtime | D-032 で Agent SDK 採用、PTY 不要 | 未定 (恒久的に不要かも) |

## 9. 追加依存と D-010 チェックリスト待ち

`bun install` 前に D-010 (サードパーティ健全性監視) のチェックリストを通すべき候補:

| パッケージ | 用途 | 備考 |
| --- | --- | --- |
| `@anthropic-ai/claude-agent-sdk` | D-032 in-process Claude Code embed | Anthropic 公式。`bun audit` + 直近インシデントスキャン |
| `ulid` (もしくは同等) | D-026 の workflow / agent ID | 複数の maintained パッケージあり。アクティブなものを選定 |
| `@xyflow/react` (旧 react-flow) | Layer 1 / Layer 2 canvas | D-008 で技術選定は承認済み。具体パッケージは要チェックリスト |
| YAML パーサ (例: `yaml`) | `.legion.yaml` と workflow YAML の読込 | 小さくてメンテされているものを選ぶ |

採用前にユーザー承認を得る。

## 10. Phase 1 実装順 (案)

Track A の中の順序 (計画化時に微調整):

1. 型追加 (`WorkspaceRef`, `.legion.yaml` スキーマ, adapter 型微調整)。
2. `WorktreeManager` + `LocalWorktreeProvider` (Section 4) と scratch repo 相手のユニットテスト。
3. `.legion.yaml` ローダと setup フック実行ランナー。
4. `ClaudeCodeAgentSDKProvider` (Section 5) と Role 別 `allowedTools` プロファイル。
5. Event log writer (SQLite、D-003) と provider からのイベント emit。
6. Bun HTTP/WS サーバ (`packages/server`) と trigger / list / event-stream エンドポイント、port 5500 listen。
7. React + Vite scaffold (`packages/web`) と 5 ルート (Section 6.2)。
8. Instance detail ページ (3-panel) と live event レンダリング。
9. Diff / task ビュー。

その後 Track B:

1. Template 一覧と React Flow による Layer 1 静的 canvas。

`legion cleanup` コマンドは step 2 以降のどこかで追加可。

---

*本 spec は 2026-05-13 ブレストの設計状態を凝縮したもの。後続の決定が項目を変更・置換した場合は更新すること。*
