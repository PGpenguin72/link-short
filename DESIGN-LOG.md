# DESIGN-LOG — link.pg72.tw morden_dark 視覺統一

目標:把 link.pg72.tw 前端視覺統一到 `morden_dark`（Linear / Modern 深色系）。目前實作的 token source of truth 是 `src/index.css`；調整主題時以該檔案為準。

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

### Step 4 — AdminPage ✅（`bf9ef57`）

- 管理後台。header/tab/表格卡改 token 與 component 類別、狀態 badge 對齊 accent 語彙、`.btn-secondary` 登出、hover row token 化。
- 前次 session 於 users table 中斷（API 503），本次接手檢視半成品可用，補完：兩個空表 row、admin dash `text-fg-subtle`、`TabButton` token 化（active `bg-white/[0.08]`）。
- 保留 tab 切換、prompt/confirm、adminApi 呼叫、資料流。

### Step 5 — QRModal + NotFoundPage ✅（`80581fb`）

- QRModal:卡片改 `.card`、關閉鈕/次要鈕 token 化，URL 改 accent，分享主鈕 `bg-accent` + glow；QR 本體保持白底（掃描需求）。
- NotFoundPage:背景漸層對齊 `#020203`/`#0b0c1c` 深底，404 漸層起點改 accent-bright `#6872d9`，文字與返回鈕 token 化（hover `border-accent/40`），保留太空人與星空動畫（本頁刻意保留趣味性；`via-purple-400 to-pink-400` 為刻意殘留）。

## Commit 清單（本輪視覺重塑）

- `c08b3c8` Add morden_dark design tokens and theme foundation（Step 1）
- `6f5812b` Restyle LoginPage to morden_dark（Step 2）
- `d8d66d4` Restyle DashboardPage to morden_dark（Step 3）
- `bf9ef57` Restyle AdminPage to morden_dark（Step 4）
- `80581fb` Restyle QRModal and NotFoundPage to morden_dark（Step 5）

## 驗證彙整（2026-07-16 完成時）

- `npm run check`（tsc app + tsc worker + vitest + build）:通過。
- `npm test`:4 files / 13 tests 全數通過（含 OIDC protocol、identity、route security tests）。
- `npm run build`（vite + esbuild worker）:通過，CSS 28.99KB。
- 殘留掃描:`src/` 已無 slate-*/blue-*/purple-* 硬編碼（僅 404 標題趣味漸層刻意保留）。
- 未動 `src/api.ts`、`src-worker/`、路由與 auth 邏輯；token endpoint 維持 ClientSecretPost 未觸碰。
- 未 push、未部署（依規則交 owner 決定）。
