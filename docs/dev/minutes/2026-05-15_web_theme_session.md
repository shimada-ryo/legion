# 2026-05-15 Web Theme Session

## 出席

- User (project owner)
- Claude (Opus 4.7)

## 議題

1. legion web UI を **デザイン可能なプロダクト機能**として再構築する
2. Light / Dark テーマの最初の出荷形を決める
3. ブレスト → spec → plan → 実装 → 視覚検証 → 修正 → main マージまでを 1 セッションで完走
4. worktree の運用フローを実地で学ぶ（user は worktree 初心者）

## 背景

User が legion web UI を「デフォルトな白背景と素っ気ないシステムフォント」と表現し、せっかくの React Flow ダイアグラムが台無しになっていると問題提起した。当初 Claude が DevTools / Stylus 等の「外側から CSS を当てる手段」を提案して「お客さんに渡せないでしょ」と一蹴され、製品機能としてのテーマ機構が必要と認識し直した。

並行して別エージェントが Phase 3 runtime (Reviewer + Blackboard + Codex provider) を main 上で進行中。本セッションは competition しない領域として `packages/web/` だけを触る形で worktree (`worktree-design-color`) を切って独立進行した。

## セッション進行のサマリ

| フェーズ | 内容 | 成果物 |
| --- | --- | --- |
| 0. worktree 起動 | `.claude/settings.local.json` に `worktree.baseRef: head` を入れ、`EnterWorktree` で `.claude/worktrees/design-color/` を作成 | 隔離作業環境 |
| 1. 構想整理 | DevTools 案を脱却し「製品としてテーマ切替を持つ」方向へ。React に組み込みテーマ機能は無いが、CSS Custom Properties + `data-theme` 属性 + React Context で十分という判断 | 方針合意 |
| 2. Visual Companion ブレスト | `superpowers:brainstorming` skill 起動。3 パレット案（Slate / Warm / Midnight Indigo）と 10 フォント案（英 5 + 和 5）を実描画で比較 | パレットとフォントの確定 |
| 3. 設計仕様 (spec) | [docs/dev/specs/2026-05-15_web_theme_design.md](../specs/2026-05-15_web_theme_design.md) を起こす。トークン、切替挙動、FOUC 対策、テスト方針を凝縮 | spec commit |
| 4. 実装計画 (plan) | [docs/dev/plans/2026-05-15_web_theme.md](../plans/2026-05-15_web_theme.md) を TDD 10 タスクに分解 | plan commit |
| 5. Subagent-driven 実装 | `superpowers:subagent-driven-development` で各タスクを implementer + spec reviewer + code quality reviewer の 3 サブエージェントで実行 | 15 commits、35 tests pass |
| 6. 視覚検証と段階的修正 | dev server を起動して実機確認 → 問題発覚 → Phase A / A.5 / B-1 / B-2 で段階的に修正 | +5 commits |
| 7. 最終 vanilla audit | grep で残存 hex / カラーキーワード / fontFamily 直書きをスキャン → TemplateDetail.tsx を補修 | +1 commit |
| 8. conflict 調査 | main が並行で 42 commits 進行、6 ファイル overlap、2 ファイル実 conflict を検出 | 戦略決定 |
| 9. rebase | safety tag → `git rebase main` → 2 件解決 → main 由来の新規 vanilla style を補修 | +1 commit、計 19 commits |
| 10. ff-merge | main repo 側で `git merge --ff-only` 成功 | main 進行 |
| 11. cleanup | `ExitWorktree(remove)` で worktree 削除 → VSCode UI 側に「もぬけの殻」現象 | 教訓 |

## 主要決定（spec への補足）

W-01〜W-10 の本決定は [docs/dev/specs/2026-05-15_web_theme_design.md](../specs/2026-05-15_web_theme_design.md) に記録済み。本議事録ではセッション特有のプロセス決定を SW-NN として記録する。

### SW-01: Visual Companion を「視覚的判断が必要な質問だけ」に限定

Visual Companion は token-intensive なので、配色やフォント比較など「文字説明より見た方が早い」場面に絞って起動。スコープ・トリガ配置・遷移挙動の確認は terminal で実施。

### SW-02: Subagent-driven execution、モデルは task の複雑度で振り分け

- 単純な declarative ファイル作成（tokens.css / docs）→ Haiku
- TDD で test-implementation cycle が要る判断仕事（ThemeProvider など）→ Sonnet
- 各タスク完了ごとに spec reviewer + code quality reviewer を別サブエージェントで起動。本セッションでは全タスクが 1 round で APPROVED まで進んだ。

### SW-03: 視覚検証は phase 終端で必須化（事後反省）

plan は Final verification ステップで実機検証を行う設計だったが、subagent は long-lived dev server を動かせない都合で「user が後で見る」前提に。結果、見えない欠陥（CSS load 順、scope 漏れ）を抱えたまま完了報告まで進んでしまった。**今後は visual milestone に必ず human-in-the-loop の確認チェックポイントを挟む**。

### SW-04: 失敗の段階的修正は Phase A / B-N で命名

Spec を満たさない見え方が複数領域で見つかった際、

- Phase A: CSS load 順の修正（最小不可分の bug fix）
- Phase A.5: 同じ系統だが scope を広げた追加修正（CanvasOverlay 系）
- Phase B-N: spec の「全領域」要件を満たす component-wide な広げ作業

の命名で段階を明示し、各 phase 終わりに user が視覚確認するフローを確立した。

### SW-05: rebase 前 safety tag を打つ

並行作業との conflict 解決を伴う rebase 直前に `pre-rebase-design-color` という annotated tag を打ち、何かあれば元に戻れるようにした。rebase 完了後は `post-rebase-design-color` も打って ff-merge へ進んだ。タグは forensics 用途で保持。

### SW-06: ExitWorktree(remove) はディレクトリ削除を伴うことを事前周知

`ExitWorktree(action: "remove")` は worktree directory を物理削除する。VSCode が指していたパスが消えるため、user 視点では「空フォルダ」現象が発生する。**worktree 初心者には `keep` / `remove` の選択肢を事前提示すべき**だった。本セッションでの反省。

## 反省点（後続セッションへの申し送り）

### 反省 1: spec scope と plan coverage の乖離

spec §1 の完了条件で「全領域」（クローム + データ表示 + React Flow）を約束したのに、plan のファイル一覧は実質 TopNav と Settings + Template canvas しか触っていなかった。`InstanceDetail` 系コンポーネント（CanvasOverlay / SidebarTabs / event-renderers / sidebar-tabs / list cards 等）は手付かずで完了扱いになっていた。

**教訓**: spec scope が「全」のとき、plan の File Structure に「触らないファイル」も明示的に挙げ、reviewer が漏れを発見できる形にする。

### 反省 2: deferred visual verification が defect を隠す

plan の Step 6-3 / 7-3 / 8-3 / 9-6 で「dev server で目視確認」を含めたが、subagent が長期 foreground process を扱えないため build 確認だけで pass させた。最終的に user 確認時に多数の欠陥が判明し、Phase A / A.5 / B-1 / B-2 / TemplateDetail 補修と複数 round の修正が必要に。

**教訓**: TDD で unit test を書いていても **rendering が "意味のある外観"** になっているかは別問題。各 Phase 完了時に user の視覚承認をゲートにする。

### 反省 3: CSS load 順の罠（plan 内のリスク認識を実装で無視）

plan Step 9-2 で「`react-flow.css` を main.tsx に置くと xyflow base CSS に上書きされる可能性あり、その場合は TemplateCanvas に移すこと」と私自身が書いていたのに、subagent が plan 通り main.tsx に置いて完了させ、誰も再確認しなかった。Phase A の 1-commit 修正で解決。

**教訓**: plan に「if X then Y にする」型の条件分岐を残すなら、X が起きたか確認するステップも必ず添える。

### 反省 4: 並行作業との統合は post-rebase audit を必須に

main が rebase 中に 42 commits 進行していて、その中で `feat(web):` が 4 件入っていた。rebase 自動マージは 6 ファイル中 4 ファイルが auto-merge / 2 ファイルが conflict だったが、auto-merge できたファイルにも main 由来の vanilla hex が含まれており、design system を bypass していた（EventLogPane の `#8800aa`、BlackboardTab 全体）。

**教訓**: design system 系のブランチは rebase 後に必ず audit を再実行。post-merge も同様。

### 反省 5: per-type semantic 色の扱い

TYPE_BORDER / EDGE_COLOR / NODE_BORDER（CanvasOverlay）が styling.ts と CanvasOverlay.tsx で同じ hex を二重宣言している。本セッションでは「意図的に hex を残す」判断にしたが、共有先を 1 つにする (例: `packages/web/src/components/template-canvas/node-types.ts`) などの refactor 余地あり。

## 副産物

### コミット 19 件（main 上、`7721fab..cc396ce`）

```
cc396ce feat(web/theme): tokenize BlackboardTab and blackboard event row color
c901e82 feat(web/theme): tokenize TemplateDetail page header
9558b74 feat(web/theme): theme sidebar tabs, event renderers, and edge labels
2f4b423 feat(web/theme): theme TemplatesList and InstancesList cards
10871c9 feat(web/theme): theme-aware Instance detail page
98e5003 fix(web/theme): move react-flow.css import after xyflow base styles
0000007 docs(manuals): add theme switching runbook
30ccfa3 feat(web/theme): theme-aware React Flow canvas
0af4a4a feat(web/theme): add AppearanceSection to Settings page
9790d61 feat(web/theme): mount ThemeToggle in TopNav and tokenize colors
eedef81 feat(web/theme): wire ThemeProvider and FOUC prevention script
43955e8 feat(web/theme): add AppearanceSection 3-state radio
2156b4b feat(web/theme): add ThemeToggle button
0190d6a feat(web/theme): add ThemeProvider with system pref follow
68a9d22 feat(web/theme): wire fonts and base body tokens
11c0c47 feat(web/theme): add design tokens for light/dark
6e1a1fc docs(plans): add web theme implementation plan
fa263a3 docs(specs): add web theme design spec
7721fab chore(gitignore): ignore .superpowers/
```

### ドキュメント

- spec: [docs/dev/specs/2026-05-15_web_theme_design.md](../specs/2026-05-15_web_theme_design.md)
- plan: [docs/dev/plans/2026-05-15_web_theme.md](../plans/2026-05-15_web_theme.md)
- manual 追加: [docs/dev/manuals/user_test_manual.md](../manuals/user_test_manual.md) の §Web UI: テーマ切替

### コード

- `packages/web/src/styles/tokens.css` — Midnight Indigo Light / Dark の design tokens
- `packages/web/src/styles/react-flow.css` — xyflow 上書き
- `packages/web/src/theme/{ThemeProvider,ThemeToggle,AppearanceSection}.tsx` — 状態管理と切替 UI
- `packages/web/test/theme/*.test.tsx` — unit test 3 ファイル（合計 13 件）
- 各既存コンポーネントへの token 化（TopNav / Settings / TemplateCanvas / CanvasOverlay / sidebar-tabs/\* / event-renderers/\* / list cards / TemplateDetail / InstanceDetail / EventLogPane）

### 検証ステータス

- 全 5 パッケージで typecheck green
- web 45 tests pass / 0 fail（事前 32 + 新規テーマ 13）
- vanilla style audit clean（残る hex は per-type semantic 色のみ、tokens.css は当然除外）

### Safety tags（forensics 用、不要なら削除可）

```
pre-rebase-design-color  → cc3a03e（rebase 前）
post-rebase-design-color → cc396ce（rebase 後 = 現 main）
```

削除コマンド: `git tag -d pre-rebase-design-color post-rebase-design-color`

## 次のステップ（user 判断）

1. **動作確認**: dev server で全画面の最終視覚確認
2. **push**: 19 commits の origin/main 反映（user 判断）
3. **safety tag の削除**: 上記コマンド
4. **将来拡張**: spec §11 で挙げた

   - カスタムテーマ（ユーザーがトークンを個別上書き）
   - 高コントラストモード等の追加 preset
   - フォントカスタマイズ UI

   いずれも本 session で導入した design system 構造を温存したまま拡張可能。

## 参考

- spec: [docs/dev/specs/2026-05-15_web_theme_design.md](../specs/2026-05-15_web_theme_design.md)
- plan: [docs/dev/plans/2026-05-15_web_theme.md](../plans/2026-05-15_web_theme.md)
- 直近の handoff（runtime 側）: [docs/dev/handoff/2026-05-15.md](../handoff/2026-05-15.md)
- Phase 3 design: [docs/dev/specs/2026-05-14_phase3_design.md](../specs/2026-05-14_phase3_design.md)
