# 2026-05-15 Web Flow Drag Session

## 出席

- User (project owner)
- Claude (Opus 4.7)

## 議題

1. legion web UI の Template / Instance フロー canvas が固定配置でしか描画できない問題を解消する
2. **ノードを drag できる**ようにし、Template 側は永続化、Instance 側は閲覧時補助とする
3. ブレスト → spec → plan → 実装 → 視覚検証 → perf 不良検出 → 再 spec → 再 plan → 再実装 → main 統合 まで 1 セッションで完走
4. main 側で別途進んでいた変更 (workflow trigger UI / Reviewer retry 表示) と本ブランチの大規模変更を **rebase + 手動マージ** で統合する練習

## 背景

これまでの legion web UI は `TemplateCanvas` / `CanvasOverlay` (Instance 詳細) ともに React Flow を使いながら `nodesDraggable={false}` で位置を固定していた。ヘッダにも「(read-only mockup — Phase 1 では編集不可)」と明記されていた。D-009「Visual Workflow Editor を V1 必須要件として扱う」と D-019「YAML マスター + DB cache、エディタはファイルに反映する」を踏まえると、まず最初の編集操作として「ノードを動かす」が自然な一手という認識から本セッションを開始した。

並行して main では別エージェントが Trigger workflow UI (`f8a0dac`) と Reviewer retry の canvas 表示 (`d659983`) を進めていた。さらに main 側に未 commit な registry refactor (WIP) も残っていた状態。

## セッション進行のサマリ

| フェーズ | 内容 | 成果物 |
| --- | --- | --- |
| 0. worktree 起動 | `EnterWorktree(name="design-1")` で `.claude/worktrees/design-1/` を作成 | 隔離作業環境 |
| 1. ブレスト (Round 1) | スコープを「drag のみ。create/delete/property 編集は次ステップ」に絞る。Template は YAML 永続化、Instance は in-session のみ。エッジは追従だけ。 | 方針合意 |
| 2. spec 1 (drag 機能) | [docs/dev/specs/2026-05-15_web_flow_drag_design.md](../specs/2026-05-15_web_flow_drag_design.md) — `TemplateNode.position?`、YAML round-trip writer、`PATCH /api/templates/:id/positions`、Save/Reset/badge、in-session Instance drag。 | spec commit |
| 3. plan 1 | [docs/dev/plans/2026-05-15_web_flow_drag.md](../plans/2026-05-15_web_flow_drag.md) — 13 タスク TDD 分解、各実装ファイルの予測行数を併記。 | plan commit |
| 4. Subagent-driven 実装 (Round 1) | core / runtime / server / web を順に実装。Task 1/2 で subagent が CWD 取り違えにより **main repo** に commit してしまう事故が発生 → cherry-pick で worktree に取り込み、以降は subagent prompt の冒頭で `cd` 強制 + branch 確認を必須化。 | 12 commits + runbook |
| 5. 視覚検証 (User) | dev server で確認 → 「動かすたびに画面がちらつく、UX 最悪」とフィードバック。 | 致命的 bug 発覚 |
| 6. 原因特定 | `useMemo([overrides])` で drag フレーム毎に全 `Node[]` を再構築 + inline `data`/`style` で参照不安定 + 親へ毎フレーム通知。React Flow が全ノード再 render していた。 | 根本原因確定 |
| 7. spec 2 (perf-fix) | [docs/dev/specs/2026-05-15_web_flow_drag_perf_fix_design.md](../specs/2026-05-15_web_flow_drag_perf_fix_design.md) — `useNodesState` + `applyNodeChanges` + `onNodeDragStop` への乗せ替え。Profiler 風の render-count proxy test も合わせて要件化。 | spec commit |
| 8. plan 2 | [docs/dev/plans/2026-05-15_web_flow_drag_perf_fix.md](../plans/2026-05-15_web_flow_drag_perf_fix.md) — 6 タスク。途中で Task 4 (helper 削除) の依存順が誤りと subagent が指摘 → Task 5 を先行に変更。 | plan commit |
| 9. Subagent-driven 実装 (Round 2) | TemplateCanvas / CanvasOverlay を perf-safe に書き換え。perf test 用に `mock.module('@xyflow/react')` で ReactFlow を stub。Bun の `mock.module` がプロセス内で cross-file 汚染するため `bun test --isolate` を package script に追加。 | 8 commits |
| 10. 視覚再検証 (User) | drag がスムーズに、致命的 UX bug 解消を確認。「タブタイトル `●` と badge ってどこ？」という質問もここで処理。 | 機能 OK |
| 11. main 統合事前調査 | `git merge-tree` dry-run で 2 ファイル real conflict (`TemplateDetail.tsx` / `CanvasOverlay.tsx`) を特定。main 側 WIP (registry.ts uncommitted) も検出。重複 commit (cherry-pick 由来) 3 件も特定。 | conflict 早見表 |
| 12. 安全タグ | `backup/pre-rebase/main` と `backup/pre-rebase/worktree-design-1` を annotated で打って巻き戻し可能に。 | 保険 |
| 13. WIP commit + rebase | main 側 WIP を `feat(runtime): track template source path + add refreshOne` として commit (内容が私の `dcdedd0` と完全一致だったので、これも rebase で auto-skip された)。`git rebase --empty=drop main` で 3 件 auto-skip。 | rebase 進行 |
| 14. 手動マージ | `TemplateDetail.tsx`: Trigger form と Save/Reset/badge/beforeunload を両立。`CanvasOverlay.tsx`: Reviewer retry 表示 (count + decision chip) と `useNodesState` perf-fix を統合。perf-fix commit (`b26fad6`) は最終状態を直接適用したので結果的に auto-drop。 | 2 ファイルの merge resolution |
| 15. 統合後の bug 発見 | テスト実行で 4MB のログに「Maximum update depth exceeded」が連発。`blackboardMessages = []` のデフォルト引数が毎レンダーで新規配列参照を生んで `reviewerLastDecision` の useMemo が無効化 → useEffect が setNodes を呼ぶ → 無限ループ。 | 致命バグ検出 |
| 16. 修正と fixup-squash | `EMPTY_MESSAGES` をモジュール定数化して安定参照を付与。`git commit --fixup=26b8afd` + `git rebase -i --autosquash` で CanvasOverlay 統合 commit に折り込み、履歴を清潔に保った。 | bug fix in place |
| 17. 検証 | typecheck 全 5 パッケージ 0 errors、tests 288 pass (core 15 / web 68 / runtime 172+6skip / server 33) / 0 fail。 | green |
| 18. タグ + ff-merge 裏技 | `web-flow-drag-end` を打ったあと、`worktree-design-1` 上に居続けたまま `git push . worktree-design-1:main` で main を ff-merge。`receive.denyCurrentBranch=updateInstead` を一時 config に設定して、main 側 worktree の working tree も自動同期させた。 | main 進行 |
| 19. 議事録 | 本ファイル | session 完了 |

## 主要決定（spec への補足）

機能本決定は spec 2 本に記録済み (`2026-05-15_web_flow_drag_design.md` の FD-01〜FD-09、`2026-05-15_web_flow_drag_perf_fix_design.md` の PF-01〜PF-06)。本議事録ではセッション特有のプロセス決定を SD-NN として記録する。

### SD-01: drag 操作は「ライブラリの標準パターン」を優先する

- React Flow なら `useNodesState` + `applyNodeChanges` + `onNodeDragStop`。手で controlled state を組まない。
- 「自分で書いたほうがコントロールできる」と思った Round 1 が致命的 UX bug の原因だった。次回以降、可視化ライブラリの drag を扱う前に README の prototype サンプルを読む。
- 詳細は memory feedback `react-flow-drag-standards` (`memory/feedback_react_flow_drag_standards.md`) に保存済み。

### SD-02: 目を持たない agent 用の proxy verification を仕様化する

UX 問題 (チラつき / カクつき) は agent には見えない。replacement として:

- **Contract test**: ライブラリ提供 helper (`applyNodeChanges`) の参照保持挙動を contract test で固定。SDK bump 時に再走。
- **Mock-based regression test**: `mock.module` で `ReactFlow` を stub し、`onNodesChange` / `onNodeDragStop` props を直接呼んで「drag 中は親通知ゼロ、drag stop で 1 回通知」を検証。
- Profiler ベースの render-count test は今回は採用せず、コールバック呼び出しカウントで proxy。

### SD-03: Subagent dispatch では必ず CWD と branch を最初に検査させる

Round 1 の Task 1/2 で subagent が main repo 側に commit してしまった事故を受け、以降の全 dispatch prompt に以下を冒頭で必須化:

```
cd /d/Projects/Misc/legion/.claude/worktrees/design-1
git branch --show-current   # must be worktree-design-1, else STOP
```

事故後、prompt テンプレートに該当ガードを追加し、Round 2 以降の 8 タスクで再発なし。

### SD-04: `bun test` のプロセス内 mock 汚染対策に `--isolate` を採用

Bun の `mock.module` は同一プロセスの後続テストファイルにも影響を残す。perf test 用に `ReactFlow` を mock したことで、後続の `TemplateCanvas.test.tsx` が `data-id` を見つけられず失敗するようになった。`packages/web/package.json` の `test` script に `--isolate` を付与してテスト毎にプロセス分離。実行時間は 1.5s → 3.3s に増加したが許容範囲。

### SD-05: 重複 commit と未 commit WIP は rebase 前にユーザ側で「commit して同型にする」

- main 側に未 commit な registry refactor があり、内容は本 branch の `dcdedd0` と完全一致していた。
- ユーザがこれを `feat(runtime): track template source path + add refreshOne` として commit したことで、rebase が patch-id 一致を検出して auto-skip。クリーンな線形履歴を維持。
- 教訓: 並行作業を統合するとき、WIP のまま rebase に挑むよりも commit して「同型重複」を git に見せた方が auto-drop が利く。

### SD-06: `git push . source:main` + `receive.denyCurrentBranch=updateInstead` の「裏技」

- 現在のブランチを変えずに main を ff-merge したいときの手段。
- `-c receive.denyCurrentBranch=updateInstead push .` だと receive-pack サブプロセスに `-c` が伝わらないので、`git config receive.denyCurrentBranch updateInstead` で一時 config を立てて push、操作後 unset するのが堅実。
- updateInstead は同一リポジトリ内 push で「checked out 中の他 worktree の working tree も一緒に同期する」効果がある。未追跡ファイルは保持される。本セッションで `.claire/` や `docs/dev/minutes/2026-05-15_web_theme_session.md` が無傷だったのを確認済み。

### SD-07: 「裏技」を実演する場面では先に保険タグを打つ

`backup/pre-rebase/main` と `backup/pre-rebase/worktree-design-1` を annotated で打ってから rebase / push の操作に入った。ユーザの明示指示に基づくが、destructive な操作前のリチュアルとして以後も踏襲する価値あり。

## 学び (今後セッションへの引き継ぎ)

### 1. UI を見られない agent が UX bug を出さないための原則

ライブラリの drag / canvas / interaction まわりは **「ライブラリの推奨パターン (README に出てくる最初のサンプル) を最初に試す」**。自分で controlled state を組み始めたら一歩戻って「これは標準パターンか？」を自問する。

加えて perf 系は **mock-based callback-count test と参照保持 contract test** で objective に守る。

### 2. Subagent dispatch では明示的なガードを冒頭に置く

CWD / branch は agent の暗黙状態としては脆い。prompt 冒頭で `cd && git branch --show-current` + 「不一致なら STOP」を強制すると事故が消える。

### 3. mock.module の cross-file pollution は `--isolate` で

Bun の挙動として覚えておく。

### 4. 並行作業との rebase は「重複を同型 commit にする」+ `--empty=drop`

- 同型 cherry-pick が起きていれば patch-id で勝手に skip される。
- WIP は事前に commit して同型化。
- 重複 commit が `--empty=drop` で漏れる場合は手で `--skip` する。

### 5. branch を切り替えずに main を進める裏技がある

`git push . src:main` + `denyCurrentBranch=updateInstead`。merge → switch back の二段操作より明らかに気軽。worktree 構成と相性が良い。

## 残課題 / 将来仕事

- Instance canvas での drag 位置を SQLite に永続化する (`docs/DREAM.md` 既載)
- ノード/エッジの新規作成・削除・プロパティ編集 (本 spec の非ゴール、別 spec)
- Reset 個別 (1 ノードだけ revert) のような細粒度操作
- ノード 100+ 時の virtualisation / off-screen culling (現状 ~10 ノードなので不要)

## 関連ドキュメント

- 機能 spec: [docs/dev/specs/2026-05-15_web_flow_drag_design.md](../specs/2026-05-15_web_flow_drag_design.md)
- 機能 plan: [docs/dev/plans/2026-05-15_web_flow_drag.md](../plans/2026-05-15_web_flow_drag.md)
- perf-fix spec: [docs/dev/specs/2026-05-15_web_flow_drag_perf_fix_design.md](../specs/2026-05-15_web_flow_drag_perf_fix_design.md)
- perf-fix plan: [docs/dev/plans/2026-05-15_web_flow_drag_perf_fix.md](../plans/2026-05-15_web_flow_drag_perf_fix.md)
- 手動 E2E runbook: [docs/dev/manuals/user_test_manual.md](../manuals/user_test_manual.md) 「フロー canvas のノードドラッグ」節
- DREAM (将来仕事): [docs/DREAM.md](../../DREAM.md)
- memory feedback: `~/.claude/projects/d--Projects-Misc-legion/memory/feedback_react_flow_drag_standards.md`

## タグ・ブランチ最終状態

```
main:                            c1fc855 [merged]
worktree-design-1:               c1fc855 [feature branch, ready for cleanup]

web-flow-drag-end                → c1fc855  (feature complete annotated tag)
backup/pre-rebase/main           → d659983  (safety, may be deleted)
backup/pre-rebase/worktree-design-1 → 44feb67  (safety, may be deleted)
```
