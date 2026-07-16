# DESIGN-LOG — link.pg72.tw morden_dark 視覺統一

目標:把 link.pg72.tw 前端視覺統一到 `morden_dark`（Linear / Modern 深色系），依 `docs/design-system.md`（權威來源 `../../morden_dark.txt`）。

## 嚴格邊界

- **只改視覺**。不動 OIDC BFF / session / redirect 邏輯與任何 API（`src/api.ts`、`src-worker/`、路由結構、狀態流全部保留）。
- 保留 a11y（focus ring、對比、`prefers-reduced-motion`、aria/title 屬性）。
- 增量 commit，**不 push**（production 由主線 `wrangler pages deploy` 處理）。
- 每步跑 build 驗證，不弄壞。

## 技術盤點

- React 18 + react-router-dom v6 + **Tailwind CSS v4**（CSS-first，`@import "tailwindcss"`，無 `tailwind.config`）。
- Vite build，Cloudflare Pages worker（`dist/_worker.js`）。
- 原樣式:寫死 `slate-*` / `blue-*`，`bg-slate-950` 底、`bg-blue-600` 按鈕。
- 使用者可見頁:`LoginPage`、`DashboardPage`、`AdminPage`、`NotFoundPage`、`components/QRModal`。

## 主題落地策略

集中 token 到 `src/index.css`：

- `@theme` 定義色票（`--color-bg-base #050506`、`--color-accent #5E6AD2` 等）→ 產生 `bg-bg-base`、`text-fg`、`bg-accent` 等 utility。
- `:root` 放 surface/border/glow rgba 與 `--ease-expo`。
- `@layer components` 提供可重用類別：`.app-bg`（分層環境光背景:徑向漸層 + 浮動 blob + grid overlay）、`.card` / `.card-hover`（多層陰影）、`.btn` / `.btn-primary`（accent glow + shine sweep）/ `.btn-secondary` / `.btn-ghost`、`.input`（focus glow ring）、`.label-mono`（mono 大寫技術小標）。
- Inter + Geist Mono 由 `index.html` Google Fonts 載入；`theme-color` 改 `#050506`。
- `prefers-reduced-motion` 全域降級動畫。

換色/改風格只需動 `index.css` 第 2 節 token。

## 進度

### Step 1 — 主題基礎 ✅

- 重寫 `src/index.css`：新增 `@theme` token、base 背景、component utilities（card/btn/input/label/app-bg）、reduced-motion。
- `index.html`：載入 Inter/Geist Mono，`theme-color` → `#050506`。
- `App.tsx`：載入畫面改用 `.app-bg` + token 色。
- 驗證:`npm run build` 通過，CSS 由 26.5KB → 30.4KB，utility 類別確認生成。
- 未動任何邏輯/API。

### Step 2 — LoginPage ✅

- 使用者第一眼頁面。改 `.app-bg` 背景、`.card` 容器包登入區、accent icon glow、`.btn-primary` PGID 登入鈕、`.label-mono` 標語、token 化文字色與錯誤框。
- 保留 `href="/api/auth/login"`、error query param 邏輯、aria-hidden。

### Step 3 — DashboardPage ✅

- 主要操作頁。header/新增卡/清單卡改 `.card`、`.btn-primary`/`.btn-secondary`/`.input`、accent icon glow、token 色、`.label-mono` 區塊小標、hover/focus 對齊 expo-out。
- 保留所有 state、handler、API 呼叫、confirm/clipboard 行為與 DOM 結構。

### Step 4 — AdminPage ✅

- 管理後台。header/tab/表格卡改 token 與 component 類別、狀態 badge 對齊 accent 語彙、`.btn-secondary` 登出、hover row token 化。
- 保留 tab 切換、prompt/confirm、adminApi 呼叫、資料流。

### Step 5 — QRModal + NotFoundPage ✅

- QRModal:overlay/卡片/按鈕 token 化，QR 本體保持白底（掃描需求）。
- NotFoundPage:底色對齊近黑 `#050506`/deep，返回鈕改 token，保留太空人與星空動畫（本頁刻意保留趣味性,僅對齊底色與 accent）。

> commit hashes 見交接回報 / `git log`。每步都跑 build 驗證。

## 驗證彙整

- `npm run build`（vite + esbuild worker）:通過。
- `npx tsc --noEmit`（app + worker tsconfig）:通過。
- `npm test`（vitest）:見最終回報。
- 未部署（依規則交主線）。
