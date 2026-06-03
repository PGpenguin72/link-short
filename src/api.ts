import type { Link, AdminLink, User, AdminUser } from './types'

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export const authApi = {
  me: () => fetch('/api/auth/me').then((r) => handle<{ user: User | null }>(r)),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }).then((r) => handle<{ ok: boolean }>(r)),
}

export const linksApi = {
  list: () => fetch('/api/links').then((r) => handle<{ links: Link[] }>(r)),
  create: (data: { slug?: string; target_url: string }) =>
    fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handle<{ link: Link }>(r)),
  update: (id: number, data: { slug?: string; target_url?: string }) =>
    fetch(`/api/links/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handle<{ link: Link }>(r)),
  delete: (id: number) =>
    fetch(`/api/links/${id}`, { method: 'DELETE' }).then((r) => handle<{ ok: boolean }>(r)),
}

export const adminApi = {
  links: () => fetch('/api/admin/links').then((r) => handle<{ links: AdminLink[] }>(r)),
  users: () => fetch('/api/admin/users').then((r) => handle<{ users: AdminUser[] }>(r)),
  banUser: (email: string, banned: boolean) =>
    fetch(`/api/admin/users/${encodeURIComponent(email)}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned }),
    }).then((r) => handle<{ ok: boolean }>(r)),
  disableLink: (id: number, active: boolean, reason?: string) =>
    fetch(`/api/admin/links/${id}/disable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active, reason }),
    }).then((r) => handle<{ link: AdminLink }>(r)),
  editLink: (id: number, data: { slug?: string; target_url?: string }) =>
    fetch(`/api/admin/links/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handle<{ link: AdminLink }>(r)),
}
