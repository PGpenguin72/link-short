import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { authApi, linksApi } from '../api'
import type { Link, User } from '../types'
import QRModal from '../components/QRModal'

interface Props {
  user: User
  onLogout: () => void
}

export default function DashboardPage({ user, onLogout }: Props) {
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState('')

  const [newSlug, setNewSlug] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editSlug, setEditSlug] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [qrLink, setQrLink] = useState<Link | null>(null)

  useEffect(() => {
    linksApi.list()
      .then(({ links }) => setLinks(links))
      .catch((e: Error) => setGlobalError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await authApi.logout()
    onLogout()
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    setCreating(true)
    try {
      const { link } = await linksApi.create({ slug: newSlug.trim() || undefined, target_url: newUrl.trim() })
      setLinks((p) => [link, ...p])
      setNewSlug('')
      setNewUrl('')
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (l: Link) => {
    setEditingId(l.id)
    setEditSlug(l.slug)
    setEditUrl(l.target_url)
    setEditError('')
  }

  const handleSave = async (id: number) => {
    setEditError('')
    setSaving(true)
    try {
      const { link } = await linksApi.update(id, { slug: editSlug.trim(), target_url: editUrl.trim() })
      setLinks((p) => p.map((l) => (l.id === id ? link : l)))
      setEditingId(null)
    } catch (e) {
      setEditError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: number, slug: string) => {
    if (!confirm(`確定要刪除「${slug}」嗎？`)) return
    try {
      await linksApi.delete(id)
      setLinks((p) => p.filter((l) => l.id !== id))
    } catch (e) {
      setGlobalError((e as Error).message)
    }
  }

  const copyShort = (l: Link) => {
    navigator.clipboard.writeText(`${location.origin}/${l.slug}`).then(() => {
      setCopiedId(l.id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const shortUrl = (slug: string) => `${location.origin}/${slug}`

  return (
    <div className="app-bg min-h-screen bg-bg-base text-fg">
      <header className="border-b border-white/[0.06] px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shrink-0"
              style={{ boxShadow: '0 0 0 1px rgba(94,106,210,0.5), 0 4px 14px rgba(94,106,210,0.35)' }}
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <span className="font-semibold text-sm">我的短網址</span>
          </div>
          <div className="flex items-center gap-3">
            {user.is_admin && (
              <RouterLink to="/admin" className="text-xs text-accent hover:text-accent-bright transition-colors">管理後台</RouterLink>
            )}
            <span className="text-fg-muted text-xs hidden sm:block">{user.email}</span>
            <button onClick={handleLogout} className="btn btn-secondary text-xs px-3 py-1.5">登出</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {globalError && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{globalError}</div>
        )}

        <div className="card p-5">
          <h2 className="label-mono mb-4">新增短網址</h2>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
            <input type="text" placeholder="自訂短代碼（選填）" value={newSlug} onChange={(e) => setNewSlug(e.target.value)}
              pattern="[a-zA-Z0-9_\-]*" className="input flex-none sm:w-44 px-3 py-2 text-sm" />
            <input type="url" placeholder="目標網址 https://…" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} required
              className="input flex-1 px-3 py-2 text-sm" />
            <button type="submit" disabled={creating} className="btn btn-primary shrink-0 px-5 py-2 text-sm">{creating ? '建立中…' : '建立'}</button>
          </form>
          {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="label-mono">所有短網址</h2>
            <span className="text-xs text-fg-muted">{links.length} 個</span>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-fg-muted text-sm">載入中…</div>
          ) : links.length === 0 ? (
            <div className="px-5 py-10 text-center text-fg-muted text-sm">尚未建立任何短網址</div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {links.map((link) =>
                editingId === link.id ? (
                  <div key={link.id} className="px-5 py-4 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input type="text" value={editSlug} onChange={(e) => setEditSlug(e.target.value)} pattern="[a-zA-Z0-9_\-]+" required
                        className="input flex-none sm:w-44 px-3 py-2 text-sm" />
                      <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} required
                        className="input flex-1 px-3 py-2 text-sm" />
                    </div>
                    {editError && <p className="text-xs text-red-400">{editError}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => handleSave(link.id)} disabled={saving} className="btn btn-primary text-xs px-3 py-1.5">{saving ? '儲存中…' : '儲存'}</button>
                      <button onClick={() => setEditingId(null)} className="btn btn-secondary text-xs px-3 py-1.5">取消</button>
                    </div>
                  </div>
                ) : (
                  <div key={link.id} className="px-5 py-4 flex items-center gap-4 group hover:bg-white/[0.02] transition-colors">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <a href={shortUrl(link.slug)} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-bright font-mono text-sm font-medium transition-colors">/{link.slug}</a>
                        {link.active === 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">已停用</span>
                        )}
                        <button onClick={() => copyShort(link)} className="opacity-0 group-hover:opacity-100 transition-opacity" title="複製短網址">
                          {copiedId === link.id ? (
                            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                          )}
                        </button>
                      </div>
                      <p className="text-fg-muted text-xs truncate">{link.target_url}</p>
                      {link.active === 0 && link.disabled_reason && (
                        <p className="text-red-400/70 text-xs">停用原因：{link.disabled_reason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setQrLink(link)} className="p-1.5 text-fg-muted hover:text-fg hover:bg-white/[0.06] rounded-lg transition-colors" title="QR Code / 分享">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                      </button>
                      <button onClick={() => startEdit(link)} className="p-1.5 text-fg-muted hover:text-fg hover:bg-white/[0.06] rounded-lg transition-colors" title="編輯">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button onClick={() => handleDelete(link.id, link.slug)} className="p-1.5 text-fg-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="刪除">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </main>

      {qrLink && <QRModal url={shortUrl(qrLink.slug)} slug={qrLink.slug} onClose={() => setQrLink(null)} />}
    </div>
  )
}
