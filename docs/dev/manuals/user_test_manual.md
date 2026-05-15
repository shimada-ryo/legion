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

## Phase 3 動作確認（Reviewer + Codex）

Phase 3 では Reviewer ロール（Codex provider）と Blackboard、Reviewer の retry loop（最大 3 回）を追加しました。下記は Phase 2 narrow の動作確認に加えて Phase 3 特有の挙動を観察する手順です。

### 追加の前提

- Phase 2 の前提（bun、Claude OAuth、`.env`、scratch repo）は同じ
- **Codex CLI 認証**: `codex login` を実行して `~/.codex/auth.json` を作成しておく
  - もしくは `$env:CODEX_API_KEY` をセット（OpenAI API キー直接）
  - **`OPENAI_API_KEY` は legion から絶対にセットしないでください**（ChatGPT OAuth と衝突する footgun: openai/codex#3286）
- `workflows/feature-with-review.yaml` がリポに含まれていること（Phase 3 で追加済み）

### Trigger（Phase 3 workflow）

ターミナル C で `templateId` を `feature-with-review` に切り替えます。

```powershell
$body = @{
  templateId = 'feature-with-review'
  userPrompt = 'Add a welcomeUser(name) function to src/hello.ts that returns "Welcome, <name>!" and commit with message "Add welcomeUser".'
  baseRef    = 'HEAD'
} | ConvertTo-Json

Invoke-RestMethod -Uri http://localhost:5500/api/workflows/trigger -Method Post `
  -ContentType 'application/json' -Body $body
```

### UI 観察チェックリスト（Phase 3）

Phase 2 の 4 領域に加え、サイドバーが **5 タブ**（Overview / Events / Blackboard / Diff / Tasks）に増えています。

| 観察対象 | 想定挙動 |
| --- | --- |
| Canvas | director / implementer / reviewer の 3 role node が順に色付け（running → completed） |
| EventLog のフィルタチップ | `director-1`, `implementer-1`, `reviewer-1` が現れる。retry の場合は `reviewer-2` も |
| EventLog の `blackboard` トグル | クリックで `[bb] system.delegate.start` 等の行が events と時系列で混在 |
| Overview タブ（reviewer 選択時） | エージェント詳細の下に `Decision: approve`（または `request-changes` / `reject`）が表示 |
| Overview タブ（implementer 選択時） | `Spawned` リストに `reviewer-1`（retry なら `reviewer-2` も）が並ぶ |
| Blackboard タブ | `system.delegate.start` / `system.review.decision` 等の topic 行が時系列に。クリックで payload JSON が expand。`system.*` / `user` の filter chip が機能 |
| Diff タブ | implementer のコミット差分が表示（reviewer は detached HEAD なので diff には現れない） |

### retry の確認

Reviewer が `request-changes` を返すように仕向けるには userPrompt に「最初は意図的に壊した実装でコミットして、Reviewer の指摘を受けたら修正して」と書きます。例:

```text
Add a divide(a, b) function to src/math.ts. IMPORTANT: in your first commit
omit the divide-by-zero check; commit just `return a / b`. The Reviewer will
catch this; when it does, add the guard and re-commit.
```

retry 発生時の UI 上の見え方:

- Overview の implementer 詳細の `Spawned` に `reviewer-1`, `reviewer-2` の 2 行
- Blackboard タブで `system.review.decision` topic が 2 件並ぶ（最初の payload に `request-changes`、最後に `approve`）
- EventLog の reviewer フィルタチップが 2 つ（`reviewer-1`, `reviewer-2`）

### Phase 3 トラブルシュート

- **Codex auth エラー（`No authentication found` 等）**: `codex login` を再実行。`$env:OPENAI_API_KEY` が混ざっていないか確認（unset すること）
- **`Decision:` が出ない**: Reviewer の最終 assistant メッセージが JSON で帰っていない可能性。Events タブで該当セッションを開き、最後の `assistant_message` の payload を確認。`feedback` だけ出るなら parser 経由は通っているが decision が undefined。
- **retry が 3 回で止まらない**: 起きないはず（IMPLEMENTER_PROMPT の soft cap が 3）。長引くなら Stop からの `legion cleanup --yes` で手動 cleanup。
- **server boot に `[legion] codex provider is registered but no ChatGPT OAuth ...` 警告**: codex auth がない状態。trigger 前に解決すること。

## 参考

- workflows: [workflows/feature-implementation.yaml](../../../workflows/feature-implementation.yaml), [workflows/bug-fix.yaml](../../../workflows/bug-fix.yaml), [workflows/feature-with-review.yaml](../../../workflows/feature-with-review.yaml)
- Phase 2 narrow scope design: [docs/dev/specs/2026-05-14_phase2_design.md](../specs/2026-05-14_phase2_design.md)
- Phase 3 design: [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md)
- 直近の handoff: [docs/dev/handoff/2026-05-15.md](../handoff/2026-05-15.md)

## Web UI: テーマ切替

### 初回アクセスの追従

1. OS の外観設定を Light にする
2. ブラウザのプライベートウィンドウで `http://localhost:5173/` を開く
3. **期待**: Light テーマで表示される（背景が淡 indigo、文字が濃紺）
4. プライベートウィンドウを閉じる
5. OS の外観設定を Dark にする
6. 再度プライベートウィンドウで開く
7. **期待**: Dark テーマで表示される（背景が濃紺、文字が淡 indigo）

### TopNav トグル

1. ブラウザで `/templates` などを開く
2. TopNav 右端の ☀/☾ アイコンをクリック
3. **期待**: 即座にテーマが切替わる。リロードしても維持される
4. もう一度クリックして元に戻ることを確認

### Settings の Appearance

1. `/settings` を開く
2. "Appearance" セクションに Light / Dark / System に追従 のラジオが見える
3. Light → Dark → System を順にクリック
4. **期待**: 各クリックで即座にテーマが反映、localStorage に保存される
5. System に追従 を選んだ状態で OS の Light/Dark を切替える
6. **期待**: 5 秒以内に web の表示も追従する

### FOUC（チラつき）の確認

1. localStorage に `legion.web.theme = 'dark'` をセット（DevTools の Application タブで）
2. ページをリロード（Ctrl+R）
3. **期待**: 一瞬たりとも白背景が見えず、ダーク背景で描画される

### React Flow キャンバス

1. `/templates/:id` を開く（既存テンプレートを表示）
2. テーマを Light に切替
3. **期待**: ノード白背景、枠線がタイプ別の色、背景に淡 indigo のドット
4. テーマを Dark に切替
5. **期待**: ノード濃紺背景、枠線・エッジは同じ色味、背景ドットが濃 indigo
6. Controls（左下のズーム）の色がテーマに追従していることを確認

## フロー canvas のノードドラッグ（2026-05-15 追加）

Template canvas でノード位置のドラッグ操作が YAML に永続化される動作確認。Instance canvas は in-session のみ（ディスク永続化なし）。詳細は spec `docs/dev/specs/2026-05-15_web_flow_drag_design.md` を参照。

### 1. Template canvas で drag → Save が永続化されることを確認

1. `LEGION_SCRATCH_REPO` を `legion-playground` に設定して server を起動する（詳細は「毎セッションの起動」セクションを参照）
2. ブラウザで `/templates/feature-with-review` を開く
3. ノードをドラッグして適当に動かす
4. ヘッダに `Unsaved changes` badge が表示されること、タブタイトル先頭に `●` マークが付くことを確認
5. `Save` ボタンを押す
6. badge / タブマークが消える
7. ページをリロード — 直前にドラッグした位置のままレンダリングされること
8. `workflows/feature-with-review.yaml` を VSCode で開き、`director` などのノードに `position: { x: ..., y: ... }` が flow style で追記されていること、`description: |` ブロックと既存コメントが保たれていることを確認

### 2. Reset と離脱警告の挙動を確認

1. ノードをドラッグ
2. `Reset` を押す → 位置が元に戻る、badge も消える
3. もう一度ドラッグして badge を出した状態にする
4. ブラウザのアドレスバーで他 URL に移動を試みる → ブラウザ標準の確認ダイアログが出る
5. キャンセル — そのページに留まる

### 3. Instance canvas は in-session のみ

1. workflow を trigger して instance を作る
2. `/instances/:id` を開く
3. ノードをドラッグして動かす
4. ページをリロード → 位置が初期状態に戻ること（in-session の動作確認）
5. ヘッダに Save ボタンが無いこと
