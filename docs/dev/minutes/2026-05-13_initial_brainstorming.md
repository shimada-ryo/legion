# 2026-05-13 Initial Brainstorming

## 出席

- User (project owner)
- Claude (Opus 4.7)

## 議題

1. legion 構想の妥当性
2. 実現性評価
3. ロードマップ草案
4. 主要 decision の確定

## 背景

User 起案のプロジェクト "legion" は、複数のコーディングエージェントをオーケストレーションして1つの実装プロジェクトを完遂させる「究極のコーディングエージェントセンター」を構築するもの。前提となる市場・技術調査は [../coding_agent_control_plane_research_2026-05-13.md](../coding_agent_control_plane_research_2026-05-13.md) にまとめられている。

User の初期構想:

- Director エージェントが Worker エージェント群（実装・テスト・監視・ナレッジ管理など役割を持つ）を指揮する。
- 各エージェントは sandbox 環境に spawn される。
- エージェント間通信はローカル（同一インスタンス内）とリモート（別インスタンス・blackboard 経由）の2層。
- Web UI で n8n / dify のようなビジュアルワークフロー構築を可能にする。
- 第一言語は TypeScript、パッケージ管理は Bun。

## 決定事項

### D-001: ターゲットユーザー

**個人開発者を主対象とする**。「ひとりの開発者でも AI によって企業並みの開発力を発揮する」がプロダクトビジョン。

含意:

- Single-tenant / local-first を前提に設計する。
- RBAC・multi-user auth・enterprise audit log の優先度は大幅に下げる。
- Single-binary 配布（`bun build --compile`）の価値を重視する。

### D-002: 中核アーキテクチャ

- **Git worktree を第一級オブジェクト**とする（業界の総意）。
- **Director–Worker pattern** を採用。CAO の `assign / handoff / send_message / review` を最小 primitive として参考にする。
- **Control Plane（Web Service 常駐）と Agent Runtime（spawned subprocess）を別 lifecycle で扱う**。
  - Control Plane: Bun の long-running server。Web UI + API + Blackboard を hosting。
  - Agent Runtime: task 単位で都度 spawn される PTY 配下のサブプロセス。
- **エージェント間通信は Blackboard を統一インタフェースとする**。ローカル通信もリモート通信も同一 API。ローカルは optimistic な local-bus optimization と位置付ける。

### D-003: データ層

- Blackboard / event log / state store は **SQLite から開始**。
- 将来 PostgreSQL + LISTEN/NOTIFY や Redis Streams への migration を視野に入れ、interface は最初から abstraction layer を介す。

### D-004: ライセンス

**Apache-2.0** を採用する。

### D-005: 言語・ランタイム

- 第一言語: **TypeScript**
- パッケージ管理 / ランタイム: **Bun**
- 理由: Claude Code CLI / Codex CLI が TS 製で adapter が書きやすく、Bun は SQLite・WebSocket・PTY・single-binary build を built-in でカバーする。

### D-006: リポジトリ構造

Bun monorepo (`bun workspaces`) で以下に分割する:

```
packages/
  core/         — types, data model, blackboard interface
  runtime/      — worktree manager, agent adapters, PTY supervisor
  server/       — Bun HTTP/WS server, control API
  web/          — React frontend
  cli/          — optional CLI for power users
```

### D-007: 初期対応プロバイダ

- **Phase 1 は Claude Code に集中**する。
- **Codex は adapter interface の design review 用途**で並行検証する。実装本格化は Phase 2。
- adapter interface は [../coding_agent_control_plane_research_2026-05-13.md:1469-1492](../coding_agent_control_plane_research_2026-05-13.md) の `AgentProvider` 案を出発点とする。

### D-008: フロントエンド技術

- **React + React Flow + Vite** を採用。
- 状態管理ライブラリは **当面採用しない**（fetch + React state hooks + WebSocket subscription で進める）。HTTP query caching の必要性が出た時点で SWR を検討する。
- **TanStack Query は不採用**（D-010 参照）。
- SvelteKit + Svelte Flow への将来移行は最適化選択肢として残す。決定的に縛らない。

### D-009: Visual Workflow Editor の扱い

- **V1 必須要件**として扱う。営業的観点・開発者モチベーション上、初期から visible な成果が必要。
- ただし実装方針は **「UI先行モック + runtime 並走」**。
  - Phase 1 で runtime（headless）と workflow editor の静的モックアップを並走で実装する。
  - Phase 2 で workflow editor が runtime を駆動する接続を行う。
- 「UI完成 → runtime 設計 → UI が runtime と齟齬発覚 → UI 再設計」のループに陥らないよう、両者の interface 設計だけは Phase 1 中に共通化する。
- 残るリスクとして R-001 に記録。

### D-010: サードパーティ依存の健全性監視ポリシー

User の指摘「サードパーティツールが健全かどうかの監視を怠ることなかれ」を decision として残す。具体策:

- 依存追加時 checklist: 最近のセキュリティインシデント、メンテナンス状況、代替の有無。
- `bun audit` を CI に組み込む。
- Renovate / Dependabot で更新を automate、ただし **メジャーバージョン更新と新規依存追加は人間承認必須**。
- `--ignore-scripts` を install の default 化（postinstall scripts は明示許可制）。
- `bun.lockb` を commit する。

トリガー事例: 2026-05-11 の TanStack supply chain attack（[TanStack Postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem)）。42 packages / 84 versions が 6 分間で侵害され、2FA・OIDC publishing・Sigstore provenance を全て備えていたにも関わらず侵害された。SLSA Build Level 3 provenance を持つ史上初の malicious npm worm。

### D-011: 議事録の置き場所

`docs/dev/minutes/{YYYY-MM-DD}_{topic}.md` 形式で残す。本ファイルが第1版。

### D-012: Workflow Editor は二層モデル

- **Layer 1 (Topology)**: 静的・設計時。ビジュアルエディタの編集対象。エージェントチームの組織図に相当。
- **Layer 2 (Execution)**: 動的・実行時。Layer 1 の上に半透明 overlay として実 instance を可視化。編集不可、監視のみ。

類似アナロジー: Kubernetes Deployment → Pods、BPMN Process Definition → Process Instances、React component → mounted instances。

### D-013: ブロックの意味は Layer により異なる

| Layer | Block | Sub-block |
|---|---|---|
| Layer 1 | **Role** (spawn 役) | なし |
| Layer 2 | **Agent Instance** | **Task / Step** |

Layer 1 の Role ノードから Layer 2 で N 個の Agent Instance が動く。Layer 2 では各 Instance の内部に Task / Step が subblock として展開される。

### D-014: Task は instance に encapsulate される

- Task の所属は単一 Agent Instance に閉じる。
- Task 間の dependency edge も intra-instance に限定する。
- **Cross-instance の調整はすべて Layer 1 のエッジ経由**で表現する（delegates / publishes / subscribes / reviews）。
- 各 Agent Instance は内部に reactor を持つ:
  - 内部 task DAG
  - Subscription handler (Blackboard 購読)
  - Inbox (delegates エッジ経由のメッセージ)
- 外部イベント到達時、reactor が新規 task を生成して内部 DAG に追加する。

つまり Instance = カプセル化境界、Layer 1 エッジ = public interface。OOP の private/public 分離と同じ哲学。

### D-015: エッジは複数種別を持つ

| エッジ種別 | 意味 | 例 |
|---|---|---|
| `triggers` | A 完了で B 起動 | Trigger → Director |
| `delegates` | A が B を spawn して subordinate にする | Director → Implementer |
| `publishes` | A が Blackboard チャネルに書き込む | Implementer → "diff-ready" channel |
| `subscribes` | A が Blackboard チャネルを購読 | Reviewer ← "diff-ready" channel |
| `reviews` | A の出力を B がレビュー | Implementer → Reviewer |
| `synthesizes` | 複数 A の出力を B が統合 | Implementers[] → Synthesizer |

UI 上は色・線種で見分ける。

### D-016: Blackboard はメタブロック (両 Layer 出現)

- Layer 1: チャネル定義（名前、schema、publisher / subscriber Role）
- Layer 2: ライブ状態（メッセージ件数、書き込み済み instance、subscriber 処理状況）

ノード種別としては Role / Agent Instance とは独立カテゴリ。

### D-017: 人間介入ノードは first-class

Approval Gate / Manual Input / Review Check-in を専用ノード種別として持つ。Blackboard と同じく両 Layer 出現するメタブロック。Layer 1 で定義、Layer 2 で活性化（「承認待ち」表示）。

調査書の review-centric UI 主張 ([../coding_agent_control_plane_research_2026-05-13.md:1561-1581](../coding_agent_control_plane_research_2026-05-13.md)) に沿う。

### D-018: Workflow Template と Workflow Instance を分離

- **Workflow Template**: 編集対象。1 プロジェクトに複数存在しうる。
- **Workflow Instance**: タスク投入時に Template から spawn される実行単位。Template の immutable snapshot を保持する。
- 編集中の Template 変更は走行中 Instance に影響しない（snapshot による分離）。
- 同時に複数 Instance を走行可能、過去完了 Instance はアーカイブとして閲覧可。

BPMN / Temporal の workflow instance モデルに準拠。

### D-019: Workflow Template は YAML ファイル + DB cache

- マスターは `workflows/*.yaml`、git でバージョン管理。
- DB (SQLite) は cache。エディタはファイルに反映する。
- 外部 workflow library を community contribution として受入可能。
- OpenRig 風の declarative topology-as-code ([../coding_agent_control_plane_research_2026-05-13.md:1126-1144](../coding_agent_control_plane_research_2026-05-13.md))。

YAML スキーマ草案:

```yaml
id: feature-implementation
name: Feature Implementation Workflow
description: Director decomposes, Implementers code, Reviewers review

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

  - id: diff-ready
    type: blackboard
    schema:
      branchUrl: string
      diff: string
      summary: string

  - id: human-approve
    type: human-gate
    label: Approve PR

  - id: pr-creator
    type: sink
    kind: github-pr

edges:
  - { from: trigger, to: director, type: triggers }
  - { from: director, to: implementer, type: delegates }
  - { from: implementer, to: diff-ready, type: publishes }
  - { from: diff-ready, to: reviewer, type: subscribes }
  - { from: reviewer, to: human-approve, type: triggers }
  - { from: human-approve, to: pr-creator, type: triggers }
```

### D-020: Role の lifetime プロパティ

Role には必須プロパティとして `lifetime` を持たせる:

- `per-task`: 1 delegate イベントで 1 instance、task 完了で消える。Implementer / Reviewer の default。
- `per-workflow`: workflow instance に 1 つ、workflow 完了で消える。Director の default。
- `persistent`: workflow を跨いで生存。Knowledge Keeper など。**実装は Phase 2 以降**。

### データモデル草案

D-012〜D-020 を反映:

```ts
// Layer 1 (Template)
interface WorkflowTemplate {
  id: string
  name: string
  nodes: TemplateNode[]      // Role | Trigger | Blackboard | Sink | HumanGate
  edges: TemplateEdge[]       // typed edges
}

interface RoleNode {
  type: 'role'
  id: string
  role: string                 // 'director' | 'implementer' | 'reviewer' | ...
  provider: string             // 'claude-code' | 'codex' | ...
  lifetime: 'per-task' | 'per-workflow' | 'persistent'
}

interface BlackboardNode {
  type: 'blackboard'
  id: string
  schema: Record<string, string>
}

interface HumanGateNode {
  type: 'human-gate'
  id: string
  label: string
}

interface TemplateEdge {
  from: string
  to: string
  type: 'triggers' | 'delegates' | 'publishes' | 'subscribes' | 'reviews' | 'synthesizes'
}

// Layer 1 を投影した実行単位
interface WorkflowInstance {
  id: string
  templateId: string
  templateSnapshot: WorkflowTemplate    // immutable copy at spawn time
  status: 'running' | 'waiting' | 'completed' | 'failed'
  agentInstances: AgentInstance[]
  blackboardChannels: BlackboardChannelState[]
  startedAt: Date
  endedAt?: Date
}

// Layer 2 内のブロック
interface AgentInstance {
  id: string
  roleNodeId: string                     // ref to RoleNode in template snapshot
  workflowInstanceId: string
  sessionId: string                      // PTY session
  status: AgentStatus
  tasks: Task[]                          // subblocks (intra-instance only)
  inbox: InboundMessage[]
  subscriptions: SubscriptionState[]
}

interface Task {
  id: string
  agentInstanceId: string
  status: TaskStatus
  dependencies: string[]                 // Task IDs, intra-instance only
}
```

## ロードマップ (草案合意)

| Phase | 期間目安 | 内容 | ゴール |
|---|---|---|---|
| 0 | 1〜2週 | Foundation: monorepo、TS設定、data model (SQLite)、adapter interface 定義 | リポジトリ起動可能 |
| 1 | 3〜4週 | Track A: worktree manager + Claude Code adapter + event log + 最小 Web UI（タスクボード / session attach / log stream / diff viewer）<br>Track B: Visual Workflow Editor の静的モックアップ | Claude Code を worktree 単位で並列運用可能 + Workflow Editor が動かない見た目で触れる |
| 2 | 4〜6週 | Director–Worker orchestration + Blackboard service + Worker role profile + Codex adapter + Workflow Editor の runtime 接続 | 1つの中規模タスクを Director が分解し、3〜5 agent が blackboard 経由で連携 |
| 3 | 3〜4週 | Review loop + PR integration + CI feedback + Best-of-N | review-centric UI の完成。Conductor / Vibe Kanban と機能パリティ |
| 4 | TBD | Remote agent execution、Docker isolation オプション、Slack / Linear / GitHub triggers | 分散構成・外部 trigger 対応 |
| 5 | TBD | enterprise readiness（必要に応じて） | RBAC・audit log・MCP allowlist |

## 持ち越し / 未決事項

- **O-001**: 商用化方針 / OSS のままか。Vibe Kanban shutdown precedent（[research:692-694](../coding_agent_control_plane_research_2026-05-13.md)）を踏まえ後日議論。当面は OSS Apache-2.0 で進める。
- **O-002**: TanStack 代替を SWR に切り替える timing。Phase 1 では何も入れない。実需が出てから判断。
- **O-003**: Agent sandbox 強化のレベル感（worktree 分離だけで止めるか、Docker container / 別 VM まで行くか）。Phase 4 で本格議論。
- ~~**O-004**: ビジュアルワークフローにおける agent block の semantic（データフロー / 制御フロー / メッセージング / 動的子ブロック生成）。Phase 1 のモック設計時に詰める。~~ → **Resolved by D-012〜D-020 (Round 7〜10)**
- **O-005**: MCP server / client としての対応範囲。Phase 2〜3 で再検討。

## リスク

- **R-001**: Visual Workflow Editor を V1 必須にすることで、UI 設計が runtime 設計に先んじて固まり、後で齟齬が発覚するリスク。Mitigation: D-009 の並走戦略 + interface 共通化を Phase 1 中に行う。Claude はこのリスクが顕在化した場合に再提案する権利を持つ。
- **R-002**: 個人開発者向け OSS coding agent center の収益化困難。Vibe Kanban が 26.2k stars でも商用化失敗した precedent あり。当面は気にしない（個人プロジェクトとして開始）が、いずれ判断が必要。
- **R-003**: 上流依存の supply chain attack（TanStack 事例）。D-010 のポリシーで軽減するが、ゼロにはできない。

## 議論ログ（要約）

### Round 1: Claude による初期評価

- 調査書の3つの最重要点を強調: ① review が主戦場、② worktree が第一級、③ 統合決定版はまだない。
- legion 構想の強み: 役割分担パターンの妥当性、Blackboard 型リモート通信の独自性、TS + Bun の妥当性。
- 懸念: Visual Workflow を初期目標に据える危険性、sandbox レベル感の曖昧さ、local/remote 通信の抽象化。
- ロードマップ草案 Phase 0〜5 を提示。
- 6つの decision 論点を提起。

### Round 2: User 回答

1. ターゲット = 個人開発者
2. Blackboard = SQLite から
3. Visual Workflow = V1 必須、UI 投機実装も許容希望
4. Provider = Claude Code 中心 + adapter 検証用に Codex
5. Vibe Kanban sunset の件は持ち越し
6. Web Service だが agent runtime は別

### Round 3: Claude の反論と詳細化

- 論点3「Visual Workflow V1 必須」に対し、Claude は「UI完成 → runtime と齟齬 → UI 再設計」のループ risk を提示し、**「UI先行モック + runtime 並走」** を対案。
- Vibe Kanban sunset 事例を要約（26.2k stars → 商用化失敗）。
- Control Plane と Agent Runtime の lifecycle 分離を明示。
- 論点7（monorepo 構造）と論点8（フロントエンド技術）を追加で提起。

### Round 4: User 回答

- 論点3 → 並走案で合意（"私もUIを最初から作る切るつもりではなく、並走予定だった"）
- 論点5 → Apache-2.0
- 論点7 → 提案通り monorepo
- 論点8 → React Flow OK、SvelteKit は将来選択肢として残す。**「TanStack は今攻撃を受けている」と Claude に警告**。「サードパーティの監視を怠ることなかれ」と釘を刺す。

### Round 5: Claude による TanStack 攻撃の調査と stack 修正提案

- 2026-05-11 の Mini Shai-Hulud 攻撃を要約。42 @tanstack/* packages が 6 分間で侵害された経緯と、ベストプラクティスを尽くしていても防げなかった点を確認。
- TanStack Query 不採用を提案。代替3案（SWR / Zustand+fetch / 何も入れない）から「何も入れず Phase 1 を進める」を推奨。
- サードパーティ監視ポリシー（D-010）を decision として提起。

### Round 6: User 回答

- 代替案3（何も入れない）で合意。
- 議事録第1版起こしの GO サイン。

### Round 7: O-004 着手 - Claude による二層モデル提案

- Workflow editor の semantic 設計を議論開始。
- n8n / dify 比喩がコーディングエージェントの非決定性と齟齬を起こす点を再強調。
- **二層モデル (Layer 1: Topology / Layer 2: Execution)** を提案。
- ノード種別（Trigger / Agent Role / Coordination / Sink）、エッジ種別（triggers / delegates / publishes / subscribes / reviews / synthesizes）の候補を提示。
- ループ・動的spawn・人間介入の扱いを論じる。
- Q-1〜Q-5 を提起。

### Round 8: User 回答

- Q-1 (二層モデル) → 採用
- Q-2 (ブロックの意味) → **Layer ごとに異なる**。Layer 1 = Role、Layer 2 = Agent Instance、Instance 内に Task/Step subblock。Claude の整理よりも高い解像度。
- Q-3 (エッジ種別) → Q-2 を踏まえれば自ずと決まる
- Q-4 (Blackboard ノード化) → Yes
- Q-5 (人間介入 first-class) → Yes

### Round 9: Claude による精緻化と新規論点

- Q-2 の整理を発展させ、Layer 1 ⇄ Layer 2 を overlay モデルとして定式化。
- Task dependency edge が instance を跨ぐ可能性を指摘。
- Blackboard と人間介入ノードを「両 Layer 出現するメタブロック」と位置付け。
- 新規論点 Q-6 (Workflow Template / Instance 分離)、Q-7 (Template の保存形式) を提起。

### Round 10: User 回答 + Claude の Q-2 修正受入

- **Q-2 補足**: Task dependency edge を instance 跨ぎとしない。**Instance が外部イベントを reactor で吸収し、内部 task を生成**する形に統一。Encapsulation 哲学。Claude はこの整理を採用。
- Q-6 → (Y) Template / Instance 分離を採用
- Q-7 → (Q) YAML ファイル + DB cache を採用
- Q-8 (Role lifetime プロパティ) → Claude 提案通り採用

## 次のアクション

1. Phase 0 着手準備:
   - monorepo 骨格作成、`package.json` / `tsconfig` / `bun workspaces` 設定、初期 README / LICENSE (Apache-2.0) 配置
   - `packages/core/` に D-014 / D-019 のデータモデルを TS 型として配置
   - `packages/core/` に Adapter interface (`AgentProvider`) の TS 型定義（[../coding_agent_control_plane_research_2026-05-13.md:1469-1492](../coding_agent_control_plane_research_2026-05-13.md) を出発点に）
   - `packages/core/` に Blackboard interface の最小スケッチ
   - `workflows/` ディレクトリ作成、サンプル workflow YAML を 1〜2 個配置
2. 次回 brainstorming のテーマ候補:
   - Phase 0 着手前の repo 構造詳細（命名、tooling、CI 方針、commit / branch 規約）
   - エージェント間メッセージのペイロード schema 設計
   - Worktree 命名規約 / lifecycle 詳細
   - Web UI の画面構成（Workspace / Templates / Instances / Sessions の階層）

---

*議事録は会話のスナップショット。意思決定の根拠は本文の決定事項を参照し、ログ部分は補助的な経緯として扱う。*
