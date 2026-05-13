# コーディングエージェント・コントロールプレーン調査レポート

調査日: 2026-05-13 JST  
目的: Claude Code、OpenAI Codex、GitHub Copilot coding agent、Gemini CLI、OpenCode、Cursor Agent などを横断的に制御し、長時間・並列・役割分担型の開発タスクを実行する「究極のコーディングエージェントセンター」を実装するための公開情報整理。  
前提: 本レポートは公開 Web 情報ベース。公式ドキュメント、公式顧客事例、企業公式ブログ、OSS リポジトリ、第三者レビューの順に信頼度を重くした。

---

## 0. エグゼクティブサマリー

### 0.1 結論

この領域には既に多数の製品・OSS が存在する。しかし、2026-05-13 時点で「Claude Code / Codex / GitHub Copilot / Gemini / Cursor / OpenCode などを横断し、n8n や Dify のように成熟した単一コントロールプレーンとして、企業導入実績まで厚い決定版」はまだ見当たらない。

公開情報で確認できた最も強い実績は、既製コントロールプレーンそのものではなく、次の二系統である。

1. **個別コーディングエージェントの企業導入**
   - Claude Code: Ramp、Rakuten、Classmethod、Anthropic 社内など。
   - Codex: Datadog、CyberAgent、Rakuten、OpenAI 社内など。
   - GitHub Copilot coding agent: GitHub 公式発表で Carvana と EY のコメントを確認。
2. **worktree + 複数エージェントの社内運用**
   - incident.io が Claude Code + Git worktrees により 4〜5 個の Claude agent を同時に走らせていることを公式ブログで説明。
   - Canopy 開発元 IT SOL が 10+ Claude Code セッション、13+ PR branches / worktrees を日常運用していると公式に説明。

一方、Conductor、Vibe Kanban、CAO、Claude Squad、Crewly、Superset、1Code、Emdash などの「コントロールプレーン製品」については、機能面では非常に近いものがあるが、外部企業の正式導入ケーススタディはまだ薄い。つまり、市場は **技術的には立ち上がっているが、導入実績は未成熟** である。

### 0.2 エンジニア向けの実装方針

実装チームに渡すべき要点は以下。

- 中核プリミティブは **Git worktree + agent session + task graph + event log + diff/PR review**。
- agent adapter は必須。Claude Code、Codex CLI、Copilot CLI、Gemini CLI、OpenCode、Cursor Agent を同じセッション API に見せる。
- 実行基盤は初期はローカル PTY / tmux / pseudoterminal でよいが、最終形は cloud sandbox / devcontainer / remote VM も必要。
- UI は Kanban だけでは足りない。最低でも「タスクボード」「セッション状態」「ログ」「差分」「PR / CI」「コスト / トークン」「権限待ち」「人間介入ポイント」を統合する。
- 参考実装として最重要なのは **AWS Labs CLI Agent Orchestrator、Conductor、Vibe Kanban、Claude Squad、Canopy、Claude Code agent teams / agent view、OpenAI Codex app、MCO / Roundtable / Claw Orchestrator**。
- 企業利用に耐えるには、単なるプロセス起動ではなく **監査ログ、権限、シークレット保護、ブランチ保護、承認フロー、prompt injection 対策、MCP サーバー安全性** が必要。

---

## 1. 調査対象と信頼度基準

### 1.1 調査対象カテゴリ

- 公式プラットフォーム型
  - GitHub Agent HQ / Agent Control Plane
  - GitHub Copilot coding agent
  - OpenAI Codex app / Codex cloud / Codex CLI
  - Claude Code agent view / agent teams / subagents / worktrees
- ローカル GUI / TUI 型
  - Conductor
  - Vibe Kanban
  - Canopy
  - Claude Squad
  - Superset
  - 1Code
  - Emdash
  - Agentastic.dev
  - Orca
  - webmux
  - Commander
  - CCManager
  - Hive
  - Rift
- OSS オーケストレーション基盤型
  - AWS Labs CLI Agent Orchestrator
  - Crewly
  - MCO
  - Roundtable
  - OpenRig
  - Claw Orchestrator
  - Agor
  - metaswarm
  - Bernstein
- 標準 / 周辺技術
  - MCP
  - AGENTS.md
  - CLAUDE.md / repository instructions
  - Agent skills / subagents / role prompts
  - Git worktrees
  - GitHub Actions / CI / PR review integration

### 1.2 信頼度ランク

| ランク | 意味 | 例 |
|---|---|---|
| S | 導入・利用主体の公式情報、またはベンダー公式顧客事例。利用内容と指標が具体的。 | Ramp x Claude Code、Datadog x Codex、incident.io 公式ブログ |
| A | 公式ドキュメント、公式プロダクト発表、開発元の dogfooding、named testimonial。 | GitHub Agent HQ、Canopy / IT SOL、Conductor testimonials |
| B | OSS リポジトリ、GitHub stars、Product Hunt、第三者レビュー。利用シグナルはあるが導入規模不明。 | Claude Squad、Vibe Kanban stars、Ry Walker reviews |
| C | SEO 型ディレクトリ、匿名レビュー、未検証の採用 claim。発見用途のみ。 | 一部のツールディレクトリ、二次まとめ |
| 保留 | 製品や OSS は存在するが、導入例として信用できる情報が見つからない。 | 多くの新興 orchestrator |

---

## 2. 導入・利用実績リスト: 信頼度順

### 2.1 S ランク: 企業・組織の具体的利用が確認できる情報

#### 2.1.1 Ramp: Claude Code の大規模導入

**対象**: Claude Code  
**種別**: Anthropic 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: 既製コントロールプレーンではないが、並列エージェント運用・チケット連携・MCP・incident response など、今回作るべき製品の要求を強く裏付ける。

**確認できた内容**

Anthropic の公式顧客事例で、Ramp は Claude Code により以下を達成したとされる。

- 30 日で 100 万行以上の AI-suggested code を実装。
- Engineering 全体で 50% weekly active usage。
- incident investigation time を最大 80% 削減。
- 複数 Claude Code sessions を同じ codebase 上で同時実行し、各セッションが別タスクを担当する parallel development workflows を実施。
- Datadog、Sentry などの observability stack と MCP server を接続し、incident triage に利用。
- project management system から ticket context を Claude Code に渡して実装させる ticket-to-code automation を実施。

**実装への示唆**

- エージェントセンターには「チケット → context package → agent task → PR / review」パイプラインが必要。
- incident response / debugging タスクは coding 以外の高価値ユースケース。
- MCP 統合は必須。ただし権限管理とログの redaction が重要。
- 並列 session だけでなく、workflow automation と observability 接続まで含めると企業価値が上がる。

**情報源 URL**

- https://www.anthropic.com/customers/ramp
- https://www.claude.com/customers/ramp

---

#### 2.1.2 Rakuten: Claude Code による開発高速化

**対象**: Claude Code  
**種別**: Anthropic 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: 既製コントロールプレーンではないが、長時間自律 coding と大企業導入の根拠。

**確認できた内容**

Anthropic 公式顧客事例によると、Rakuten は Claude Code を使って以下を達成したとされる。

- 複雑な OSS refactoring project で 7 時間の sustained autonomous coding。
- 新機能の time to market を 24 日から 5 日へ、79% 短縮。
- 複雑な code modifications で 99.9% accuracy を達成。

**実装への示唆**

- 長時間 agent task を扱うには session persistence、checkpoint、resume、interrupt、progress visibility が必須。
- 大企業導入では、セキュリティと監査、制御された autonomous mode が必要。
- 7 時間級のタスクを扱う UI では、現在状態、待ち状態、失敗状態、次アクションが明確でなければならない。

**情報源 URL**

- https://www.anthropic.com/customers/rakuten

---

#### 2.1.3 Classmethod: Claude Code の日本企業導入

**対象**: Claude Code  
**種別**: Claude 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: 日本企業の導入事例として重要。GitHub issue-based implementation、self-review、review command などがコントロールプレーン要件に近い。

**確認できた内容**

Claude 公式顧客事例によると、Classmethod は Claude Code を development lifecycle に統合している。確認できた内容は以下。

- 既存 codebase の理解を 90% 高速化。
- GitHub ISSUES-based implementation と test descriptions に Claude Code を利用。
- mandatory AI-powered self-review を複数プロジェクトに段階導入。
- `/explain-pr` や `/review-pr` により PR context と feedback を得る。
- Ruby on Rails、Next.js、Terraform などに利用。

**実装への示唆**

- 日本企業向けには GitHub issue / PR を軸にした導線が刺さる。
- self-review / explain-pr / review-pr は標準コマンドとして実装する価値が高い。
- Terraform など IaC への対応は enterprise adoption で重要。

**情報源 URL**

- https://www.claude.com/customers/classmethod

---

#### 2.1.4 Anthropic 社内: Claude Code の組織横断利用

**対象**: Claude Code  
**種別**: Anthropic 公式記事  
**信頼度**: S。ただし vendor internal story なので第三者顧客事例ではない。  
**コントロールプレーンとの関係**: エンジニア以外の利用、GitHub Actions、data workflow、design implementation などの拡張ユースケースを示す。

**確認できた内容**

Anthropic は Data infrastructure、Product development、Security engineering、Inference、Data science、Product engineering、Growth marketing、Product design、RL engineering、Legal など複数チームで Claude Code を利用していると説明している。

具体例:

- Kubernetes debugging。
- 非エンジニアが plain text workflow を書き、Claude Code にデータ処理を実行させる。
- 新入社員の codebase navigation。
- Product Engineering が task の first stop として Claude Code を利用。
- Product Design が frontend polish や state management changes を直接実装。
- GitHub Actions automated ticketing で issue から code solution を生成。

**実装への示唆**

- coding-agent center は「エンジニアだけのツール」に閉じない可能性がある。
- チームごとの role / permission / workflow template が必要。
- GitHub Actions / issue automation は、製品の中核トリガーにすべき。

**情報源 URL**

- https://www.anthropic.com/news/how-anthropic-teams-use-claude-code

---

#### 2.1.5 incident.io: Claude Code + Git worktrees による複数 agent 並列運用

**対象**: Claude Code + Git worktrees + 自作 shell workflow  
**種別**: incident.io 公式エンジニアリングブログ / podcast  
**信頼度**: S  
**コントロールプレーンとの関係**: 今回の製品構想に最も近い実運用レポートの一つ。既製品ではなく自作 workflow だが、実装要件が具体的。

**確認できた内容**

incident.io は公式ブログで、Claude Code 導入後に 4〜5 個の Claude agents を同時に走らせ、別々の features を並列実装していると説明している。Git worktrees を使い、各 Claude Code session が別 branch / directory で動く。`w` という bash function を作り、worktree 作成、branch 作成、Claude 起動、git 操作を簡略化している。

例:

- `w myproject new-feature claude` で isolated branch 上に Claude Code window を起動。
- API generation commands の改善で $8 の Claude credit を使い、30 秒 / 18% の build time 改善。
- internal product feedback channel から Linear ticket、Claude prototype、CI preview、Slack thread への preview link 返却という将来構想を提示。

**実装への示唆**

この事例は「人間が複数エージェントを使い始めると、最初に worktree manager が必要になる」ことを示す。プロダクト化する場合、以下が必要。

- worktree lifecycle manager
- branch naming
- setup script
- per-worktree dev server / port
- agent launch shortcut
- session status
- PR / CI / preview feedback loop
- Slack / Linear trigger

**情報源 URL**

- https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees
- https://incident.io/thedebrief/shipping-with-claude-code-and-worktrees

---

#### 2.1.6 Datadog: Codex を system-level code review に利用

**対象**: OpenAI Codex  
**種別**: OpenAI 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: 実装タスクだけでなく、レビュー / incident prevention が重要ユースケースであることを示す。

**確認できた内容**

OpenAI 公式顧客事例によると、Datadog は Codex を system-level code review に使い、distributed systems における変更の ripple effect をレビュー時点で把握しようとしている。

**実装への示唆**

- エージェントセンターには「実装 agent」だけでなく「review agent」「risk analysis agent」「security / reliability reviewer」が必要。
- レビューは repo 単体ではなく、システム全体の依存関係、過去 incident、observability 情報まで含めると価値が上がる。
- PR 作成後の review loop をファーストクラスの機能にすべき。

**情報源 URL**

- https://openai.com/index/datadog/

---

#### 2.1.7 CyberAgent: ChatGPT Enterprise + Codex の日本企業導入

**対象**: ChatGPT Enterprise + Codex  
**種別**: OpenAI 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: 日本企業での Codex 導入・利用拡大の根拠。

**確認できた内容**

OpenAI 公式顧客事例によると、CyberAgent は ChatGPT Enterprise と Codex を活用し、チームの意思決定、実装前検討、開発速度、品質向上に使っている。公開ページでは 93% monthly active usage of ChatGPT Enterprise が結果として示されている。

**実装への示唆**

- 日本市場での enterprise AI coding adoption は進んでいる。
- 実装前の decision support / design review も agent center のワークフローに入れるべき。
- Codex だけでなく、ChatGPT Enterprise / Slack / GitHub / internal docs と結びつく可能性がある。

**情報源 URL**

- https://openai.com/index/cyber-agent/

---

#### 2.1.8 Rakuten: Codex による issue 修正高速化

**対象**: OpenAI Codex  
**種別**: OpenAI 公式顧客事例  
**信頼度**: S  
**コントロールプレーンとの関係**: Claude Code と同じ Rakuten が Codex も導入しているため、multi-agent / multi-vendor 前提の妥当性が高い。

**確認できた内容**

OpenAI 公式顧客事例では、Rakuten は Codex を operations と software delivery に使い、以下の成果が示されている。

- MTTR 約 50% 削減。
- build time を quarters から weeks へ、3〜4x faster potential。
- CI/CD、automated code review、vulnerability checks、autonomous development on complex projects に利用。

**実装への示唆**

- 同一企業が Claude Code と Codex の両方を使う状況が既にある。
- agent center は vendor lock-in しない方がよい。
- issue triage、CI/CD、vulnerability check は中心ユースケース。

**情報源 URL**

- https://openai.com/pl-PL/index/rakuten/

---

#### 2.1.9 OpenAI 社内: Codex だけで internal beta product を構築

**対象**: OpenAI Codex  
**種別**: OpenAI 公式エンジニアリング記事  
**信頼度**: S。ただし vendor internal story。  
**コントロールプレーンとの関係**: 「人間は steering、agent が execution」という最終形に近い。

**確認できた内容**

OpenAI の “Harness engineering” 記事では、OpenAI チームが internal beta product を 0 lines of manually-written code で構築した実験を説明している。

確認できた指標:

- 5 か月で約 100 万行の code。
- 約 1,500 PR を小規模チームで open / merge。
- 初期 3 engineers で 1 engineer あたり平均 3.5 PR/day。
- human は code を直接書かず、environment design、specify intent、feedback loop 構築に集中。

**実装への示唆**

これは「coding agent center」の上位概念である **harness engineering** の参考になる。作るべきものはチャット UI ではなく、agent が信頼できる仕事をするための harness / feedback loop / environment である。

必要機能:

- agent task templates
- repository bootstrap
- AGENTS.md generation
- CI feedback automation
- review gates
- PR throughput metrics
- human attention optimization

**情報源 URL**

- https://openai.com/index/harness-engineering

---

#### 2.1.10 GitHub Copilot coding agent: Carvana / EY のコメント

**対象**: GitHub Copilot coding agent  
**種別**: GitHub 公式 press release  
**信頼度**: S〜A。GitHub 公式だが顧客 quote であり、詳細ケーススタディではない。  
**コントロールプレーンとの関係**: GitHub 上の background PR agent として重要。

**確認できた内容**

GitHub は 2025-05-19 に Copilot coding agent を発表。press release では以下のような内容が確認できる。

- GitHub Copilot が asynchronous coding agent を含む。
- GitHub Actions powered environment で作業。
- 低〜中程度の複雑さのタスク、feature、bug fix、test extension、refactoring、documentation に向くと説明。
- Carvana の Alex Devkar 氏と EY の James Zabinski 氏のコメントが掲載。
- Copilot Enterprise / Pro+ に preview availability。

**実装への示唆**

- GitHub 公式 agent は PR workflow と enterprise controls をかなり意識している。
- 独自実装も「agent は PR を開くが、自分で merge / approve はできない」制約を持つべき。
- branch protection / required approvals / audit attribution は企業導入で重要。

**情報源 URL**

- https://github.com/newsroom/press-releases/coding-agent-for-github-copilot
- https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/about-assigning-tasks-to-copilot
- https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/assign-copilot-to-an-issue

---

### 2.2 A ランク: 公式プロダクト情報・dogfooding・named testimonials

#### 2.2.1 GitHub Agent HQ / Agent Control Plane

**対象**: GitHub Agent HQ / Agent Control Plane  
**種別**: GitHub 公式 changelog / blog / docs  
**信頼度**: A。公式情報としては強いが、外部企業の詳細導入事例ではない。  
**コントロールプレーンとの関係**: GitHub 中心の multi-agent control plane として最重要。

**確認できた内容**

GitHub は 2026-02 に Claude と OpenAI Codex を GitHub / GitHub Mobile / VS Code から coding agent として実行できる public preview を発表した。Copilot Pro+ / Enterprise から始まり、Business / Pro にも拡大。GitHub 公式 changelog では「Claude、Codex、Copilot が single shared platform inside GitHub with unified governance, shared context, shared memory」で動き、Agent Control Plane が generally available と説明されている。

確認できる機能:

- GitHub.com、GitHub Mobile、VS Code から agent sessions を起動。
- issues、pull requests、Agents tab、VS Code agent sessions view から開始。
- Claude、Codex、Copilot を選択。
- agents は repository code/history、issues/PRs、Copilot Memory、repository instructions/policies にアクセス。
- enterprise controls、centralized enablement、policy management、audit logging。
- public preview 中は coding agent session が premium request を消費。

**実装への示唆**

GitHub Agent HQ は「社内で作るべき理想形」の企業統制部分の手本。

ただし独自製品が差別化できる余地:

- GitHub に閉じないローカル / cloud agent orchestration。
- Claude Code CLI / Codex CLI / Gemini CLI / OpenCode / Cursor Agent などの任意 CLI をそのまま制御。
- Linear、Slack、Jira、Sentry、Datadog、browser preview、devcontainer などへの横断連携。
- GitHub 以外の GitLab / Bitbucket / self-hosted Git 対応。

**情報源 URL**

- https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github
- https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/
- https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/
- https://docs.github.com/copilot/concepts/agents/openai-codex
- https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/assign-copilot-to-an-issue

---

#### 2.2.2 Claude Code native parallelism: worktrees / agent view / agent teams / subagents

**対象**: Claude Code  
**種別**: Claude Code 公式 docs  
**信頼度**: A  
**コントロールプレーンとの関係**: Claude Code 自体が control plane 化しつつある。

**確認できた内容**

Claude Code docs には parallel work の選択肢として以下が示されている。

- **Worktrees**
  - `--worktree` により parallel Claude Code sessions を Git worktrees で分離。
  - `.worktreeinclude` や cleanup などの運用が説明されている。
- **Agent view**
  - `claude agents` で background sessions を一画面で dispatch / monitor / peek / reply / attach。
  - research preview。Claude Code v2.1.139 以降が必要。
- **Agent teams**
  - experimental。`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` で有効化。
  - lead session と teammates があり、shared task list、inter-agent messaging、mailbox、task dependencies を扱う。
  - in-process / split panes の display modes。
- **Subagents**
  - specialized AI assistants with custom system prompts, tool access, independent context。
  - `~/.claude/agents/` や `.claude/agents/` で定義。
  - managed settings / CLI flag / project / user / plugin など複数 scope。

**実装への示唆**

- 役割定義は Claude Code subagents / agent teams から学べる。
- ただし Claude Code 内に閉じるため、multi-vendor control plane には agent adapter layer が必要。
- Claude Code の session semantics に合わせた integration は必須。
- 自作 control plane では Claude Code native features と競合するのではなく、外側から統合するのがよい。

**情報源 URL**

- https://code.claude.com/docs/en/agents
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/agent-view
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/sub-agents

---

#### 2.2.3 OpenAI Codex app / Codex cloud / Codex CLI

**対象**: OpenAI Codex  
**種別**: OpenAI 公式 docs / announcement / GitHub  
**信頼度**: A  
**コントロールプレーンとの関係**: OpenAI 自体も「agent command center」を出している。

**確認できた内容**

OpenAI は Codex を cloud-based software engineering agent として発表し、parallel tasks、sandboxed cloud environment、GitHub repository integration、PR proposal などを提供している。Codex CLI はローカルで動く coding agent。さらに 2026-02 に Codex app を発表し、複数 agents を同時管理する desktop app / command center として位置付けている。

確認できる機能:

- Codex cloud: background / parallel tasks、cloud sandbox、GitHub integration。
- Codex CLI: local coding agent、npm / Homebrew install、ChatGPT plan or API key login。
- Codex app:
  - 複数 agent を parallel に実行。
  - threads organized by projects。
  - diff review / comments / editor handoff。
  - built-in worktree support。
  - Codex CLI / IDE extension の session history / configuration と連携。

**実装への示唆**

- Codex app は「single vendor 版のコーディングエージェントセンター」として重要な競合。
- 自作 product は multi-vendor、GitHub 以外連携、role orchestration、local-first / enterprise on-prem などで差別化。
- Codex cloud の sandbox / background task は、自作 product の cloud runner 設計に参考になる。

**情報源 URL**

- https://openai.com/index/introducing-codex/
- https://platform.openai.com/docs/codex/overview
- https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started
- https://github.com/openai/codex
- https://openai.com/index/introducing-the-codex-app

---

#### 2.2.4 AWS Labs CLI Agent Orchestrator / CAO

**対象**: AWS Labs CLI Agent Orchestrator  
**種別**: AWS Open Source Blog / GitHub README  
**信頼度**: A for existence and design; B/C for adoption evidence  
**コントロールプレーンとの関係**: 機能適合度は最上位。

**確認できた内容**

CAO は open-source multi-agent orchestration framework for AI coding CLIs。2025-10 の AWS Open Source Blog では Amazon Q CLI と Claude Code を中心に紹介されていたが、現在の GitHub README では対応範囲が広がっている。

対応確認:

- Claude Code
- Kiro CLI
- Codex CLI
- Gemini CLI
- Kimi CLI
- GitHub Copilot CLI
- OpenCode
- Amazon Q Developer CLI

設計:

- 各 agent は isolated tmux session で動作。
- supervisor-worker pattern。
- MCP を介した coordination。
- orchestration primitives:
  - `handoff`
  - `assign`
  - `send_message`
- CLI、bundled Web UI、MCP management server。
- flows / scheduled runs。
- managed skills。
- plugins for events / audit / metrics / Discord / Slack / Telegram など。

**導入実績**

外部企業の導入事例は確認できなかった。AWS Labs 公式 OSS として信頼できるが、現時点では「採用実績の厚い製品」というより「最も参考になる基盤実装」。

**実装への示唆**

- まず CAO のコードと docs を精読すべき。
- `handoff / assign / send_message` は agent orchestration API の最小セットとして有効。
- tmux session isolation は初期実装に向く。
- MCP 管理サーバーを control plane API として使う設計は妥当。
- plugin event bus は最終製品で必須。

**情報源 URL**

- https://aws.amazon.com/blogs/opensource/introducing-cli-agent-orchestrator-transforming-developer-cli-tools-into-a-multi-agent-powerhouse/
- https://github.com/awslabs/cli-agent-orchestrator
- https://github.com/awslabs/cli-agent-orchestrator/blob/main/docs/codex-cli.md

---

#### 2.2.5 Canopy / IT SOL

**対象**: Canopy  
**種別**: 公式サイト、開発元 dogfooding  
**信頼度**: A for dogfooding; B/C for external adoption  
**コントロールプレーンとの関係**: 監視・status・cost / context / tool history に強い。

**確認できた内容**

Canopy は Claude Code、Gemini CLI、Codex の desktop GUI。公式サイトによると、開発元 IT SOL は 10+ parallel Claude Code sessions を日常運用し、13+ PR branches / worktrees を管理している。Canopy は project、branch、session、browser state、Inspector を一つの desktop workspace に統合する。

機能:

- worktrees / branches sidebar
- Claude Code / Gemini CLI / Codex launcher
- terminal per worktree
- browser tied to worktree
- session status
- cost / token tracking
- context usage
- tool call history
- macOS notch status
- local-first, pass-through to AI providers
- minimal optional telemetry
- OS keychain for secrets

**実装への示唆**

- session inspector は必須。ログだけでは不十分。
- agent の cost / context usage / tool calls を session 単位で保存するべき。
- worktree ごとの browser state は frontend QA に重要。
- local-first privacy 設計は enterprise / individual の両方に刺さる。

**情報源 URL**

- https://canopy.itsol.tech/

---

#### 2.2.6 Conductor

**対象**: Conductor  
**種別**: 公式サイト / docs / testimonials / third-party review  
**信頼度**: A for product/docs; B for adoption evidence  
**コントロールプレーンとの関係**: Mac GUI 製品として最も現実的な参照先の一つ。

**確認できた内容**

Conductor は Mac app for orchestrating teams of coding agents。Claude Code と Codex を isolated workspaces で実行し、diff、checks、PR、merge まで扱う。

公式 docs の機能:

- Claude Code、Codex、other agents を parallel。
- 各 workspace は branch、working tree、setup / run context を持つ。
- multiple workspaces は独立作業に使う。
- one workspace with multiple agents は review / fix / test など同じ branch を共有する場合に使う。
- Diff Viewer、Checks tab、PR metadata、CI/status checks、deployments、GitHub comments / review threads、todos。
- Claude Code / Codex の Plan Mode、Fast Mode、reasoning controls、skills、checkpoints。

公式サイトの adoption signals:

- “Trusted by builders at” として Linear、Vercel、Notion、Ramp、Life360、Square、Reducto、Spotify などを表示。
- Notion の Product Designer、Life360 の Sr. Software Engineer など named testimonial が表示。

**限界**

これは企業としての正式導入を示すものではなく、該当企業に所属する個人利用者の testimonial と解釈すべき。

**実装への示唆**

- workspace design は Conductor が非常に参考になる。
- “separate workspaces vs same workspace multi-agent” の設計判断はそのまま採用可能。
- Checks tab のような merge readiness UI は必須。
- PR comments / unresolved todos を agent に戻す loop が重要。

**情報源 URL**

- https://www.conductor.build/
- https://www.conductor.build/docs
- https://www.conductor.build/docs/core/parallel-agents
- https://www.conductor.build/docs/concepts/workspaces-and-branches
- https://www.conductor.build/docs/reference/checks
- https://www.conductor.build/docs/tips/codex
- https://rywalker.com/research/conductor

---

#### 2.2.7 Vibe Kanban

**対象**: Vibe Kanban  
**種別**: 公式サイト / GitHub / shutdown announcement / testimonials  
**信頼度**: A/B for traction; adoption evidence is mostly testimonials  
**コントロールプレーンとの関係**: UX 参照として非常に重要。ただし継続性リスクあり。

**確認できた内容**

Vibe Kanban は Kanban issue、agent workspace、diff review、built-in browser / devtools、preview、PR 作成、チーム向け issue tracking などを備えた coding agent orchestration UI。

対応 agents:

- Claude Code
- Codex
- Gemini CLI
- GitHub Copilot
- Amp
- Cursor
- OpenCode
- Droid
- CCR
- Qwen Code

公式サイトの adoption / traction signals:

- GitHub 26.2k と表示。
- Luke Harries、Hamel Husain、Theo、Addy Osmani、Hari Mulackal などの testimonial。
- shutdown blog では「Thousands of software engineers use Vibe Kanban every day」と記載。
- 2026-04-10 に bloop shutdown、Vibe Kanban は open source / community maintained へ移行。

**実装への示唆**

- Kanban + workspace + diff review + browser preview の統合 UX は非常に参考になる。
- 一方、商用化は難しい可能性がある。Vibe Kanban の shutdown は、価格設定 / business model / open-source monetization の警告。
- 「agent が coding を高速化した結果、bottleneck は planning and review に移る」というプロダクト仮説は強い。
- ただし ultimate center は Kanban だけでなく、session graph / task dependency / audit / role orchestration まで必要。

**情報源 URL**

- https://www.vibekanban.com/
- https://github.com/BloopAI/vibe-kanban
- https://www.vibekanban.com/blog/shutdown
- https://www.vibekanban.com/docs
- https://www.vibekanban.com/release-notes
- https://www.ycombinator.com/companies/vibe-kanban

---

#### 2.2.8 Crewly

**対象**: Crewly  
**種別**: 公式サイト  
**信頼度**: A for feature description; C for adoption evidence  
**コントロールプレーンとの関係**: 役割付き team orchestration の設計が近い。

**確認できた内容**

Crewly は open-source AI agent orchestration platform。Claude Code、Gemini CLI、Codex を development team として orchestrate する。Web dashboard で team、roles、task delegation、live terminal monitoring、knowledge base、persistent memory を扱う。

対応 runtime:

- Claude Code
- Gemini CLI
- OpenAI Codex

built-in roles:

- developer
- frontend developer
- backend developer
- fullstack developer
- architect
- QA engineer
- product manager
- designer
- generalist
- custom roles

agent communication:

- bash-based skills を通じて backend に進捗、メッセージ、memory、knowledge base query、task management を送る。
- orchestrator agent が delegate / start / stop を管理。

**導入実績**

外部企業の導入事例は確認できなかった。

**実装への示唆**

- role prompts と agent team は重要。
- persistent memory / knowledge base は必須機能候補。
- ただし agent 間通信を bash skills に寄せる設計はシンプルだが、堅牢性・セキュリティ面を検証すべき。

**情報源 URL**

- https://crewlyai.com/en

---

### 2.3 B ランク: OSS / community traction / 初期プロダクト

#### 2.3.1 Claude Squad

**対象**: Claude Squad  
**種別**: GitHub / official site / community docs  
**信頼度**: B  
**コントロールプレーンとの関係**: TUI の最小実装として非常に参考になる。

**確認できた内容**

Claude Squad は複数 AI terminal agents を tmux + git worktrees で管理する terminal app。Claude Code、Codex、Gemini、Aider、OpenCode、Amp などを対象に、各 task を isolated git workspace で実行する。

機能:

- multiple agent sessions in one terminal window
- isolated git worktrees
- tmux sessions
- review changes before applying
- checkout / commit / push
- profile switching for agent command
- autoyes / auto-accept mode

GitHub traction:

- GitHub 検索結果上で約 7.4k stars、519 forks が確認できた。

**実装への示唆**

- MVP は Claude Squad のように worktree + tmux + TUI で十分始められる。
- GUI を作る前に session lifecycle と state detection を安定させるべき。
- terminal-native power users 向けには TUI / CLI も残すべき。

**情報源 URL**

- https://github.com/smtg-ai/claude-squad
- https://smtg-ai.github.io/claude-squad/
- https://agentwiki.org/claude_squad
- https://deepwiki.com/smtg-ai/claude-squad/

---

#### 2.3.2 Superset

**対象**: Superset  
**種別**: 公式サイト / third-party review  
**信頼度**: B for product; C for adoption evidence  
**コントロールプレーンとの関係**: local-first multi-agent UI の参考。

**確認できた内容**

Superset は Claude Code、Codex、その他 CLI agents を一画面で扱う local-first / open-source ツール。公式サイトでは “Trusted by engineers from” として Amazon、Google、ServiceNow、Y Combinator、Scribe などの名前が表示される。ただしこれは企業導入ではなく、該当企業所属エンジニアの個人利用シグナルと見るべき。

機能:

- 10+ parallel coding agents
- terminal / worktree management
- local-first
- offline-first
- zero telemetry by default
- code never leaves machine と説明

**情報源 URL**

- https://www.superset.sh/
- https://rywalker.com/research/superset

---

#### 2.3.3 1Code

**対象**: 1Code  
**種別**: 公式サイト / GitHub / Product Hunt 周辺  
**信頼度**: B for product; C for adoption evidence  
**コントロールプレーンとの関係**: Claude Code + Codex の visual client / cloud background agent 方向。

**確認できた内容**

1Code は Claude Code と Codex を一つの app で扱う visual client。parallel agents、git worktree isolation、background agents、cloud sandboxes、live browser previews、MCP integrations、GitHub / Linear / Slack triggers を掲げている。

機能:

- Claude Code and Codex in one app
- desktop app / web
- PRs / diffs / merge
- worktree isolation
- background cloud sandboxes
- live browser previews
- MCP integrations
- `@1code` triggers in GitHub, Linear, Slack
- auto-review PRs / fix CI failures / complete Linear tasks

**導入実績**

外部企業の case study は確認できなかった。公式サイトには “Used by teams at” のセクションがあるが、企業名・導入詳細は検索結果上で十分に確認できなかった。

**実装への示唆**

- Slack / Linear / GitHub trigger は重要。
- cloud background agents と local app の hybrid は理想形。
- browser previews は frontend / product QA で必須。

**情報源 URL**

- https://1code.dev/

---

#### 2.3.4 Emdash

**対象**: Emdash  
**種別**: 公式 docs / provider docs / third-party review  
**信頼度**: B for product; C for adoption evidence  
**コントロールプレーンとの関係**: 多数 provider 対応、Best-of-N、issue tracker integration の参考。

**確認できた内容**

Emdash は open-source Agentic Development Environment。複数 coding agents を parallel に実行し、各 agent は isolated Git worktree で作業する。

機能:

- 18+ / 20+ CLI-based agents
- Claude Code、Codex、Gemini、OpenCode など
- Best-of-N
- side-by-side diff review
- Kanban view
- Linear / Jira / GitHub Issues integration
- macOS、Windows、Linux

Provider docs で確認できる provider:

- Claude Code
- Codex
- Gemini
- Qwen Code
- Cursor
- GitHub Copilot
- Amp
- Auggie
- Cline
- Continue
- Codebuff
- OpenCode
- Charm
- Kilocode
- Kimi
- Goose など

**導入実績**

YC W26 / open-source などの traction はあるが、外部企業導入の一次情報は確認できなかった。

**実装への示唆**

- provider registry は必須。
- Best-of-N は重要機能。特に同一タスクを Claude / Codex / Gemini に投げ、diff とテスト結果で選ぶ UX は強い。
- Linear / Jira / GitHub Issues を task source として一級に扱うべき。

**情報源 URL**

- https://docs.emdash.sh/
- https://www.emdash.sh/docs/providers
- https://rywalker.com/research/emdash

---

#### 2.3.5 MCO

**対象**: MCO  
**種別**: GitHub  
**信頼度**: B for design; adoption unknown  
**コントロールプレーンとの関係**: fan-out review / consensus / SARIF 出力の参考。

**確認できた内容**

MCO は Multi-CLI Orchestrator。Claude Code、Codex CLI、Gemini CLI、OpenCode、Qwen Code などに prompt を並列 dispatch し、結果を aggregate / synthesize する neutral orchestration layer。

機能:

- `mco review`
- `mco run`
- providers: claude, codex, gemini, opencode, qwen
- output: JSON, SARIF, Markdown-PR
- consensus / debate / synthesize
- file division review
- retry / timeout / provider failure isolation
- MCP server mode
- memory / findings lifecycle / agent reliability weights

**実装への示唆**

- code review use case では MCO 型が非常に有効。
- provider failure が他 provider を止めない設計は必須。
- SARIF 出力により GitHub Code Scanning へ連携できる。
- agent reliability をカテゴリ別に学習する設計は ultimate center に入れる価値がある。

**情報源 URL**

- https://github.com/mco-org/mco

---

#### 2.3.6 Roundtable

**対象**: Roundtable  
**種別**: GitHub / MCP directory  
**信頼度**: B/C  
**コントロールプレーンとの関係**: MCP server として primary AI assistant から sub-agent CLI に delegation する設計が参考。

**確認できた内容**

Roundtable は local MCP server。primary AI assistant から Gemini、Claude、Codex、Cursor などに task delegation できる。

機能:

- context continuity
- parallel execution
- model specialization
- existing CLI tools / API subscriptions
- 26+ IDE support
- zero configuration auto-discovery

**実装への示唆**

- coding-agent center は UI からだけでなく、MCP server として他 agent / IDE から操作できるようにすべき。
- 既存 IDE / AI assistant から “call control plane as tool” できると採用障壁が下がる。

**情報源 URL**

- https://github.com/askbudi/roundtable
- https://llmbase.ai/mcp-servers/roundtable/

---

#### 2.3.7 Claw Orchestrator

**対象**: Claw Orchestrator  
**種別**: GitHub  
**信頼度**: B for design; adoption unknown  
**コントロールプレーンとの関係**: interactive coding CLI を headless programmable engines に変換する設計が重要。

**確認できた内容**

Claw Orchestrator は Claude Code、Codex、Gemini、Cursor Agent、OpenCode、custom CLI を unified runtime として扱う TypeScript runtime。

機能:

- persistent sessions
- multi-engine runtime
- multi-agent councils
- isolated git worktrees
- tool-based API
- OpenClaw plugin support
- tools: session_start, session_send, coding_session_status, session_grep, session_compact, team_send, council_start, council_review, council_accept など
- tested engines:
  - Claude Code
  - Codex
  - Gemini
  - Cursor Agent
  - OpenCode

**実装への示唆**

- session API の粒度が参考になる。
- “coding CLI as programmable headless engine” は今回の製品の核心。
- council pattern は multi-agent decision / review に使える。

**情報源 URL**

- https://github.com/Enderfga/openclaw-claude-code

---

#### 2.3.8 Agor

**対象**: Agor  
**種別**: GitHub / docs  
**信頼度**: B/C  
**コントロールプレーンとの関係**: multiplayer spatial canvas という UI 方向が参考。

**確認できた内容**

Agor は Claude Code、Codex、Gemini sessions を multiplayer canvas で orchestrate する。Git worktrees、AI conversations、agentic work を real-time visualized する。

機能:

- Figma-like spatial canvas
- coding agents side-by-side on isolated git worktrees
- multiplayer cursor / comments
- MCP servers and worktree management
- session trees
- fork / spawn / coordinate
- workflow zones
- scheduler
- internal Agor MCP service

**実装への示唆**

- “Kanban だけでは足りない” 場合、spatial canvas / session graph が強い可能性。
- 大規模タスクでは task dependency graph、session tree、forked attempts の可視化が必要。

**情報源 URL**

- https://github.com/preset-io/agor
- https://agor.live/
- https://agor.live/guide

---

#### 2.3.9 metaswarm

**対象**: metaswarm  
**種別**: GitHub / plugin directory  
**信頼度**: B/C。production-tested claim はあるが、独立検証は不足。  
**コントロールプレーンとの関係**: SDLC 全体を agent roles / quality gates / TDD で進める設計が参考。

**確認できた内容**

metaswarm は Claude Code、Gemini CLI、Codex CLI 向けの multi-agent orchestration framework。18 specialized agents、13 skills、15 commands、TDD enforcement、quality gates、spec-driven development を掲げる。

workflow:

- Research
- Plan
- Design Review Gate
- Work Unit Decomposition
- Orchestrated Execution
- Final Review
- PR Creation
- PR Shepherd
- Closure & Learning

execution loop:

- IMPLEMENT
- VALIDATE
- ADVERSARIAL REVIEW
- COMMIT

**実装への示唆**

- ultimate center は単なる session manager ではなく、SDLC workflow engine を持つべき。
- TDD / review gates / adversarial review は品質維持に重要。
- “PR Shepherd” 役は有用。CI failure、review comment、merge readiness を管理する agent role として実装すべき。

**情報源 URL**

- https://github.com/dsifry/metaswarm
- https://dsifry.github.io/metaswarm/
- https://www.claudepluginhub.com/plugins/dsifry-metaswarm

---

#### 2.3.10 OpenRig

**対象**: OpenRig  
**種別**: 公式サイト  
**信頼度**: B/C  
**コントロールプレーンとの関係**: topology-as-code 方向。

**確認できた内容**

OpenRig は “Terraform for coding agents” と表現される。YAML で agent topology を定義し、boot / inspect / restore する。

機能:

- one YAML file
- one command to boot fleet
- persistent identity
- shared memory
- reboot / restore
- Claude Code and Codex in same topology

**実装への示唆**

- ultimate center には GUI だけでなく `agent-fleet.yaml` のような declarative topology が必要。
- 再現可能な agent team configuration は enterprise / CI で重要。

**情報源 URL**

- https://www.openrig.dev/

---

#### 2.3.11 webmux

**対象**: webmux  
**種別**: 公式サイト  
**信頼度**: B for dogfooding claim; C for external adoption detail  
**コントロールプレーンとの関係**: browser dashboard / mobile-friendly chat の参考。

**確認できた内容**

webmux は isolated worktrees 上で multiple AI agents を実行し、Web dashboard で real-time terminal output、PRs、mobile-friendly chat を管理する。公式サイトでは “Used by engineers at Windmill every day.” と記載。

**実装への示唆**

- mobile-friendly status / chat は長時間タスクで重要。
- agent が数十分〜数時間走る場合、スマホから状況確認・追加入力できる導線が価値になる。

**情報源 URL**

- https://webmux.dev/

---

#### 2.3.12 Agentastic.dev

**対象**: Agentastic.dev  
**種別**: 公式サイト  
**信頼度**: B/C  
**コントロールプレーンとの関係**: all-in-one ADE の参考。

**確認できた内容**

Agentastic.dev は macOS 向け Agentic Development Environment。30+ parallel coding agents を Git worktrees または Docker containers で分離し、built-in IDE、Ghostty terminal、browser、diff viewer、multi-agent code review を提供すると説明している。

**実装への示唆**

- Docker container isolation も選択肢として入れるべき。
- ADE 化するなら built-in editor / browser / terminal / git client の統合が必要。

**情報源 URL**

- https://www.agentastic.dev/

---

#### 2.3.13 Orca

**対象**: Orca  
**種別**: 公式サイト  
**信頼度**: B/C  
**コントロールプレーンとの関係**: worktree IDE の参考。

**確認できた内容**

Orca は “The Worktree IDE for Claude Code, Ghostty & AI Coding Agents”。Claude Code、Codex、OpenCode などを worktrees / terminals / diffs / status tracking / notifications / unread markers で管理する。

**実装への示唆**

- unread markers / notification は地味だが重要。
- agent が「待っている」状態を検知し、ユーザーに戻す設計が必要。

**情報源 URL**

- https://www.orcabuild.ai/

---

#### 2.3.14 Commander

**対象**: Commander  
**種別**: GitHub  
**信頼度**: B/C  
**コントロールプレーンとの関係**: Tauri desktop app の参考。

**確認できた内容**

Commander は Tauri v2 desktop app。Claude Code CLI、OpenAI Codex CLI、Gemini CLI、local test harness を multi-agent chat surface で扱い、Git worktrees、Git tooling、diff viewer、branch/worktree selectors、plan mode、parallel session tracking を提供すると説明されている。

**情報源 URL**

- https://github.com/autohandai/commander

---

#### 2.3.15 CCManager

**対象**: CCManager  
**種別**: GitHub  
**信頼度**: B/C  
**コントロールプレーンとの関係**: multi-project session manager の参考。

**確認できた内容**

CCManager は Claude Code、Gemini CLI、Codex CLI、Cursor Agent、Copilot CLI、Cline CLI、OpenCode、Kimi CLI の session manager。Git worktrees と projects をまたいで管理する。

機能:

- parallel sessions
- multi-project support
- visual status indicators
- create / merge / delete worktrees
- copy Claude Code session data between worktrees
- command presets
- configurable state detection strategies

**実装への示唆**

- state detection strategy を agent ごとに configurable にする必要がある。
- Claude Code session data copy など、agent-specific migration 機能も必要になる可能性。

**情報源 URL**

- https://github.com/kbwo/ccmanager

---

#### 2.3.16 Bernstein

**対象**: Bernstein  
**種別**: 公式サイト  
**信頼度**: B/C  
**コントロールプレーンとの関係**: lint / type / test gating を中心にした orchestrator として参考。

**確認できた内容**

Bernstein は Claude Code、Codex、Gemini CLI、Aider、その他 CLI coding agents を git worktrees 上で並列に走らせ、lint、types、tests で merge を gate する orchestrator と説明されている。公式サイトでは 44 CLI adapters、57,000+ installs と表示。

**実装への示唆**

- “only what passes” の思想は重要。
- agent result はテスト・型・lint・CI を通過するまで accepted にしない。
- scheduler に LLM を入れず deterministic にする設計も参考。

**情報源 URL**

- https://bernstein.run/

---

#### 2.3.17 Hive / Rift

**対象**: Hive、Rift  
**種別**: 公式サイト  
**信頼度**: B/C  
**コントロールプレーンとの関係**: worktree manager として参考。

**確認できた内容**

Hive は Git worktrees で parallel AI agent workspaces を管理する CLI/TUI。Rift は AI agents 向け Git worktree manager で、port mapping、hooks、multi-root workspace generation、agent command integration を提供する。

**実装への示唆**

- full control plane の前に、worktree manager と port manager が基礎。
- deterministic port mapping は複数 dev server を同時に立てる際に必須。
- setup hooks / lifecycle hooks が必要。

**情報源 URL**

- https://hive.cretu.dev/
- https://rift.priyashpatil.com/

---

## 3. 調査・レビュー記事リスト

### 3.1 公式一次情報

#### GitHub Agent HQ / Copilot coding agent

- https://github.blog/changelog/2026-02-04-claude-and-codex-are-now-available-in-public-preview-on-github
- https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users/
- https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/
- https://github.com/newsroom/press-releases/coding-agent-for-github-copilot
- https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/about-assigning-tasks-to-copilot
- https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/assign-copilot-to-an-issue
- https://docs.github.com/copilot/concepts/agents/openai-codex

#### Anthropic / Claude Code

- https://code.claude.com/docs/en/agents
- https://code.claude.com/docs/en/worktrees
- https://code.claude.com/docs/en/agent-view
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/sub-agents
- https://www.anthropic.com/news/how-anthropic-teams-use-claude-code
- https://www.anthropic.com/customers/ramp
- https://www.anthropic.com/customers/rakuten
- https://www.claude.com/customers/classmethod

#### OpenAI / Codex

- https://openai.com/index/introducing-codex/
- https://platform.openai.com/docs/codex/overview
- https://help.openai.com/en/articles/11096431-openai-codex-cli-getting-started
- https://github.com/openai/codex
- https://openai.com/index/introducing-the-codex-app
- https://openai.com/index/harness-engineering
- https://openai.com/index/datadog/
- https://openai.com/index/cyber-agent/
- https://openai.com/index/scaling-codex-to-enterprises-worldwide/
- https://openai.com/pl-PL/index/rakuten/

#### AWS Labs CAO

- https://aws.amazon.com/blogs/opensource/introducing-cli-agent-orchestrator-transforming-developer-cli-tools-into-a-multi-agent-powerhouse/
- https://github.com/awslabs/cli-agent-orchestrator

### 3.2 企業・開発者の実利用レポート

- incident.io: https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees
- incident.io podcast: https://incident.io/thedebrief/shipping-with-claude-code-and-worktrees
- Canopy / IT SOL: https://canopy.itsol.tech/
- Vibe Kanban shutdown / usage claim: https://www.vibekanban.com/blog/shutdown
- OpenAI Harness Engineering: https://openai.com/index/harness-engineering
- Anthropic internal teams: https://www.anthropic.com/news/how-anthropic-teams-use-claude-code

### 3.3 第三者レビュー・比較

第三者レビューは市場把握に有用だが、導入実績の一次証拠ではない。

- Ry Walker Research: Conductor  
  https://rywalker.com/research/conductor
- Ry Walker Research: Superset  
  https://rywalker.com/research/superset
- Ry Walker Research: Emdash  
  https://rywalker.com/research/emdash
- AIcoolies: Vibe Kanban review  
  https://aicoolies.com/reviews/vibe-kanban-review
- Vibe Kanban / YC company page  
  https://www.ycombinator.com/companies/vibe-kanban
- AgentMarketCap: open-source multi-agent CLI orchestration overview  
  https://agentmarketcap.ai/blog/2026/04/06/open-source-multi-agent-cli-orchestration-parallel-code-claude-bridge-moonmind

---

## 4. 競合・参考実装マップ

| 名称 | 種別 | 主対応 agent | UI | 実行分離 | 役割連携 | 導入実績の強さ | 実装参考度 |
|---|---|---|---|---|---|---:|---:|
| GitHub Agent HQ | 公式 cloud platform | Copilot, Claude, Codex | GitHub / VS Code / Mobile | GitHub managed | GitHub workflow 上 | A | 高 |
| Claude Code agent teams/view | 公式 native | Claude Code | CLI / terminal | worktree / background sessions | lead / teammates / mailbox | A | 高 |
| Codex app/cloud | 公式 native | Codex | Desktop / cloud / CLI | cloud sandbox / worktree | multi-thread | A | 高 |
| AWS Labs CAO | OSS framework | Claude, Codex, Gemini, Copilot CLI, OpenCode, Q など | CLI / Web UI / MCP | tmux | supervisor-worker | B/C | 非常に高 |
| Conductor | Mac GUI | Claude Code, Codex | Desktop | worktree | same workspace / multi workspace | B | 非常に高 |
| Vibe Kanban | Kanban GUI | Claude, Codex, Gemini, Copilot, Cursor, OpenCode など | Web / local | worktree | task/workspace | B | 非常に高 |
| Canopy | Desktop GUI | Claude, Gemini, Codex | Desktop | worktree | session inspection | A/B | 高 |
| Claude Squad | TUI | Claude, Codex, Gemini, Aider, OpenCode, Amp | Terminal | tmux + worktree | low | B | 高 |
| Crewly | Web dashboard | Claude, Gemini, Codex | Web | PTY | roles / delegation | C | 高 |
| Emdash | ADE | 20+ CLI agents | Desktop | worktree | Best-of-N | C | 高 |
| MCO | CLI / MCP | Claude, Codex, Gemini, OpenCode, Qwen | CLI | subprocess | fanout / consensus | C | 高 |
| Roundtable | MCP server | Claude, Codex, Gemini, Cursor | MCP | CLI delegate | primary assistant -> subagents | C | 中 |
| Claw Orchestrator | Runtime / API | Claude, Codex, Gemini, Cursor, OpenCode | API / CLI | persistent sessions / worktree | councils | C | 高 |
| Agor | Multiplayer canvas | Claude, Codex, Gemini | Web canvas | worktree | session tree / zones | C | 中〜高 |
| OpenRig | Topology-as-code | Claude, Codex | CLI | topology | YAML rigs | C | 中〜高 |
| metaswarm | Claude plugin / framework | Claude, Gemini, Codex | CLI/plugin | workflow | 18 roles / gates | C | 中〜高 |
| 1Code | Visual client | Claude, Codex | Desktop / Web | worktree / cloud sandbox | triggers / automations | C | 高 |
| Superset | Local UI | Claude, Codex, arbitrary CLI | Desktop/local | worktree | low | C | 中 |
| webmux | Web dashboard | Claude/Codex implied | Web/mobile | worktree | dashboard/chat | B/C | 中 |
| Agentastic.dev | ADE | 30+ agents | Desktop | worktree / Docker | review | C | 中 |
| Orca | Worktree IDE | Claude, Codex, OpenCode | Desktop | worktree | low | C | 中 |

---

## 5. 実装に取り込むべき設計パターン

### 5.1 Git worktree は第一級オブジェクト

ほぼ全ての有力実装が worktree を使っている。理由は明確。

- agent 同士が同じ working directory を壊さない。
- branch / PR / diff / CI と自然に接続できる。
- 失敗した試行を捨てやすい。
- Best-of-N で複数 agent の成果を比較できる。
- 長時間 session の context を branch に固定できる。

**必須機能**

- worktree create / list / delete / archive
- branch naming
- base branch selection
- PR / issue / ticket から worktree 作成
- setup script
- run script
- port assignment
- `.env` / generated files / dependency install handling
- clean up orphaned worktrees
- merge / cherry-pick / compare / discard

参考 URL:

- https://code.claude.com/docs/en/worktrees
- https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees
- https://www.conductor.build/docs/concepts/workspaces-and-branches
- https://github.com/smtg-ai/claude-squad
- https://www.vibekanban.com/docs

---

### 5.2 Agent session は “process” ではなく “long-running teammate” として扱う

agent は短い API call ではない。数分〜数時間動く。途中で止まり、権限を求め、CI に失敗し、review comment に対応する。

**セッションモデルに必要な状態**

- created
- starting
- planning
- running
- waiting_for_user
- waiting_for_permission
- waiting_for_ci
- waiting_for_review
- blocked
- idle
- completed
- failed
- stopped
- archived

**セッション API 候補**

```ts
interface AgentProvider {
  id: string;
  displayName: string;
  capabilities: AgentCapabilities;

  detect(): Promise<ProviderDetection>;
  authenticate(): Promise<AuthStatus>;

  launch(input: LaunchRequest): Promise<SessionHandle>;
  send(sessionId: string, message: string, options?: SendOptions): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  approve(sessionId: string, approvalId: string): Promise<void>;
  deny(sessionId: string, approvalId: string, reason?: string): Promise<void>;

  status(sessionId: string): Promise<AgentStatus>;
  stream(sessionId: string): AsyncIterable<AgentEvent>;
  attach(sessionId: string): Promise<PtyHandle>;

  checkpoint(sessionId: string): Promise<Checkpoint>;
  resume(sessionId: string, checkpoint?: string): Promise<SessionHandle>;
  shutdown(sessionId: string): Promise<void>;

  exportTranscript(sessionId: string): Promise<Transcript>;
}
```

参考 URL:

- https://github.com/awslabs/cli-agent-orchestrator
- https://github.com/Enderfga/openclaw-claude-code
- https://code.claude.com/docs/en/agent-view
- https://openai.com/index/introducing-the-codex-app

---

### 5.3 役割定義は provider 非依存にする

Claude Code subagents、agent teams、Crewly、metaswarm、CAO はいずれも役割定義を持つ。だが provider 固有の機能に寄せすぎると横断制御が難しい。

**推奨**

- `RoleProfile` を内部標準にする。
- Claude Code subagent、Codex AGENTS.md / skill、Gemini instruction、Copilot custom agent へ変換する adapter を作る。
- role は model/provider と分離する。

```yaml
roles:
  architect:
    description: System design and decomposition
    allowed_tools: [read, grep, docs, github_issues]
    disallowed_tools: [write, shell_write]
    model_preference: high_reasoning
    prompt: |
      You are the architect. Produce decomposition, constraints, interfaces, and risk list.
  implementer:
    description: Implements scoped work units
    allowed_tools: [read, write, shell, test]
  reviewer:
    description: Reviews diffs for correctness, security, maintainability
    allowed_tools: [read, grep, test]
```

参考 URL:

- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://crewlyai.com/en
- https://github.com/dsifry/metaswarm
- https://github.com/awslabs/cli-agent-orchestrator

---

### 5.4 Orchestration primitives は `assign`, `handoff`, `message`, `review`, `synthesize`

CAO の primitives はよい最小セット。

- `assign`: 非同期に worker を spawn して task を任せる。
- `handoff`: 同期的に task を渡し、完了を待つ。
- `send_message`: 既存 session へ追加指示。
- `review`: diff / result を別 agent にレビューさせる。
- `synthesize`: 複数 agent の output を統合。
- `vote` / `debate`: consensus / disagreement を扱う。

参考 URL:

- https://github.com/awslabs/cli-agent-orchestrator
- https://github.com/mco-org/mco
- https://github.com/Enderfga/openclaw-claude-code
- https://github.com/askbudi/roundtable

---

### 5.5 Review が主戦場

Vibe Kanban の仮説通り、agent が coding を高速化すると、人間の bottleneck は planning と review に移る。したがって UI の中心はチャットではなく、review / verification / merge readiness である。

**必須 review surface**

- diff viewer
- inline comments
- “send comment to agent”
- test result
- type/lint result
- CI result
- PR metadata
- unresolved review threads
- TODOs
- security findings
- deployment preview
- browser preview
- acceptance checklist
- human approval

参考 URL:

- https://www.conductor.build/docs/reference/checks
- https://www.vibekanban.com/
- https://docs.emdash.sh/
- https://openai.com/index/datadog/
- https://github.com/mco-org/mco

---

### 5.6 Best-of-N と cross-model adversarial review

複数 agent を束ねる価値は「単に速い」だけではない。同じ task を複数モデルに投げ、最良案を選び、別モデルにレビューさせることで品質を上げられる。

**実装パターン**

1. 同じ task を Claude Code、Codex、Gemini、OpenCode に投げる。
2. それぞれ isolated worktree で実装。
3. tests / lint / typecheck を自動実行。
4. reviewer agent が diff を比較。
5. human に scorecard を提示。
6. winner を merge、または hybrid patch を作る。

参考 URL:

- https://docs.emdash.sh/
- https://github.com/mco-org/mco
- https://github.com/dsifry/metaswarm
- https://github.com/Enderfga/openclaw-claude-code

---

### 5.7 MCP と AGENTS.md は標準採用

**MCP**

MCP は context / tools / prompts を LLM applications に公開する標準。control plane は MCP server として外部 agent / IDE から操作可能にすべき。また、control plane 自身も MCP client として GitHub、Linear、Slack、Sentry、Datadog、Postgres などに接続する。

参考 URL:

- https://modelcontextprotocol.io/specification/2025-11-25/basic
- https://github.com/modelcontextprotocol/modelcontextprotocol
- https://modelcontextprotocol.info/specification/2025-11-25

**AGENTS.md**

AGENTS.md は agent-facing repository instructions の open format。control plane は以下を支援すべき。

- AGENTS.md の生成 / lint
- monorepo nested AGENTS.md discovery
- role profile から AGENTS.md fragment 生成
- provider-specific instruction file への変換
- CLAUDE.md、AGENTS.md、GEMINI.md などの同期

参考 URL:

- https://agents.md/
- https://github.com/openai/agents.md

---

## 6. 推奨アーキテクチャ

### 6.1 システム全体

```text
┌──────────────────────────────────────────────────────────────┐
│                         Control UI                            │
│  Kanban | Session Grid | Graph | Logs | Diff | PR | CI | Cost │
└───────────────────────────────┬──────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────┐
│                         Control API                           │
│  Task API | Session API | Worktree API | Review API | MCP API  │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
┌───────────────▼──────────────┐ ┌──────▼──────────────────────┐
│       Orchestration Engine    │ │        Event Bus / Log       │
│  assign/handoff/review/synth  │ │ append-only session events   │
└───────────────┬──────────────┘ └──────┬──────────────────────┘
                │                       │
┌───────────────▼───────────────────────▼──────────────────────┐
│                    Agent Runtime Supervisor                   │
│  PTY/tmux | local process | devcontainer | cloud sandbox       │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│                      Agent Adapter Layer                      │
│ Claude Code | Codex | Copilot | Gemini | OpenCode | Cursor    │
└───────────────┬──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│             Repo / Worktree / Environment Manager             │
│ git worktree | branch | setup | ports | env | browser preview  │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Core services

| Service | 役割 |
|---|---|
| Task Service | task graph、dependencies、status、assignee、priority、acceptance criteria |
| Session Service | agent session lifecycle、status detection、logs、transcripts、resume |
| Worktree Service | repo、branch、worktree、setup scripts、ports、merge、cleanup |
| Provider Adapter Service | Claude / Codex / Copilot / Gemini などを統一 API 化 |
| Event Log | append-only events、audit、replay、metrics |
| Review Service | diff、comments、review agents、scorecards、Best-of-N comparison |
| CI / Checks Service | lint/test/typecheck/CI/deploy preview を収集 |
| Context Service | AGENTS.md、CLAUDE.md、docs、tickets、issues、logs を task package 化 |
| Permission Service | command approval、network、filesystem、secrets、tool scopes |
| Notification Service | Slack、GitHub、email、mobile push |
| MCP Gateway | control plane を MCP server として公開し、外部 MCP tools も利用 |
| Memory Service | decisions、patterns、findings、agent reliability、project conventions |

### 6.3 データモデル案

```sql
tasks(
  id,
  title,
  description,
  source_type,       -- manual, github_issue, linear, jira, slack
  source_url,
  status,
  priority,
  parent_task_id,
  acceptance_criteria_json,
  created_by,
  created_at,
  updated_at
)

sessions(
  id,
  task_id,
  provider,
  role,
  worktree_id,
  status,
  model,
  started_at,
  last_event_at,
  cost_usd,
  input_tokens,
  output_tokens,
  context_usage,
  transcript_path
)

worktrees(
  id,
  repo_id,
  branch,
  base_branch,
  path,
  status,
  setup_status,
  dev_server_url,
  pr_url,
  created_at,
  archived_at
)

events(
  id,
  entity_type,
  entity_id,
  event_type,
  payload_json,
  created_at
)

reviews(
  id,
  worktree_id,
  reviewer_type,     -- human, agent
  reviewer_provider,
  status,
  findings_json,
  score,
  created_at
)

checks(
  id,
  worktree_id,
  type,              -- lint, test, typecheck, ci, security, preview
  status,
  command,
  output_path,
  url,
  created_at
)
```

---

## 7. セキュリティ / ガバナンス要件

### 7.1 最低限必要な制御

- agent ごとの filesystem scope。
- command approval policy。
- network allow/deny。
- secret redaction。
- `.env` / credential handling via OS keychain or vault。
- logs / transcripts の保存期間設定。
- audit log。
- branch protection awareness。
- PR approval separation: agent が自分で approve / merge できない。
- external MCP server allowlist。
- prompt injection detection。
- hidden HTML comments / invisible characters の sanitization。
- issue / PR comment から agent を起動する場合の trust boundary。

参考 URL:

- https://docs.github.com/en/enterprise-cloud@latest/copilot/concepts/about-assigning-tasks-to-copilot
- https://modelcontextprotocol.io/specification/2025-11-25/basic
- https://github.com/newsroom/press-releases/coding-agent-for-github-copilot
- https://canopy.itsol.tech/
- https://www.vibekanban.com/security

### 7.2 MCP 周辺の注意

MCP は非常に有用だが、tool execution と data access を伴う。公式 specification でも consent、privacy、tool safety、sampling controls が強調されている。control plane は MCP server を blindly trust してはならない。

実装要件:

- MCP server registry / allowlist
- server capability review UI
- per-tool approval
- scope-based credentials
- tool descriptions are untrusted という前提
- STDIO server 実行時の command validation
- audit log for all tool calls
- user-consent UX

参考 URL:

- https://modelcontextprotocol.io/specification/2025-11-25/basic
- https://github.com/modelcontextprotocol/modelcontextprotocol

---

## 8. MVP と Ultimate の機能差分

### 8.1 MVP

MVP は以下で十分。

1. Repo を登録。
2. Task を作成。
3. Task ごとに Git worktree を作成。
4. Claude Code / Codex / Gemini / OpenCode のいずれかを起動。
5. session output を Web UI / TUI で stream。
6. status detection: running / waiting / done / failed。
7. diff viewer。
8. tests / lint command 実行。
9. PR 作成。
10. inline review comment を agent に戻す。
11. event log / transcript 保存。

### 8.2 V1

- Kanban board
- worktree browser preview
- setup / run scripts
- per-worktree port assignment
- multiple providers
- provider profiles
- roles
- basic `assign` / `send_message`
- Slack / Linear / GitHub issue import
- AGENTS.md / CLAUDE.md detection
- local MCP server

### 8.3 Ultimate

- supervisor-worker orchestration
- agent teams with mailbox and task dependencies
- Best-of-N execution
- cross-model adversarial review
- CI / review comment / security finding feedback loops
- cloud sandboxes / devcontainers
- mobile monitoring
- cost budgets and quota controls
- project memory / decision log
- agent reliability scoring
- audit logging and compliance mode
- declarative topology-as-code
- plugin ecosystem
- workflow marketplace
- self-hosted enterprise deployment
- multi-repo task support
- safe automated merge under strict policies

---

## 9. エンジニア向け POC 計画

### Phase 1: Local session manager

目的: Claude Code / Codex / Gemini を同一 UI から起動し、worktree ごとに分離する。

実装:

- local daemon
- SQLite event store
- PTY / tmux runner
- agent provider registry
- Git worktree manager
- terminal stream UI
- status detection
- transcript persistence

参考:

- Claude Squad
- CAO
- Canopy
- Conductor

### Phase 2: Review and PR loop

目的: agent output を人間が review し、修正指示を戻し、PR 化できる。

実装:

- diff viewer
- inline comments
- send comment to agent
- run commands / checks
- GitHub PR creation
- PR status tracking
- unresolved comments / todos

参考:

- Conductor
- Vibe Kanban
- GitHub Copilot coding agent
- Emdash

### Phase 3: Multi-agent orchestration

目的: 一つの大きな task を分解し、複数 agent に割り当てる。

実装:

- task graph
- role profiles
- assign / handoff / send_message
- reviewer role
- synthesizer role
- Best-of-N
- results scorecard

参考:

- CAO
- MCO
- Claw Orchestrator
- Claude Code agent teams
- metaswarm

### Phase 4: Enterprise readiness

目的: 社内導入に耐える。

実装:

- auth / RBAC
- secrets handling
- MCP allowlist
- audit logs
- policy engine
- cost budget
- deployment options: local, self-hosted, cloud
- Slack / Linear / Jira / Sentry / Datadog integrations
- admin dashboard

参考:

- GitHub Agent Control Plane
- GitHub Copilot coding agent docs
- Canopy privacy design
- MCP specification

---

## 10. 採用判断

### 10.1 そのまま使うなら

| 目的 | 候補 |
|---|---|
| GitHub 中心、企業統制重視 | GitHub Agent HQ / Copilot coding agent |
| Claude Code + Codex の Mac GUI | Conductor |
| Kanban 型 UX の参考 | Vibe Kanban。ただし sunsetting なので中核採用は要注意 |
| Local-first session inspector | Canopy |
| TUI / terminal power user | Claude Squad |
| OSS orchestration basis | AWS Labs CAO |
| roles / teams dashboard | Crewly |
| provider coverage / Best-of-N | Emdash |
| fanout review / consensus | MCO |

### 10.2 自作するなら最も読むべき順

1. AWS Labs CLI Agent Orchestrator  
   https://github.com/awslabs/cli-agent-orchestrator
2. Conductor docs  
   https://www.conductor.build/docs
3. Vibe Kanban GitHub / docs  
   https://github.com/BloopAI/vibe-kanban  
   https://www.vibekanban.com/docs
4. Claude Squad  
   https://github.com/smtg-ai/claude-squad
5. Claude Code agent teams / agent view / worktrees  
   https://code.claude.com/docs/en/agent-teams  
   https://code.claude.com/docs/en/agent-view  
   https://code.claude.com/docs/en/worktrees
6. OpenAI Codex app announcement  
   https://openai.com/index/introducing-the-codex-app
7. Claw Orchestrator  
   https://github.com/Enderfga/openclaw-claude-code
8. MCO  
   https://github.com/mco-org/mco
9. Emdash docs  
   https://docs.emdash.sh/
10. Canopy  
   https://canopy.itsol.tech/

---

## 11. 不十分・未確認情報

以下は公開情報では十分に検証できなかった。

- Conductor の企業正式導入事例。公式サイトに named testimonials はあるが、企業全体導入ではなく個人利用者の testimonial と見るべき。
- Superset、1Code、Emdash、Crewly の外部企業による詳細導入事例。
- CAO の外部企業での本格導入事例。AWS Labs の公式 OSS として設計信頼性は高いが、採用実績は確認不足。
- metaswarm の “production-tested” claim。プロジェクト説明としては有用だが、企業名・第三者証拠は不足。
- webmux の “Used by engineers at Windmill every day” は公式サイトの claim として確認したが、詳細な導入レポートは未確認。
- Agentastic.dev、Orca、Commander、CCManager、Hive、Rift、Bernstein などは製品・OSS の存在と機能説明は確認できるが、導入例は限定的。

---

## 12. 最終判断

「究極のコーディングエージェントセンター」を実装する市場機会はある。理由は以下。

1. Claude Code、Codex、Copilot coding agent の企業導入は既に進んでいる。
2. Ramp、Rakuten、CyberAgent、Datadog、Classmethod、incident.io などの事例から、実務利用の価値は明確。
3. 一方で、複数 agent を横断制御する既製コントロールプレーンはまだ導入実績が薄い。
4. 既存製品は session manager、Kanban、desktop app、MCP orchestrator、agent team framework に分散しており、統合製品がない。
5. 差別化ポイントは、multi-vendor、worktree isolation、review-centric UI、role orchestration、Best-of-N、enterprise governance、cloud/local hybrid、MCP / AGENTS.md 標準対応。

最初の実装目標は「AI coding 用の n8n / Dify」ではなく、より正確には次である。

> **Git worktree を中核にした、長時間・並列・検証可能な coding-agent runtime と、その上に乗る review-centric control plane。**

この方向なら、既存製品の弱点を突ける。

- GitHub Agent HQ は GitHub に閉じる。
- Claude Code / Codex app は単一 vendor に寄る。
- Conductor / Canopy は desktop workflow 寄り。
- Vibe Kanban は継続性に懸念。
- CAO は framework 寄りで product UX が薄い。
- Claude Squad は TUI で軽量だが team / governance に弱い。
- Crewly は roles が強いが adoption が見えない。

したがって、自作するなら **CAO の orchestration、Conductor / Vibe Kanban の review UX、Canopy の session inspector、Claude Squad の軽量 runtime、Claude Code agent teams の role/team model、MCO の consensus review、GitHub Agent Control Plane の governance** を統合するのが最短経路である。
