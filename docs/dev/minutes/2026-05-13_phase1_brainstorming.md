# 2026-05-13 Phase 1 Brainstorming

## 出席

- User (project owner)
- Claude (Opus 4.7)

## 議題

引き継ぎ書 ([../handoff/2026-05-13.md](../handoff/2026-05-13.md)) で Phase 1 用に挙がった 4 トピックを順に詰める。

1. Worktree 命名規約 / lifecycle
2. Claude Code adapter 実装戦略
3. Web UI 画面階層
4. Track A / Track B 進行順 (本ファイルではこのトピックから着手)

## 決定事項

### D-021: Phase 1 Track A / Track B の進行は「順序連続」

- 時期スライス交互ではなく、片方を区切るまで集中し、終わってから次に着手する。
- 唯一ソロ + AI 開発という現実 (時期並走はコンテキスト切り替えコストが大きい) を踏まえる。
- D-009 の「並走」は概念上の並走であって実作業上の時期並走を意味しない、と整理。

### D-022: Track A (headless runtime) を先行

- Phase 1 では Track A (worktree manager + Claude Code adapter + event log + 最小 Web UI) を先に完成させてから Track B (Visual Workflow Editor の静的モックアップ) に着手する。
- 理由: R-001 (UI が runtime に先んじて齟齬発覚) を防ぐ唯一の根本策が「先に runtime を成立させる」こと。D-014 の Instance encapsulation が実装で本当に成立するかは runtime を書かないと検証不能。
- 静的モックアップは `packages/core/src/types/` の型が固まっていれば短期で作れる。逆 (型だけで runtime 検証) は成り立たない。

### D-023: D-002 の「worktree 第一級」を再解釈 — `AgentWorkspace` を概念第一級とする

- D-002 の元文言「Git worktree を第一級オブジェクトとする」を **ローカル実装上の選択** として読み替える。
- runtime API レイヤでは **`AgentWorkspace`** を抽象化として置き、その実装を環境に応じて切り替える:
  - Phase 1: `LocalWorktreeProvider` (`git worktree add` を使う)
  - Phase 4: `RemoteCloneProvider` (`git clone` + 中央 git を使う)。リモート分散時はファイルシステム共有不可能なので worktree は物理的に不可能。
- worktree が clone に対して持つ優位は本質的に「`.git` 共有」由来:
  - Director 観測性 (`git log --all` で全 Implementer ブランチが即座に見える)
  - Reviewer の差分取得 (`fetch` 不要で `git diff` 可能)
  - 巨大 repo でのディスク・セットアップコストの差
- 「同一ブランチを2つの worktree に check out できない」制約は legion の運用では発火しない (Implementer は task ごとに独立ブランチ、Director は `--detach`、Reviewer は対象ブランチを `--detach` で参照)。
- 結論: 「worktree 第一級」を「ローカル実装の最適選択であって、概念第一級は `AgentWorkspace`」と読み替える。

### D-035: Phase 1 のスクリーンインベントリ

- 5 画面構成:

  | Route | 種別 | 内容 |
  | --- | --- | --- |
  | `/templates` | List | Template (YAML) の一覧。grid of cards |
  | `/templates/:id` | Detail | Layer 1 canvas (React Flow)。Phase 1 は静的モックアップ、編集不可、pan/zoom のみ |
  | `/instances` | List | Instances の task board (running / waiting / completed)。kanban カード |
  | `/instances/:id` | Detail (3-panel) | フル 3-panel。Canvas = Layer 2 overlay、右 sidebar = node 選択時の詳細、下 = event log |
  | `/settings` | Placeholder | Phase 1.5 以降 |

- Instance detail (`/instances/:id`) の右 sidebar タブ:

  | タブ | 内容 |
  | --- | --- |
  | Overview | role / status / lifetime / workspace path / current task |
  | Events | この agent の AgentEvent stream (構造化レンダリング) |
  | Diff | この agent の worktree の `git diff base..HEAD` |
  | Tasks | intra-instance task DAG (D-014) の状態 |

- `Events` タブが Track A の "session attach + log stream" を兼ねる。
- `Diff` タブが Track A の "diff viewer"。
- D-032 の Agent SDK 採用により、Events は ANSI 出力ではなく structured event (assistant message / tool use / tool result / permission request) として render。

### D-034: UI layout = top tabs (A) + n8n 風 3-panel (C) のハイブリッド、context-scoped event log

- Top-level navigation: 上部タブで `Templates` / `Instances` / `Settings` を切替 (GitHub Actions / Vercel 風)
- Detail view は n8n 風の 3-panel: canvas (中央) + node details (右 sidebar) + event log (下部)
- List view は単純なグリッド / カード表示で 3-panel は使わない (表示するものが無い)
- Event log の scope はコンテキスト連動 (α 案):
  - Instance detail 表示中はそのインスタンスの events
  - Templates/Instances list 表示中は global recent activity
- 「Event log を常に表示したい」「node 詳細も表示したい」という User 要望に応える形。

### D-033: Approval policy = Role 別プロファイル + 例外は human-gate へ escalate

- 各 Role に default の `allowedTools` プロファイルを持たせる:
  - Director: `Read` / `Glob` / `Grep` 等の参照系のみ (タスク分解者の責務に閉じる)
  - Implementer: `Read` / `Edit` / `Write` / `Glob` / `Grep` / `Bash(test 系)` 等の編集系を許可
  - Reviewer: 参照系のみ (書き手ではない)
- ツール呼び出しが範囲外なら `PreToolUse` hook で blackboard に `permission_request` を publish、UI で human が承認 / 拒否。
- Role 単位の `allowedTools` は workflow YAML に書ける (個別 override 可能)。
- D-013 / D-014 の Role 責務分離哲学と整合: Role が agent の権能を限定する = 公開 interface を絞る。

### D-032: Claude Code adapter = Agent SDK 直接 embed (`@anthropic-ai/claude-agent-sdk`)

- 採用パターン: `query()` 関数を in-process で呼び、`AsyncIterable<Message>` を消費する。
- 裏取り (claude-code-guide エージェントの調査) で判明した事実:
  - `--input-format stream-json` の制御プロトコルが未公開 (issue #24594) → subprocess + stdin での dynamic approval は不可
  - stream-json モードでは permission_request イベントを受信できても stdin から approve できない (issue #54850)
  - Anthropic 公式は orchestration 用途で Agent SDK を推奨
  - Agent SDK は Claude Code と**同じエージェントループ**を embed (CLI 経由と挙動同一)
- 選んだ理由:
  - `PreToolUse` hook で dynamic approval が綺麗に書ける
  - structured TypeScript message stream、JSON parse 不要
  - `resume: sessionId` で session 再開、`workingDirectory` / `allowedTools` / `permissionMode` / `model` を options で渡せる
  - CLI subprocess の場合に必要な追加 MCP server や ANSI parser が不要
- 失うもの (プロセス分離): `try/catch` で当面緩和。Phase 2+ で Bun worker thread に切り出して isolate 検討。
- 既存 `AgentProvider` 型 ([packages/core/src/types/agent-provider.ts](../../../packages/core/src/types/agent-provider.ts)) のうち `attach()` と `PtyHandle` は Phase 1 では未実装。`supportsAttach: false` を report する。
- 新規依存: `@anthropic-ai/claude-agent-sdk` (Anthropic 公式 npm)。D-010 の monitoring policy に則り採用前にユーザー確認済み。

### D-031: Cleanup policy = retain by default、明示削除コマンド

- Workflow 完了で worktree dir / branch は自動削除しない。残す。
- `legion cleanup` コマンド (CLI / Web UI) で明示削除。安全装置として「branch がマージ済み or commit なし」のみ自動削除可能、他は警告して確認。
- 理由: Phase 1 は agent の動作観察と debug が最優先。「あのとき何があったか」を後追いできる方が重要。
- Phase 3 で PR integration を入れる頃、自動掃除ルール (`.legion.yaml: worktree.retentionDays`) を足す想定。

### D-030: legion 自身の Bun サーバの default port = 5500

- legion 本体の HTTP / WS サーバが listen するポート。Web UI / Control API を提供する。
- `--port` フラグで上書き可能。
- 5500 は一般的なツールと衝突しにくい番号。

### D-029: ターゲット開発プロジェクトの dev server port は Phase 1 で defer

- Phase 1 の agent はコード編集・テスト・typecheck のみ。長時間 dev server を立てるシーンが無い。
- 並列 worktree で `bun dev` を同時に立てるユースケースは Phase 3 の review loop 段階で再議論。
- 設計上の余地として `.legion.yaml` のスキーマで `worktree.ports` 領域を予約のみ。Phase 1 では runtime 実装しない。
- 議論の途中で User から「何のポートか」確認あり: TCP/IP ポートで、ターゲット開発プロジェクトのサーバが listen するためのもの (legion 自身の制御ポートとは別)、と整理。

### D-028: Worktree 作成後の setup フックを `.legion.yaml` に宣言

- repo root の `.legion.yaml` で setup フックを宣言、worktree 作成時に実行。不在時は no-op。
- 最小スキーマ:

  ```yaml
  worktree:
    setup:
      - bun install
    copyFiles:           # gitignored だが必要なファイル (.env.local 等)
      - .env.local
  ```

- worktree 作成時の処理順:
  1. `git worktree add` でディレクトリ作成
  2. `copyFiles` で main checkout から該当ファイルを copy
  3. `setup` の各コマンドを worktree cwd で逐次実行
  4. 完了したら agent を spawn

### D-027: Worktree の base branch = trigger 時にユーザー指定、default は HEAD、SHA snapshot

- Workflow trigger 時にユーザーが base branch を選択可能。default は repo の現 HEAD ブランチ。
- 起点は **trigger 時の commit SHA に固定** (スナップショット)。「main の最新を都度追従」ではない。
- 利点: 同一 workflow instance の全 Implementer が同じ起点から分岐 (D-014 Instance encapsulation と整合)。再現性が保たれる。走行中に main が動いてもこの workflow は影響を受けない。
- 最新を追従したい場合は再 trigger で対応。

### D-026: Branch 命名規約 = `legion/<wfShortId>/<role>-<seq>`

- 例:
  - `legion/wf01j9x/director`
  - `legion/wf01j9x/impl-1`
  - `legion/wf01j9x/impl-2`
  - `legion/wf01j9x/reviewer-1`
- `legion/` prefix で grep 可能。
- `wfShortId` = ULID の先頭 8 文字。ULID 採用で時系列ソート可能、衝突確率は実用上ゼロ。
- `<role>-<seq>` で役割と並列インデックスを表現。
- Director / Reviewer は branch なしの `--detach` worktree なので、ブランチ命名規約の適用対象は Implementer (および将来 commit する Role) のみ。
- Workflow 名 slug を含めるか検討したが、workflow の rename で意味がぶれるので Phase 1 は ID のみで割り切る。

### D-025: Worktree 物理配置 = 設定可変、デフォルト `~/.legion/worktrees/<repo-fingerprint>/<wf-id>/<agent-id>/`

- `<repo-fingerprint>` は同じ basename の複数 repo を区別するため `${repoBasename}-${shortHashOfFullPath}` 形式とする。
- 設定 (将来の `~/.legion/config.yaml` 等) で base path を上書き可能。
- デフォルトをホーム配下にする理由:
  - repo 内汚染リスクをゼロにできる (D-010 の健全性監視精神と整合)
  - cleanup を `rm -rf ~/.legion/worktrees` で一括実行可能
  - 複数 repo を一元管理

### D-024: AgentWorkspace は Agent Instance と 1:1 対応 (Phase 1 は `owned` のみ実装)

- データモデル:

  ```ts
  type WorkspaceRef =
    | { kind: 'owned'; path: string; branch?: string }
    | { kind: 'shared'; targetInstanceId: string; mode: 'ro' | 'rw' }
  ```

- 「1:1」は「Instance 1 個に WorkspaceRef 1 個」という意味。WorkspaceRef の中身は `owned` か `shared` かを切り替えられる。
- Phase 1 は `owned` だけ runtime 実装する。`shared` は型定義は用意するが runtime 実装は後回し。
- Role ごとの想定構成:

  | Role | lifetime | Workspace 構成 | 何を見るか |
  | --- | --- | --- | --- |
  | Director | per-workflow | `owned`, `--detach` で workflow 開始 commit | 全 worker のブランチを `git log --all` で観測 |
  | Implementer | per-task | `owned`, 専用ブランチ | 自分のブランチを編集・commit |
  | Reviewer | per-task | `owned`, `--detach` で対象 Implementer ブランチの HEAD | committed state のみレビュー |

- 「Reviewer が Implementer の Workspace を共有する」は将来的に `shared` を実装すれば表現可能だが、Phase 1 は不要 (D-015 の `reviews` edge は publish 済みを consume する semantics で、committed state で足りる)。

## 持ち越し / 未決事項

(本セッション中に新規発生したものを追記する)

## リスク

(本セッション中に新規発生したものを追記する)

## 議論ログ (要約)

### Round 1: トピック選定

- 引き継ぎ書の4トピックのうち、トピック4 (Track A/B 進行順) が他3つの優先度を決めるメタ議題と整理し、最初に着手。

### Round 2: 並走の意味と先行 Track

- 「並走」をソロ開発で運用する案として 3 つ提示 (時期交互 / 順序連続 / 縦型スライス) → 順序連続で合意 (D-021)。
- 先行 Track の選定: Track A vs Track B vs 中間 (interface lock を先行) の 3 案。R-001 が中核懸念なので Track A 先行を推奨 → 合意 (D-022)。

### Round 3: Worktree-Instance 対応の最初の提示

- Claude が「1 Instance = 1 Worktree (均一)」「書き手 Role のみ Worktree」「Workflow + タスクごと」の 3 案を提示。
- User が worktree とは何か (git worktree と同じか) を確認。Claude が git worktree の定義と legion での扱いを整理。

### Round 4: User の根本的なpushback — clone か worktree か

- User: 「worktree は clone を軽量にしたものという認識しかない。同一ブランチ制約はあるが remote では無い。clone か worktree かの戦略はどこで効くのか？全部リモートなら clone で済むのでは？」
- これを受けて Claude は D-002 を再解釈し、概念第一級を `AgentWorkspace` に格上げ、Phase 1 は worktree 実装、Phase 4 は clone 実装、という抽象化を提示 → D-023 として確定。

### Round 5: 1:1 モデルへの再着地

- AgentWorkspace 抽象化のもと、1:1 / 書き手のみ / Workflow+タスク の 3 案を再提示。
- User: 「1:1 構想は他案 (director や reviewer が implementer workspace を共有する) もできることを含んでいるのか？」
- Claude: WorkspaceRef を `owned` / `shared` の両形態を持つ型として定義することで、1:1 を保ちつつ shared も将来表現可能。Phase 1 は `owned` のみ実装、を推奨 → D-024 として確定。

### Round 6: Worktree 詳細 (配置・命名・base・setup・port・cleanup) を順次確定

- 配置 (D-025): 設定可変、デフォルト `~/.legion/worktrees/<repo-fp>/...`
- 命名 (D-026): `legion/<wfShortId>/<role>-<seq>`
- base branch (D-027): trigger 時にユーザー指定、default は HEAD、SHA snapshot
- setup (D-028): `.legion.yaml` の `worktree.setup` / `worktree.copyFiles` フック
- port (D-029, D-030): ターゲット dev server port は Phase 1 で defer。legion 自身の default port は 5500
  - 議論の途中で User から「何のポートか」確認あり: TCP/IP ポート (ターゲット dev server) と legion 自身の listen port を整理して説明
- cleanup (D-031): retain がデフォルト、`legion cleanup` で明示削除

### Round 7: Claude Code adapter 戦略 (Topic 2)

- 5 パターン (PTY / `claude -p` / stream-json / Agent SDK / MCP server) を提示。
- 初期推奨は subprocess + stream-json (C 案) だったが、User が裏取りを要望。
- `claude-code-guide` エージェントで現状調査:
  - `--input-format stream-json` の制御プロトコル未公開
  - stream-json モードで stdin approval 不可
  - Anthropic 公式は Agent SDK を orchestration 推奨
  - Agent SDK = Claude Code と同じエージェントループの in-process 版
- 推奨を Agent SDK 直接 embed (D 案) に切り替え → D-032 確定。
- 続けて approval policy framework を Role 別プロファイル + human-gate escalate に → D-033 確定。

### Round 8: Web UI 画面階層 (Topic 3)

- top-level nav を (A) タブ / (B) サイドバー / (C) n8n 風 3-panel の 3 案で提示 (preview 付き)。
- User: 「(A) と (C) のハイブリッドで進めたい。event log は常に表示、node 詳細も表示したい」
- Claude: 異論なし。ただし List view と Detail view で layout 強度を分け、event log の scope はコンテキスト連動 (α) を refinement として提案 → D-034 確定。
- Phase 1 のスクリーンインベントリ (5 画面 + sidebar 4 タブ) を提示 → D-035 確定。

## 次のアクション

1. Phase 1 設計ドキュメント (spec) を `docs/dev/specs/2026-05-13_phase1_design.md` 等に整理し、本 brainstorming の結論を実装着手者が読めるサマリにする。
2. Phase 1 実装計画 (writing-plans skill) を起こす。Track A の構成要素 (worktree manager / Claude Code adapter / event log / 最小 Web UI) を粒度ある step として配列。
3. `@anthropic-ai/claude-agent-sdk` 採用 (D-032) に伴う `bun install` の前に、D-010 の依存追加 checklist を実施 (メンテナンス状況、最近のインシデント、代替確認)。
4. `packages/core/src/types/agent-provider.ts` を D-032 / D-033 に合わせて調整 (PtyHandle / attach の扱い、Capabilities への `supportsApprovalFlow` の意味付け確定)。
5. `.legion.yaml` のスキーマ案 (D-028) を `packages/core` に型として落とす。
6. ULID 採用 (D-026) のため依存追加が必要 → D-010 checklist を経由して確認。

---

*ステータス: Phase 1 brainstorming トピック全完了 (Topic 1-4)。次は spec 起こし → writing-plans skill による実装計画作成 → 実装。*
