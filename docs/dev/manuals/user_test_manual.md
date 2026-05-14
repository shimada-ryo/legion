# User Test Manual

legion を手元のブラウザで動作確認するための runbook。Phase 2 narrow 以降の Web UI / API server を起動して workflow を 1 回完走させ、UI 上で挙動を観察するまでの最短経路をまとめます。

## 前提

- Windows + PowerShell 7+
- `bun` が PATH に通っていること
- `claude setup-token` で取得した OAuth トークン（Claude Code サブスク利用者向け）
- `$env:LEGION_SCRATCH_REPO` が User scope で設定済み（既定: `d:\Projects\Misc\legion-playground`）
  - 未設定なら下記「初回セットアップ」を参照
- `d:\Projects\Misc\legion\.env` に `CLAUDE_CODE_OAUTH_TOKEN` が記録済み
  - 全コマンドを legion repo ルートから 1 行で起動する設計のため、`.env` も legion ルートに置きます
  - `bun` は cwd の `.env` を起動時に自動ロードします。シェルで毎回 `$env:` セットする必要はありません
  - 未作成なら下記「初回セットアップ」を参照

## 初回セットアップ（既に終わっていればスキップ）

### scratch repo

`packages/server/bin/start.ts` は `process.cwd()` を repoPath として扱います。legion 本体を repoPath にすると Implementer の worktree が legion source 上に生まれてしまうため、別 repo を sandbox として用意しています。

既定では `d:\Projects\Misc\legion-playground` に作成済みです。中身（`.git`、`workflows/`、`src/hello.ts`、`README.md`）と再作成手順は auto-memory の `reference_scratch_repo.md`（`%USERPROFILE%\.claude\projects\d--Projects-Misc-legion\memory\` 配下）に記録されています。

### `LEGION_SCRATCH_REPO`（User scope 環境変数）

```powershell
[Environment]::SetEnvironmentVariable("LEGION_SCRATCH_REPO", "d:\Projects\Misc\legion-playground", "User")
```

新規 PowerShell から `$env:LEGION_SCRATCH_REPO` で参照できれば OK です（既存ターミナルには反映されないので、開き直す必要があります）。

### `.env`（OAuth トークン）

legion repo ルートに `.env` を作って `CLAUDE_CODE_OAUTH_TOKEN` を入れます。`bun` は cwd の `.env` を自動ロードするため、毎セッションの起動コマンドはトークンを書かずに 1 行で済みます。

```powershell
Copy-Item d:\Projects\Misc\legion\.env.example d:\Projects\Misc\legion\.env
notepad d:\Projects\Misc\legion\.env   # CLAUDE_CODE_OAUTH_TOKEN=... の値を埋める
```

`.env` は legion の `.gitignore` 対象です。`ANTHROPIC_API_KEY` は **絶対に書かないでください**（OAuth トークン経路を上書きして API クレジット課金になります）。

## 毎セッションの起動

PowerShell ターミナルを 3 つ用意します。**いずれも cwd は legion repo ルート (`d:\Projects\Misc\legion`)** のまま、1 行で起動できます。

### ターミナル A — Web UI (vite dev server)

```powershell
bun run --filter "@legion/web" dev
```

成功サイン: `VITE vX.X.X ready in NNN ms` と `Local: http://localhost:5173/`。Ctrl+C で停止。

### ターミナル B — legion API server

```powershell
bun packages\server\bin\start.ts --repo $env:LEGION_SCRATCH_REPO
```

成功サイン: `legion server listening on http://localhost:5500`。Ctrl+C で停止。

- `--repo <path>` で repoPath を渡します（省略時は cwd フォールバック）。これによって legion ルートに居ながら worktree のベース repo を playground にできます。
- `bun` が legion ルートの `.env` から `CLAUDE_CODE_OAUTH_TOKEN` を自動ロードします。シェルで `$env:` セットは不要です。
- `~/.legion/legion.db` が既に存在する場合、過去 instance がそのまま InstancesList に並びます。リセットしたい場合は server を止めてから後述の「dev DB のリセット」を実施してください。

### ターミナル C — トリガと観察

ブラウザで <http://localhost:5173/> を開いてから、こちらのターミナルでトリガを叩きます。

```powershell
$body = @{
  templateId = 'feature-implementation'
  userPrompt = 'Add a welcomeUser(name) function to src/hello.ts that returns "Welcome, <name>!" and commit with message "Add welcomeUser".'
  baseRef    = 'HEAD'
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:5500/api/workflows/trigger -Method Post `
  -ContentType 'application/json' -Body $body
```

レスポンスに `workflowInstanceId` が返ります。

## UI 観察チェックリスト

Instances タブから新しい instance を開き、Phase 2 narrow scope で実装された 4 領域を観察します。

| 観察対象 | 想定挙動 |
| --- | --- |
| Canvas（左ペイン） | Director role ノードが running 色 → 完了で completed 色。Director が delegate を呼ぶと Implementer ノードも spawn + running 色になる |
| EventLog（下ペイン） | 上部に per-agent フィルタボタン（例 `director-1`, `implementer-1`）が出現。クリックで該当 agent のイベントのみ表示 |
| Overview タブ（右ペイン） | テンプレ情報 `<dl>` の下に Parent / Children agent リンク section |
| Diff タブ（右ペイン） | Implementer ブランチの diff が `agentInstanceId` 入りヘッダで表示。空のときは `No agent diffs yet.` |

進捗反映が遅ければページをリロードしてください。WebSocket 経由で auto-update する想定ですが、初回ロード後の最新化が必要なケースがあるかもしれません。

## クリーンアップ

### worktrees / branches の削除

legion CLI も `--repo` 相当の経路はまだ未対応のため、こちらは `Set-Location` してから呼びます（出現頻度は低いので妥協）。

```powershell
Set-Location $env:LEGION_SCRATCH_REPO
bun "d:\Projects\Misc\legion\packages\cli\bin\legion.ts" cleanup --yes
```

`~/.legion/worktrees/<wf-id>/` を削除し、各 worktree に対応する branch も削除します。

### dev DB のリセット

instance ノイズを消したいときは server を止めてから:

```powershell
Rename-Item "$env:USERPROFILE\.legion\legion.db" "legion.db.bak.$(Get-Date -Format yyyy-MM-dd)"
```

次回 server 起動時に空 DB が新規作成されます。

## トラブルシュート

### ポートが既に使われている

```powershell
Get-NetTCPConnection -LocalPort 5500,5173 -State Listen |
  Select-Object LocalPort, OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<PID>" |
  Select-Object CommandLine
```

旧 dev process の残骸であれば `Stop-Process -Id <PID> -Force`。

### Web UI が更新されない

ページをリロード。ブラウザの DevTools → Network タブで `/api/instances/<id>` のレスポンスを直接見ると、server 側のデータ反映状態が分かります。

### Director が delegate を呼ばないまま完了する

c4d043a で修正したカスタムツール wiring バグの再発の可能性があります。`agent_instances` テーブルに Director の 1 行しかないかを確認します。

```powershell
$inspect = @'
import { Database } from 'bun:sqlite'
const db = new Database(process.argv[2])
console.log(db.prepare("SELECT id, role_node_id, parent_agent_instance_id FROM agent_instances").all())
'@
$inspect | Set-Content -Path "$env:TEMP\inspect-agents.ts" -Encoding utf8
bun "$env:TEMP\inspect-agents.ts" "$env:USERPROFILE\.legion\legion.db"
```

`parent_agent_instance_id` が NULL のままなら Implementer は spawn されていません。`packages/runtime/src/adapter/provider/launch.ts` の `mcpServers` 配線を確認してください。

## 参考

- workflows: [workflows/feature-implementation.yaml](../../../workflows/feature-implementation.yaml), [workflows/bug-fix.yaml](../../../workflows/bug-fix.yaml)
- Phase 2 narrow scope design: [docs/dev/specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md)
- 直近の handoff: [docs/dev/handoff/2026-05-14_5.md](../handoff/2026-05-14_5.md)
