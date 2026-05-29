import { useEffect, useState, useRef } from 'react'
import { authApi, linksApi } from '../api'
import type { Link, User } from '../types'

interface Props {
  user: User
  onLogout: () => void
}

export default function AdminPage({ user, onLogout }: Props) {
  const [links, setLinks] = useState<Link[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState('')

  // Create form
  const [newSlug, setNewSlug] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit state: id → { slug, target_url }
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editSlug, setEditSlug] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)

  // Copy feedback
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    linksApi
      .list()
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
      const { link } = await linksApi.create({
        slug: newSlug.trim() || undefined,
        target_url: newUrl.trim(),
      })
      setLinks((prev) => [link, ...prev])
      setNewSlug('')
      setNewUrl('')
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const startEdit = (link: Link) => {
    setEditingId(link.id)
    setEditSlug(link.slug)
    setEditUrl(link.target_url)
    setEditError('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditError('')
  }

  const handleSave = async (id: number) => {
    setEditError('')
    setSaving(true)
    try {
      const { link } = await linksApi.update(id, {
        slug: editSlug.trim(),
        target_url: editUrl.trim(),
      })
      setLinks((prev) => prev.map((l) => (l.id === id ? link : l)))
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
      setLinks((prev) => prev.filter((l) => l.id !== id))
    } catch (e) {
      setGlobalError((e as Error).message)
    }
  }

  const copyShortUrl = (link: Link) => {
    const url = `${location.origin}/${link.slug}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedId(null), 2000)
    })
  }

  const shortUrl = (slug: string) => `${location.origin}/${slug}`

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <span className="font-semibold text-sm">短網址管理</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs hidden sm:block">{user.email}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {globalError && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {globalError}
          </div>
        )}

        {/* Create form */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-4">新增短網址</h2>
          <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="自訂短代碼（選填）"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              pattern="[a-zA-Z0-9_\-]*"
              title="只能使用字母、數字、連字符、底線"
              className="flex-none sm:w-44 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="url"
              placeholder="目標網址 https://…"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              required
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={creating}
              className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {creating ? '建立中…' : '建立'}
            </button>
          </form>
          {createError && (
            <p className="mt-2 text-xs text-red-400">{createError}</p>
          )}
        </div>

        {/* Links table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">所有短網址</h2>
            <span className="text-xs text-slate-500">{links.length} 個</span>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-center text-slate-500 text-sm">載入中…</div>
          ) : links.length === 0 ? (
            <div className="px-5 py-10 text-center text-slate-500 text-sm">尚未建立任何短網址</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {links.map((link) =>
                editingId === link.id ? (
                  // Edit row
                  <div key={link.id} className="px-5 py-4 space-y-3">
                    <div className="flex flex-col sm:flex-row gap-3">
                      <input
                        type="text"
                        value={editSlug}
                        onChange={(e) => setEditSlug(e.target.value)}
                        pattern="[a-zA-Z0-9_\-]+"
                        required
                        placeholder="短代碼"
                        className="flex-none sm:w-44 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                      <input
                        type="url"
                        value={editUrl}
                        onChange={(e) => setEditUrl(e.target.value)}
                        required
                        placeholder="目標網址"
                        className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    {editError && (
                      <p className="text-xs text-red-400">{editError}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(link.id)}
                        disabled={saving}
                        className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 rounded-lg font-medium transition-colors"
                      >
                        {saving ? '儲存中…' : '儲存'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="text-xs text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  // Display row
                  <div key={link.id} className="px-5 py-4 flex items-center gap-4 group">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <a
                          href={shortUrl(link.slug)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300 font-mono text-sm font-medium transition-colors"
                        >
                          /{link.slug}
                        </a>
                        <button
                          onClick={() => copyShortUrl(link)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          title="複製短網址"
                        >
                          {copiedId === link.id ? (
                            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </div>
                      <p className="text-slate-400 text-xs truncate">{link.target_url}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(link)}
                        className="p-1.5 text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                        title="編輯"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(link.id, link.slug)}
                        className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="刪除"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
