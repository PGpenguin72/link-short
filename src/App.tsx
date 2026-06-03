import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { authApi } from './api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  const refresh = () =>
    authApi.me().then(({ user }) => setUser(user)).catch(() => setUser(null))

  useEffect(() => {
    refresh()
  }, [])

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm">載入中…</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            user ? <Navigate to={user.is_admin ? '/admin' : '/dashboard'} replace /> : <LoginPage />
          }
        />
        <Route
          path="/dashboard"
          element={user ? <DashboardPage user={user} onLogout={() => setUser(null)} /> : <Navigate to="/" replace />}
        />
        <Route
          path="/admin"
          element={
            user?.is_admin ? (
              <AdminPage user={user} onLogout={() => setUser(null)} />
            ) : user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        {/* Any other path = a slug that the worker did not redirect → invalid/disabled link */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
