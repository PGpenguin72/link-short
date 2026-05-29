import type { Link, User } from './types'

async function handleResponse<T>(res: Response): Promise<T> {
  const data = await res.json()
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

export const authApi = {
  me: () =>
    fetch('/api/auth/me').then((r) =>
      handleResponse<{ user: User | null }>(r)
    ),
  logout: () =>
    fetch('/api/auth/logout', { method: 'POST' }).then((r) =>
      handleResponse<{ ok: boolean }>(r)
    ),
}

export const linksApi = {
  list: () =>
    fetch('/api/links').then((r) => handleResponse<{ links: Link[] }>(r)),

  create: (data: { slug?: string; target_url: string }) =>
    fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<{ link: Link }>(r)),

  update: (id: number, data: { slug?: string; target_url?: string }) =>
    fetch(`/api/links/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then((r) => handleResponse<{ link: Link }>(r)),

  delete: (id: number) =>
    fetch(`/api/links/${id}`, { method: 'DELETE' }).then((r) =>
      handleResponse<{ ok: boolean }>(r)
    ),
}
