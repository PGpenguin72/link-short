# Link Shortener

使用 Cloudflare Pages + D1 + Google OAuth 建立的短網址系統。

## 功能

- Google 登入（僅允許指定信箱）
- 建立短網址（自訂或自動產生短代碼）
- 編輯短代碼與目標網址
- 刪除短網址
- 任何人可使用短網址跳轉

---

## 部署步驟

### 1. 建立 Google OAuth 應用程式

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立新專案 → APIs & Services → Credentials
3. 建立 **OAuth 2.0 Client ID**（類型選 Web application）
4. 在 **Authorized redirect URIs** 加入：
   ```
   https://你的網域.pages.dev/api/auth/callback
   ```
5. 記下 Client ID 和 Client Secret

### 2. 建立 Cloudflare D1 資料庫

```bash
npm run db:create
```

執行後複製輸出的 `database_id`，填入 `wrangler.toml`：

```toml
database_id = "貼上你的 database_id"
```

### 3. 建立資料表

```bash
# 套用至正式環境
npm run db:migrate

# 本地開發
npm run db:migrate:local
```

### 4. 在 Cloudflare Pages 設定環境變數

前往 Cloudflare Dashboard → Pages → 你的專案 → Settings → Environment variables，新增：

| 變數名稱 | 值 |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `ALLOWED_EMAIL` | 你的 Gmail 信箱 |

### 5. 連結 GitHub 並部署

1. 將此 repo push 到 GitHub
2. 前往 Cloudflare Pages → Create a project → Connect to Git
3. 選擇此 repo，設定：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. 綁定 D1 資料庫：Settings → Functions → D1 database bindings → 新增 `DB`
5. 部署！

---

## 本地開發

```bash
# 安裝依賴
npm install

# 複製並填寫環境變數
cp .dev.vars.example .dev.vars  # 編輯 .dev.vars

# 初始化本地 D1
npm run db:migrate:local

# 啟動（先 build 再用 wrangler 本地模擬）
npm run dev:worker
```

或單獨啟動前端（API 不可用）：
```bash
npm run dev
```

---

## 技術架構

- **前端**: React + Vite + Tailwind CSS v4
- **後端**: Hono (Cloudflare Pages Functions)
- **資料庫**: Cloudflare D1 (SQLite)
- **認證**: Google OAuth 2.0
