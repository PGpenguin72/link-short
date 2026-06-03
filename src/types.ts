export interface Link {
  id: number
  slug: string
  target_url: string
  owner_email: string
  active: number
  disabled_reason: string | null
  created_at: string
  updated_at: string
}

export interface AdminLink extends Link {
  owner_banned: number
}

export interface User {
  email: string
  is_admin: boolean
  banned: boolean
}

export interface AdminUser {
  email: string
  banned: number
  is_admin: number
  created_at: string
  link_count: number
}
