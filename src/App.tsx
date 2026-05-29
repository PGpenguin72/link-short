import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { authApi } from './api'
import type { User } from './types'
import LoginPage from './pages/LoginPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    authApi.me().then(({ user }) => setUser(user)).catch(() => setUser(null))
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
          element={user ? <Navigate to="/admin" replace /> : <LoginPage />}
        />
        <Route
          path="/admin"
          element={
            user ? (
              <AdminPage user={user} onLogout={() => setUser(null)} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
