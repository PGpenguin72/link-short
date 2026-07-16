# link.pg72.tw PGID Production Cutover Runbook

目標:將 production `link.pg72.tw` 的登入從舊 Google/email 身分切換到 PGID(issuer `https://sso.pg72.tw`)。

- 部署形態:Cloudflare **Pages**(Advanced Mode,`dist/_worker.js`),專案名 `link-short`。
- Production D1:binding `DB` → database `link-short-db`(`database_id: 96056517-46ea-4fdf-a38b-6544b265d682`)。
- 對應程式版本:本 runbook 所在的已審核 release commit(部署前以 `git rev-parse HEAD` 記錄;本機驗證須通過完整 `npm run check`)。
- 參照流程:Copy 已完成的切換順序 — 備份 D1 → 建 client → 設 secrets → 套 migration → 部署 → 煙霧測試。

> 執行者需求:已 `wrangler login` 且對 Pages 專案 `link-short` 與 D1 `link-short-db` 有權限的帳號。
> 標注「**Owner 親手做**」的步驟必須由 owner 操作(建 client、產生與存放 secret)。
> 除非另有註明,以下指令均從 Link repository root 執行。

---

## 0. 前置檢查(本機,唯讀)

```bash
git status              # 必須 clean,HEAD 在 master
git log -1 --oneline    # 確認要部署的 commit
npm ci
npm run check           # tsc x2 + 全部 vitest + build,必須全綠
```

確認 SSO 端 discovery 正常(公開端點,唯讀):

```bash
curl -s https://sso.pg72.tw/.well-known/openid-configuration | head -c 400
# 必須回 JSON 且 issuer 為 https://sso.pg72.tw
```

## 1. 備份 production D1

```bash
mkdir -p backups

# 1a. 完整 SQL 匯出(存放於 repo 外或確認不 commit;backups/ 不在版控中)
npx wrangler d1 export link-short-db --remote \
  --output=backups/link-short-db-$(date +%Y%m%dT%H%M%S).sql

# 1b. 記錄 Time Travel 還原點(把 bookmark 抄下來)
npx wrangler d1 time-travel info link-short-db
```

記錄目前資料量,migration 後比對:

```bash
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM sessions) AS sessions;"
```

確認 production schema 目前狀態(決定要套哪些 migration):

```bash
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
npx wrangler d1 execute link-short-db --remote --command "PRAGMA table_info(users);"
npx wrangler d1 execute link-short-db --remote --command "PRAGMA table_info(sessions);"
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT COUNT(*) AS normalized_email_duplicate_groups FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1);"
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email_normalized';"
```

判讀:

- `users` 表存在、`links` 有 `owner_email` → `migration-002.sql` 已套用(預期如此,**不要**重跑)。
- 若 `users`/`links.owner_email` 不存在(不預期),先套 `migration-002.sql` 再繼續。
- `sessions` 有 `email` 欄、`users` 沒有 `sso_subject` → 尚未套 `migration-003`,照本 runbook 繼續。
- `normalized_email_duplicate_groups` 必須精確為 `0`。大於 0 時立即停止;不要輸出完整 email 到 issue/chat,由 owner 離線核對重複帳號與 `links.owner_email` 歸屬並清理後重跑。不可任選一列或用 email 自動合併。
- 若 `users.sso_subject` 已存在,表示 migration-003 已套過,步驟 4 只處理尚未套用的 migration-004,不可直接跳到部署。
- 查到 `idx_users_email_normalized` 表示 migration-004 已套過;否則步驟 4 必須套用。

## 2. 在 PGID 建立 OIDC client(**Owner 親手做**)

Owner 在 PGID admin UI 建立 client,欄位值如下:

| 欄位 | 值 |
| --- | --- |
| Client ID | `pg72-link` |
| 名稱 | `PG72 Link` |
| 類型 | `web`(confidential,非 public client) |
| Client Secret | Owner 產生高熵 secret(建議 ≥ 32 bytes 隨機、base64url;長度 ≤ 512 字元、不得含控制字元),**直接放進 secret store,不落地、不貼到聊天或檔案** |
| Redirect URIs | `https://link.pg72.tw/api/auth/callback`(精確比對,production 只此一筆) |
| Post-logout redirect URIs | 留空(Link 未實作 RP-initiated logout) |
| End session | 停用(`enableEndSession = 0`) |
| Token endpoint auth method | `client_secret_post`(必須與 Worker 的 `oauth.ClientSecretPost` 一致,不可設為 Basic) |
| Grant types | `authorization_code`(僅此一項,不需 refresh token) |
| Response types | `code` |
| Scopes | `openid`、`email`(Worker 固定請求 `openid email`,需要 UserInfo 回傳 `email` 與 `email_verified`) |
| PKCE | 必須(`requirePKCE = 1`,S256) |
| Subject type | `public` |
| Skip consent | 否(`skipConsent = 0`,Link 不可略過 consent) |
| Disabled | 否 |
| Metadata / backchannel_logout_uri | 留空(Link back-channel logout 尚未實作,屬後續工作) |

注意:preview(`pg72-link-preview`)與 local(`pg72-link-local`)是**不同 client、不同 secret**,本次 production cutover 不動它們。

## 3. 設定 production secrets(**Owner 親手做:貼入 secret 值**)

Pages 的 `vars`(`APP_BASE_URL`、`PG72_ID_ISSUER`、`PG72_ID_CLIENT_ID=pg72-link`)已寫在 `wrangler.toml` `[vars]`,`wrangler pages deploy` 時自動套用,不需在 dashboard 另設(若 dashboard 已有同名變數,以 `wrangler.toml` 為 source of truth,移除 dashboard 上的重複設定避免衝突)。

只需設定 secret:

```bash
npx wrangler pages secret put PG72_ID_CLIENT_SECRET --project-name=link-short
# 提示時貼入步驟 2 的 client secret(此值同時是 OIDC transaction cookie 的 HMAC key)
```

`BOOTSTRAP_ADMIN_EMAIL` **不需要設定**:production `users` 已有 `is_admin = 1` 的既有帳號,owner 以相同 verified email 首次登入 PGID 時會自動綁定 `sub` 並保留管理員身分(bootstrap 只在全新空資料庫才有意義)。

## 4. Write freeze、最終備份與 D1 migrations

切換開始後到步驟 6 完成前,必須維持可驗證的 write freeze:由 owner 使用既有 Cloudflare edge/maintenance control 讓 Link 的建立、編輯、刪除與管理 mutation 回 `503`,但保留 `GET`/`HEAD /:slug` 轉址。若沒有可實際阻擋 mutation 的控制,停止 cutover;只公告維護時段不算 write freeze。

啟用後先驗證 mutation 已被擋,再重做**最終**備份與計數。這一份 export/bookmark 才是 rollback anchor,不可使用 write freeze 前可能已過期的備份:

```bash
# 以一個現有測試帳號/請求驗證 mutation 回 503;不要在 shell history 放 session cookie
mkdir -p backups

# 4a. 最終 SQL 匯出
npx wrangler d1 export link-short-db --remote \
  --output=backups/link-short-db-final-$(date +%Y%m%dT%H%M%S).sql

# 4b. 最終 Time Travel 還原點(把 bookmark 抄下來)
npx wrangler d1 time-travel info link-short-db
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM sessions) AS sessions;"
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT COUNT(*) AS normalized_email_duplicate_groups FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING COUNT(*) > 1);"
```

最後一個 duplicate count 仍必須精確為 `0`;否則維持 freeze、停止切換。

依步驟 1 判讀結果套用尚未執行的 migration,順序固定為 003 → 004。**不要**對既有 production 執行 `schema.sql`(那是全新安裝用):

```bash
# users 尚無 sso_subject 時才執行;會清除所有既有 session
npm run db:migrate:oidc
# = npx wrangler d1 execute link-short-db --remote --file=migration-003-pg72-oidc.sql

# idx_users_email_normalized 尚不存在時才執行
npm run db:migrate:email-identity
# = npx wrangler d1 execute link-short-db --remote --file=migration-004-email-identity.sql
```

內容與影響:

- `users` 加 `sso_subject` 欄 + 唯一索引(非破壞性;既有使用者全數保留,`sso_subject` 先為 NULL)。
- 新建 `auth_bootstrap` 表(非破壞性)。
- **破壞性**:`sessions` 改為以 `sso_subject` 為鍵的新表,舊 `sessions` 表整個 DROP → 所有既有登入 session 立即作廢,全站使用者需重新登入(刻意設計:跨身分系統的舊 session 不可信)。
- migration-004 新增 `unique(lower(email))`;若仍有大小寫重複資料,整個 migration 失敗且不建立 index。保持 freeze、停止切換並人工釐清,不可略過。
- 不動 `links`、不刪任何 user。

驗證:

```bash
npx wrangler d1 execute link-short-db --remote --command "PRAGMA table_info(users);"     # 應有 sso_subject
npx wrangler d1 execute link-short-db --remote --command "PRAGMA table_info(sessions);"  # 應有 sso_subject,無 email
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_email_normalized';" # 應有一列
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM sessions) AS sessions;"
# users/links 數量須與步驟 1 相同;sessions 應為 0
```

> 時序注意:步驟 4 到步驟 5 之間,線上仍是舊版程式,其 session 查詢(`sessions.email`)會失敗 → 已登入者會被登出/看到錯誤;`/:slug` 轉址不受影響。請讓 4 → 5 間隔越短越好,兩步驟接連執行,並持續維持 write freeze。

## 5. 部署

```bash
npm run deploy
# = npm run build && npx wrangler pages deploy dist --project-name=link-short
```

記下輸出的 deployment URL/ID(rollback 會用到)。

## 6. 煙霧測試

命令列(不需登入):

```bash
# 首頁
curl -sI https://link.pg72.tw/ | head -3                          # HTTP/2 200

# 未登入 session 查詢
curl -s https://link.pg72.tw/api/auth/me                           # {"user":null}

# OIDC 登入起點:302 到 sso.pg72.tw,帶 pg72-link + PKCE S256,並設 __Host-link_oidc cookie
curl -sI "https://link.pg72.tw/api/auth/login" | grep -iE '^(HTTP|location|set-cookie)'
#   location 應含 https://sso.pg72.tw/...client_id=pg72-link...code_challenge_method=S256...scope=openid%20email
#   set-cookie 應含 __Host-link_oidc=...; Secure; HttpOnly

# 既有短網址仍可轉址(換成一個真實 slug)
curl -sI https://link.pg72.tw/<既有slug> | grep -iE '^(HTTP|location|cache-control)'   # 302 + no-store

# 不存在的 slug
curl -sI https://link.pg72.tw/definitely-not-a-slug | head -1     # 404

# Origin 檢查 fail closed
curl -s -X POST https://link.pg72.tw/api/auth/logout -H "Origin: https://evil.example.com"   # 403 Invalid request origin
```

瀏覽器(**Owner 親手做**,用既有管理員帳號):

1. 開 `https://link.pg72.tw` → 點 PGID 登入 → 完成 SSO(Google 或 Passkey)→ 應回到 `/admin`。
2. 確認 `/api/auth/me` 顯示正確 email 且 `is_admin: true`(即舊帳號成功以 verified email 綁定 `sub`)。
3. 確認舊有連結清單完整;建立一條測試短網址、驗證轉址、再刪除。
4. 登出 → `/api/auth/me` 回 `{"user":null}`。
5. (可選)用一個非管理員的既有使用者登入,確認其舊連結仍在名下。

以上 smoke 與 D1 收尾確認全部通過後才解除 write freeze。任一項失敗時保持 freeze 並進入步驟 8,避免 rollback bookmark 之後產生新寫入。

D1 收尾確認:

```bash
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT COUNT(*) AS bound FROM users WHERE sso_subject IS NOT NULL;"          # 登入過的人數
npx wrangler d1 execute link-short-db --remote --command \
  "SELECT id, completed_at FROM auth_bootstrap;"                                 # 管理員綁定後應有一列
```

## 7. 已知相容性影響(對使用者的公告素材)

- 所有人都會被登出,需用 PGID 重新登入一次。
- 舊帳號以「PGID verified email 與 Link 既有 email 相同」做**一次性**綁定;綁定後改以 `sub` 識別,之後改 email 不影響帳號。
- 若某使用者的 PGID email 與其 Link 舊 email **不同**,登入會建立**新帳號**,舊連結仍掛在舊 email 名下 → 需管理員事後處理(目前無自助轉移)。cutover 前建議 owner 核對主要使用者的 email 是否一致。
- 若 PGID email 已被另一個已綁定的帳號占用 → 回 `/?error=identity_conflict`,fail closed。
- PGID 帳號的 email 必須是 verified,否則登入被拒(`OIDC_VERIFIED_EMAIL_REQUIRED`)。

## 8. Rollback

原則:**程式與 D1 必須一起回退**,只回退其一會互不相容(舊程式讀 `sessions.email`,新程式讀 `sessions.sso_subject`)。Rollback 全程保持 write freeze。

1. Pages 回退:Cloudflare dashboard → Pages → `link-short` → Deployments → 選 cutover 前那次 deployment → Rollback。
   (或本機 checkout 前一個 production commit 重新 `npm run deploy`。)
2. D1 回退(擇一):
   - Time Travel(優先):
     ```bash
     npx wrangler d1 time-travel restore link-short-db --bookmark=<步驟4b記下的bookmark>
     ```
   - 或以步驟 4a 的最終 SQL 匯出重建。
   - Time Travel/SQL restore 都會捨棄 rollback anchor 之後的資料。restore 前再次確認 freeze 生效且 anchor 後沒有 Link mutation;若已有寫入,先停下並由 owner 決定資料保全方案,不可默認接受遺失。
3. 在 PGID admin UI 將 `pg72-link` client 設為 disabled(**Owner**),避免半套狀態下還能發 code。
4. 確認回退 deployment 仍帶有舊 Google client vars/secrets 與原 D1 binding,再重跑步驟 6 的命令列煙霧測試。舊版行為恢復後才解除 freeze(注意:回退後 D1 內是備份當下的 session,使用者同樣需重新登入)。

## 附錄:migration 清單

| 檔案 | production 是否需要 | 內容 | 破壞性 |
| --- | --- | --- | --- |
| `schema.sql` | 否(僅全新安裝) | 完整最新 schema | 對既有庫等同重建,禁止 |
| `migration-002.sql` | 否(應已套用,步驟 1 驗證) | `users` 表 + `links.owner_email/active/disabled_reason` | 否 |
| `migration-003-pg72-oidc.sql` | **是** | `users.sso_subject` + `auth_bootstrap` + 重建 `sessions` | **是:清除所有 session** |
| `migration-004-email-identity.sql` | **是** | `unique(lower(email))`,避免 legacy binding 歧義 | 否;有重複資料時 fail closed |
