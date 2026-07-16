import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { authApi, adminApi } from '../api'
import type { AdminLink, AdminUser, User } from '../types'
import QRModal from '../components/QRModal'

interface Props {
  user: User
  onLogout: () => void
}

type Tab = 'links' | 'users'

export default function AdminPage({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('links')
  const [links, setLinks] = useState<AdminLink[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [qrSlug, setQrSlug] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([adminApi.links(), adminApi.users()])
      .then(([l, u]) => {
        setLinks(l.links)
        setUsers(u.users)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleLogout = async () => {
    await authApi.logout()
    onLogout()
  }

  const toggleLink = async (l: AdminLink) => {
    const disabling = l.active === 1
    let reason: string | undefined
    if (disabling) {
      const r = prompt('停用原因（會顯示在 404 頁面提示用，可留空）：', '違反使用條款')
      if (r === null) return
      reason = r || '違反使用條款'
    }
    try {
      const { link } = await adminApi.disableLink(l.id, !disabling, reason)
      setLinks((p) => p.map((x) => (x.id === l.id ? { ...x, ...link } : x)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const editLink = async (l: AdminLink) => {
    const target = prompt('修改目標網址（讓連結指向別處或使其失效）：', l.target_url)
    if (target === null) return
    try {
      const { link } = await adminApi.editLink(l.id, { target_url: target.trim() })
      setLinks((p) => p.map((x) => (x.id === l.id ? { ...x, ...link } : x)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const toggleBan = async (u: AdminUser) => {
    const banning = u.banned === 0
    if (banning && !confirm(`確定要停權「${u.email}」嗎？\n該帳號所有連結將失效，且無法再登入。`)) return
    try {
      await adminApi.banUser(u.email, banning)
      setUsers((p) => p.map((x) => (x.email === u.email ? { ...x, banned: banning ? 1 : 0 } : x)))
      // Reflect owner_banned on links
      setLinks((p) => p.map((x) => (x.owner_email === u.email ? { ...x, owner_banned: banning ? 1 : 0 } : x)))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const shortUrl = (slug: string) => `${location.origin}/${slug}`

  return (
    <div className="app-bg min-h-screen bg-bg-base text-fg">
      <header className="border-b border-white/[0.06] px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0"
              style={{ boxShadow: '0 0 0 1px rgba(94,106,210,0.5), 0 4px 14px rgba(94,106,210,0.35)' }}
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-semibold text-sm">管理後台</span>
          </div>
          <div className="flex items-center gap-3">
            <RouterLink to="/dashboard" className="text-xs text-accent hover:text-accent-bright transition-colors">我的短網址</RouterLink>
            <span className="text-fg-muted text-xs hidden sm:block">{user.email}</span>
            <button onClick={handleLogout} className="btn btn-secondary text-xs px-3 py-1.5">登出</button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>}

        <div className="flex gap-2">
          <TabButton active={tab === 'links'} onClick={() => setTab('links')}>所有連結 ({links.length})</TabButton>
          <TabButton active={tab === 'users'} onClick={() => setTab('users')}>所有帳號 ({users.length})</TabButton>
        </div>

        {loading ? (
          <div className="py-10 text-center text-fg-muted text-sm">載入中…</div>
        ) : tab === 'links' ? (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left label-mono border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-normal">短代碼</th>
                  <th className="px-4 py-3 font-normal">目標網址</th>
                  <th className="px-4 py-3 font-normal">建立者</th>
                  <th className="px-4 py-3 font-normal">狀態</th>
                  <th className="px-4 py-3 font-normal text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {links.map((l) => {
                  const effectiveActive = l.active === 1 && l.owner_banned === 0
                  return (
                    <tr key={l.id} className="hover:bg-white/[0.03] transition-colors">
                      <td className="px-4 py-3">
                        <a href={shortUrl(l.slug)} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-bright font-mono transition-colors">/{l.slug}</a>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]"><span className="text-fg-muted truncate block">{l.target_url}</span></td>
                      <td className="px-4 py-3"><span className="text-fg-muted text-xs">{l.owner_email}</span></td>
                      <td className="px-4 py-3">
                        {effectiveActive ? (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">有效</span>
                        ) : l.owner_banned ? (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-orange-500/15 text-orange-400 border border-orange-500/20">擁有者停權</span>
                        ) : (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">已停用</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setQrSlug(l.slug)} className="p-1.5 text-fg-muted hover:text-fg hover:bg-white/[0.06] rounded-lg transition-colors" title="QR Code">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                          </button>
                          <button onClick={() => editLink(l)} className="p-1.5 text-fg-muted hover:text-fg hover:bg-white/[0.06] rounded-lg transition-colors" title="改連結">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                          </button>
                          <button onClick={() => toggleLink(l)} className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${l.active === 1 ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'}`}>
                            {l.active === 1 ? '停用' : '啟用'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {links.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-fg-muted">尚無連結</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left label-mono border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-normal">帳號</th>
                  <th className="px-4 py-3 font-normal">連結數</th>
                  <th className="px-4 py-3 font-normal">註冊時間</th>
                  <th className="px-4 py-3 font-normal">狀態</th>
                  <th className="px-4 py-3 font-normal text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {users.map((u) => (
                  <tr key={u.email} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-fg">{u.email}</span>
                      {u.is_admin === 1 && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">管理員</span>}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{u.link_count}</td>
                    <td className="px-4 py-3 text-fg-muted text-xs">{u.created_at}</td>
                    <td className="px-4 py-3">
                      {u.banned === 1 ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">已停權</span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/20">正常</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.is_admin === 1 ? (
                        <span className="text-xs text-fg-subtle">—</span>
                      ) : (
                        <button onClick={() => toggleBan(u)} className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${u.banned === 0 ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'}`}>
                          {u.banned === 0 ? '停權' : '解除停權'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-fg-muted">尚無帳號</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {qrSlug && <QRModal url={shortUrl(qrSlug)} slug={qrSlug} onClose={() => setQrSlug(null)} />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-white/[0.08] text-fg border border-white/[0.08]' : 'text-fg-muted hover:text-fg hover:bg-white/[0.04] border border-transparent'}`}
    >
      {children}
    </button>
  )
}
