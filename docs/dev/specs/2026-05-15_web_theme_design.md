# Web Theme 設計仕様書

**作成日:** 2026-05-15
**ステータス:** 実装着手用ドラフト
**対象パッケージ:** `packages/web` のみ
**並行作業との関係:** Phase 3 (runtime / Codex provider) とは完全に独立。`packages/runtime` / `packages/core` / `packages/server` / `packages/cli` には一切手を入れない。

本書は legion web UI に **Light / Dark テーマ機構** を導入するためのサブ実装の設計を、実装着手者がそのまま読める形に凝縮したものです。コードを書く前に読んでください。

## 1. 目的と完了定義

**成果物:** legion web に CSS 変数ベースのデザイントークン体系と、`Light / Dark / System に追従` の 3 mode を切替可能なテーマ機構を導入する。配色は `Midnight Indigo`、フォントは Inter (英) + Murecho (和) の bundle 同梱（self-host）。React Flow のキャンバスもテーマに追従する。

完了条件:

- ユーザーは TopNav のトグルアイコンで Light↔Dark を即時切替できる。
- ユーザーは Settings ページの "Appearance" セクションで Light / Dark / System の 3 択を明示選択できる。
- 選択は `localStorage` に永続化され、リロード後も維持される。
- 初回アクセスでは OS の `prefers-color-scheme` に従ったテーマで表示される。
- React Flow のノード・エッジ・グリッド・コントロールがテーマトークンに従って描画される。
- リロード時に Light → Dark のチラつき (FOUC) が発生しない。
- 3 つの unit test がパスする（ThemeProvider / ThemeToggle / AppearanceSection）。

完了の範囲外（§10 参照）: ユーザー定義テーマ、テーマプリセットの動的追加、高コントラストモード、フォントカスタマイズ UI。

## 2. スコープと前提

### 2.1 スコープ

`packages/web` 配下のみを変更する。具体的には:

- 新規ファイル: `src/theme/` 配下 3 ファイル、`src/styles/` 配下 2 ファイル、`test/theme/` 配下 3 ファイル
- 変更ファイル: `src/main.tsx`、`src/styles.css`、`src/components/TopNav.tsx`、`src/pages/Settings.tsx`、`index.html`、`package.json`

`packages/runtime` / `packages/core` / `packages/server` / `packages/cli` / `packages/web/src/api` は **触らない**。runtime チームの Phase 3 作業と物理的に競合しない。

### 2.2 前提決定（本書で確定）

| 番号 | 決定 | 採用案 |
|---|---|---|
| W-01 | テーマがカバーする UI 範囲 | クローム + データ表示 + React Flow（全領域） |
| W-02 | 初回アクセスのデフォルト | OS の `prefers-color-scheme` に追従、ユーザー選択は `localStorage` に保存 |
| W-03 | 切替 UI の置き場 | TopNav トグル（クイック）+ Settings 3 択ラジオ（明示） |
| W-04 | 配色方向 | Midnight Indigo |
| W-05 | 実装アプローチ | CSS 変数 + `data-theme` 属性 + React Context（外部ライブラリ非依存） |
| W-06 | フォント配布方式 | `@fontsource-variable/*` で self-host バンドル |
| W-07 | 英語フォント 1st | Inter |
| W-08 | 日本語フォント 1st | Murecho（Inter とのペアリングを明示設計された和文） |
| W-09 | フォント fallback chain | 1st: self-host / 2nd: Roboto・Noto Sans JP（宣言のみ、CDN ロードはしない）/ 3rd: ベストシステムフォント |
| W-10 | モノスペースフォント | JetBrains Mono |

## 3. アーキテクチャ概要

```
┌─ <html data-theme="dark"> ──────────────────────────────────┐
│                                                              │
│  CSS layer                                                   │
│    :root { --bg-canvas, --fg-primary, --accent, ... }       │
│    [data-theme="dark"] { ... 同じトークンを上書き }          │
│    .react-flow__node { background: var(--node-bg); ... }    │
│                                                              │
│  React layer                                                 │
│    <ThemeProvider>                                           │
│      ├─ resolve(): system | localStorage → 'light' | 'dark'│
│      ├─ effect: <html data-theme={resolved}>                │
│      ├─ effect: matchMedia change を購読 (mode='system' 時) │
│      └─ context: { mode, setMode, resolved }                │
│                                                              │
│    <App>                                                     │
│      <TopNav>     → <ThemeToggle> (consumes context)         │
│      <Settings>   → <AppearanceSection> (consumes context)   │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 状態モデル

```ts
type Mode = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

type ThemeContextValue = {
  mode: Mode           // ユーザーの選択（localStorage と同期）
  resolved: Resolved   // DOM に書く実値
  setMode: (m: Mode) => void
}
```

- `mode === 'system'` のとき `resolved` は `matchMedia('(prefers-color-scheme: dark)').matches` から計算
- `mode === 'light' | 'dark'` のとき `resolved = mode`
- `<html>` の `data-theme` 属性に書くのは `resolved`

### 3.2 永続化

- localStorage key: `legion.web.theme`
- 値: `'light' | 'dark' | 'system'` のいずれか
- 初回起動（key なし）: 既定値 `'system'`
- `setMode(m)` は state 更新と同時に localStorage を書き換える

### 3.3 OS pref 変更追従

- `mode === 'system'` のときだけ `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)` で OS 設定変更を購読
- `mode === 'light' | 'dark'` のときは購読しない（明示選択を尊重）

## 4. デザイントークン (Midnight Indigo)

### 4.1 全トークン一覧

| カテゴリ | トークン | Light | Dark | 用途 |
|---|---|---|---|---|
| 背景 | `--bg-canvas` | `#f1f5f9` | `#0c0a1a` | ページ全体の背景 |
| 背景 | `--bg-surface` | `#ffffff` | `#1e1b4b` | カード・パネル・ノード |
| 背景 | `--bg-elevated` | `#ffffff` | `#2a2660` | モーダル・hover state |
| テキスト | `--fg-primary` | `#1e1b4b` | `#e0e7ff` | 本文 |
| テキスト | `--fg-muted` | `#475569` | `#a5b4fc` | 二次情報・メタ |
| テキスト | `--fg-subtle` | `#94a3b8` | `#6366f1` | placeholder・hint |
| 境界線 | `--border-default` | `#e2e8f0` | `#312e81` | カード境界・divider |
| 境界線 | `--border-strong` | `#cbd5e1` | `#4338ca` | 強調・focus 周辺 |
| アクセント | `--accent` | `#6366f1` | `#a5b4fc` | primary CTA・active link |
| アクセント | `--accent-hover` | `#4f46e5` | `#c7d2fe` | hover state |
| アクセント | `--accent-fg` | `#ffffff` | `#1e1b4b` | accent 背景上のテキスト |
| ステータス | `--status-running` | `#6366f1` | `#a5b4fc` | 実行中 |
| ステータス | `--status-success` | `#10b981` | `#34d399` | 完了 |
| ステータス | `--status-warning` | `#f59e0b` | `#fbbf24` | 警告・要承認 |
| ステータス | `--status-error` | `#ef4444` | `#f87171` | 失敗 |
| React Flow | `--node-bg` | `#ffffff` | `#1e1b4b` | ノード背景（surface 同期） |
| React Flow | `--node-border` | `#c7d2fe` | `#4338ca` | ノード枠線 |
| React Flow | `--edge` | `#818cf8` | `#818cf8` | エッジ（両モード共通） |
| React Flow | `--canvas-grid` | `#e0e7ff` | `#312e81` | 背景ドットグリッド |

### 4.2 フォントスタック

```css
:root {
  --font-base:
    'Inter', 'Murecho',                                     /* 1st: self-host */
    'Roboto', 'Noto Sans JP',                               /* 2nd: 宣言のみ */
    -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
    'Hiragino Sans', 'Hiragino Kaku Gothic ProN',
    'Yu Gothic UI', 'Yu Gothic', 'Meiryo',                  /* 3rd: system */
    sans-serif;

  --font-mono:
    'JetBrains Mono',                                       /* 1st: self-host */
    'Fira Code', 'Cascadia Code',                           /* 2nd: 宣言のみ */
    ui-monospace, 'SF Mono', 'Consolas', 'Menlo',
    monospace;                                              /* 3rd: system */
}
```

- 2nd 候補（Roboto / Noto Sans JP / Fira Code / Cascadia Code）は **CSS 上の宣言のみ**。CDN 経由でロードしない。OS にプリインストールされている環境（Android、開発者環境）で副次的に利く保険。
- 1st の self-host が build 時に bundle に含まれるため、運用上は 1st が常に効く前提。

## 5. 切替 UI 挙動

### 5.1 TopNav トグル

- 配置: TopNav 右端、`margin-left: auto` で右寄せ
- サイズ: 24×24px の円形ボタン
- アイコン: `resolved === 'light'` のとき ☀（sun glyph）、`'dark'` のとき ☾（moon glyph）
- クリック挙動:
  - 現在の `resolved` の **逆** を `mode` に明示セットする。
  - 例: `mode='system'` で `resolved='light'` → クリック後 `mode='dark'`
  - つまりトグル後は `mode` が必ず `'light'` か `'dark'` になる（明示選択モードへ移行）。
- `aria-label`: resolved に応じて `"Switch to dark theme"` / `"Switch to light theme"`
- ホバー時: `var(--accent)` の薄いリング
- `prefers-reduced-motion` を持つ環境ではアイコン切替の transition を省略

### 5.2 Settings "Appearance" セクション

既存の Phase 1.5 プレースホルダの直上に挿入する。

```
Appearance
  ○ Light
  ○ Dark
  ● System に追従   ← mode='system' のとき選択状態
```

- 3 択ラジオ（HTML `<input type="radio">`）
- ラジオ選択で `setMode('light' | 'dark' | 'system')` を直接呼ぶ
- `'System に追従'` を選択すると localStorage は `'system'` に戻り、以降 OS 設定追従に復帰
- TopNav トグルでの明示選択（`'light' | 'dark'`）はここに同期表示される

### 5.3 同期

- 単一の `ThemeContext` を `<App>` 直下で provide。`TopNav` と `Settings` 双方が consume。
- 一方を操作するともう一方に即座に反映される（React state の自然な伝播）。

### 5.4 遷移アニメーション

```css
body {
  transition: background-color 180ms ease, color 180ms ease;
}

.react-flow,
.react-flow * {
  transition: none !important;   /* キャンバスはカクつき防止のため瞬時切替 */
}

@media (prefers-reduced-motion: reduce) {
  body { transition: none; }
}
```

`body` に当てる理由: 背景色トークン `--bg-canvas` は `body { background: var(--bg-canvas); }` で適用されるため、遷移ターゲットも `body`。`html` 要素は背景を持たない。

## 6. 実装アウトライン

### 6.1 ファイル構成と予測行数

**新規:**

| パス | 内容 | 予測行数 |
|---|---|---|
| `packages/web/src/theme/ThemeProvider.tsx` | React Context / localStorage / matchMedia 制御 | ~80 |
| `packages/web/src/theme/ThemeToggle.tsx` | TopNav 用円形アイコンボタン | ~50 |
| `packages/web/src/theme/AppearanceSection.tsx` | Settings 用 3 択ラジオ | ~50 |
| `packages/web/src/styles/tokens.css` | `:root` と `[data-theme="dark"]` のトークン定義（§4.1） | ~140 |
| `packages/web/src/styles/react-flow.css` | @xyflow クラス上書き（§8） | ~60 |
| `packages/web/test/theme/ThemeProvider.test.tsx` | unit test | ~80 |
| `packages/web/test/theme/ThemeToggle.test.tsx` | unit test | ~40 |
| `packages/web/test/theme/AppearanceSection.test.tsx` | unit test | ~40 |

新規合計: 約 540 行。

**変更:**

| パス | 変更内容 | 増減 |
|---|---|---|
| `packages/web/src/main.tsx` | `<ThemeProvider>` で wrap、`@fontsource-variable/*` を import、新 CSS を import | +10 |
| `packages/web/src/styles.css` | base reset のみに縮小（トークンは tokens.css へ移動） | ほぼ同 |
| `packages/web/src/components/TopNav.tsx` | inline hex を `var(--...)` に置換、`<ThemeToggle/>` をマウント | 約 +5 |
| `packages/web/src/pages/Settings.tsx` | `<AppearanceSection/>` を挿入 | +15 |
| `packages/web/index.html` | FOUC 防止インラインスクリプト（§7）を `<head>` に追加 | +12 |
| `packages/web/package.json` | `@fontsource-variable/{inter,murecho,jetbrains-mono}` を deps に追加 | +3 |

変更合計: 約 +50 行。

各ファイルは legion のリファクタ閾値（class 500 / function 100 / file 1000）に十分収まる。

### 6.2 依存追加

```json
"dependencies": {
  "@fontsource-variable/inter": "^5",
  "@fontsource-variable/murecho": "^5",
  "@fontsource-variable/jetbrains-mono": "^5"
}
```

variable font の単一ファイルを使う。weight 400/500/600/700 は同一ファイルから取り出せるため、各フォントにつき WOFF2 1 つで済む。

### 6.3 ファイル配置とインポート順

`main.tsx`:

```ts
import '@fontsource-variable/inter'
import '@fontsource-variable/murecho'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'           // base reset のみ
import './styles/tokens.css'    // CSS variables
import './styles/react-flow.css' // @xyflow overrides
import { ThemeProvider } from './theme/ThemeProvider'

// ...

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
```

## 7. FOUC 防止

React が起動して `<html data-theme>` をセットするまでに数十〜数百ミリ秒の遅延がある。その間、ブラウザはデフォルト（白背景）で描画してしまうため、Dark を選んでいるユーザーには Light → Dark のチラつきが見える。

回避策: `index.html` の `<head>` 最上部（CSS link より前）に同期スクリプトを置き、React 起動前に `data-theme` を確定させる。

```html
<script>
  (function() {
    try {
      var mode = localStorage.getItem('legion.web.theme') || 'system';
      var resolved = mode === 'system'
        ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;
      document.documentElement.setAttribute('data-theme', resolved);
    } catch (e) {}
  })();
</script>
```

- localStorage / matchMedia がブロックされる環境（プライベートブラウズ等）でも try/catch で安全に fallback（既定の light）。
- `ThemeProvider` 初回 mount 時に同じ計算をするため、結果は一致する（state と DOM 属性の二重ソースは Provider 側を信頼）。

## 8. React Flow 統合

`packages/web/src/styles/react-flow.css` に以下のクラスを上書きする。

```css
.react-flow__node {
  background: var(--node-bg);
  border: 1px solid var(--node-border);
  color: var(--fg-primary);
  border-radius: 6px;
  font-size: 13px;
  padding: 6px 10px;
}

.react-flow__node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}

.react-flow__edge-path {
  stroke: var(--edge);
  stroke-width: 1.5;
}

.react-flow__edge.selected .react-flow__edge-path {
  stroke: var(--accent);
  stroke-width: 2;
}

.react-flow__background {
  background-color: var(--bg-surface);
}
/* dot color は React Flow の bgColor prop で var(--canvas-grid) を渡す or pattern <circle fill> を CSS で上書き */

.react-flow__controls {
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  overflow: hidden;
}

.react-flow__controls button {
  background: transparent;
  color: var(--fg-primary);
  border-bottom: 1px solid var(--border-default);
}

.react-flow__controls button:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.react-flow__minimap {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
}
```

注: React Flow の `<Background>` コンポーネントは dot を SVG `<circle fill>` で描画するため、`color` prop に CSS 関数（`var(--...)`）を直接渡しても解決されない。JS 側で実値を取得して prop として渡す必要がある。

実装パターン:

```tsx
const [dotColor, setDotColor] = useState('')
const { resolved } = useTheme()
useEffect(() => {
  const cs = getComputedStyle(document.documentElement)
  setDotColor(cs.getPropertyValue('--canvas-grid').trim())
}, [resolved])

return <Background color={dotColor} />
```

`resolved` が変わるたびに再読込することで Light/Dark 切替に追従する。対象箇所は [packages/web/src/components/TemplateCanvas.tsx](packages/web/src/components/TemplateCanvas.tsx) と [packages/web/src/components/template-canvas/](packages/web/src/components/template-canvas/) 配下の `<Background>` 使用箇所。

## 9. テスト方針

### 9.1 Unit test

3 つの `*.test.tsx` を `packages/web/test/theme/` 配下に配置する。

**ThemeProvider.test.tsx** (~80 行):
- 初回マウント: localStorage key 無しで `mode='system'`、`prefers-color-scheme: dark` で `resolved='dark'`
- 初回マウント: localStorage に `'light'` がある場合 `mode='light'`、`resolved='light'`
- `setMode('dark')` 呼び出し後、state / localStorage / `<html data-theme>` の 3 つが同期して更新される
- `mode='system'` で matchMedia の change イベント発火時、`resolved` が追従する
- `mode='light'` のとき matchMedia change イベントを発火させても `resolved` は変わらない

**ThemeToggle.test.tsx** (~40 行):
- `resolved='light'` のとき sun アイコンが描画される
- `resolved='dark'` のとき moon アイコンが描画される
- クリックで `setMode` が `resolved` の逆値で呼ばれる
- `aria-label` が resolved に応じて変化する

**AppearanceSection.test.tsx** (~40 行):
- 3 つのラジオが描画される
- 現在の `mode` に対応するラジオが `checked` になる
- 各ラジオの onChange で `setMode(該当値)` が呼ばれる

テスト基盤は既存の `@testing-library/react` + `happy-dom` + `bun test` を利用。`matchMedia` と `localStorage` は happy-dom が提供するモックを使う。

### 9.2 契約テスト

**不要**。本機能で扱う外部依存は localStorage / matchMedia / `document` の **プラットフォーム標準 API** のみで、SDK の mock を伴わない。legion の `Test Policy: Mocks Require Contract Tests`（CLAUDE.md §Test Policy）に該当しない。

なお `@fontsource-variable/*` も build-time asset 同梱であり、runtime 挙動の mock は発生しない。

### 9.3 手動確認

[docs/dev/manuals/user_test_manual.md](docs/dev/manuals/user_test_manual.md) に下記の runbook を追加する:

- 初回アクセス時に OS 設定（dark/light）と一致するテーマで表示されること
- TopNav トグルクリックで即座に切替わること（リロード後も維持）
- Settings の `'System に追従'` ラジオで OS 追従に戻ること
- OS 設定を切替えたとき、`mode='system'` のときだけ自動追従すること
- リロード時に FOUC（一瞬の白背景）が起きないこと
- React Flow キャンバスの背景・ノード・エッジ・コントロールが Dark でも視認できること

## 10. 並行作業との影響範囲

### 10.1 Phase 3 (runtime / Codex provider) との競合

- 変更対象は `packages/web/` のみ。`packages/runtime` / `packages/core` / `packages/server` / `packages/cli` に変更なし。
- `packages/web/package.json` の `dependencies` 追加（@fontsource-variable/* 3 つ）は workspace root の lockfile を更新するが、これは web パッケージ専用依存であり runtime チームのビルドには影響しない。
- 競合の可能性がある唯一の点: `packages/web/src/components/TopNav.tsx` を runtime 側が同時期に編集している場合。実装着手前に runtime チームに確認すること。

### 10.2 API 互換性

- `packages/web/src/api` 配下は触らない。runtime ↔ web の通信 contract は不変。

## 11. 将来拡張（本書のスコープ外）

- **カスタムテーマ**: ユーザーが個別トークン（accent 色等）を上書きできる UI。本書の token 構造はそのまま利用可能。
- **テーマプリセット追加**: `[data-theme="high-contrast"]` のような追加プリセット。
- **テーマパックのエクスポート / インポート**: JSON or CSS をユーザーがアップロード。
- **フォントカスタマイズ UI**: Settings から fontFamily を選択。

いずれも本書で導入する CSS 変数 + `data-theme` 機構をそのまま拡張する形で実装できる。
