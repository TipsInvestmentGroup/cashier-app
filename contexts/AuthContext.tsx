'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'

interface User {
  id: string
  name: string
  email: string
  role: string
  position?: string | null
  outlet?: { id: string; name: string } | null
  /** True for the system owner. Supplied by the server (never derived from an address in the
   *  client bundle). Absent on sessions stored before this existed until /api/auth/me refreshes it. */
  isOwner?: boolean
  /** The owner's email, returned only to authenticated users (used by a few admin screens). */
  ownerEmail?: string
}

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  loginWithToken: (token: string, user: User) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('cashier_token')
    const storedUser = localStorage.getItem('cashier_user')
    if (stored && storedUser) {
      setToken(stored)
      try { setUser(JSON.parse(storedUser)) } catch { localStorage.removeItem('cashier_user') }

      // Re-validate the stored session against the server. A revoked/deactivated account is
      // signed out right away rather than showing a stale UI that then fails every request;
      // a network failure (e.g. an offline MyPOS terminal) leaves the cached session alone.
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${stored}` } })
        .then(async (res) => {
          if (res.status === 401) {
            setToken(null); setUser(null)
            localStorage.removeItem('cashier_token'); localStorage.removeItem('cashier_user')
            return
          }
          if (!res.ok) return
          const data = await res.json().catch(() => null)
          if (data?.user) {
            setUser(data.user)
            localStorage.setItem('cashier_user', JSON.stringify(data.user))
          }
        })
        .catch(() => { /* offline / transient: keep the cached session */ })
    }
    setIsLoading(false)
  }, [])

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Login failed')
    }
    const data = await res.json()
    setToken(data.token)
    setUser(data.user)
    localStorage.setItem('cashier_token', data.token)
    localStorage.setItem('cashier_user', JSON.stringify(data.user))
  }

  /** Used by the MyPOS PIN-login flow — the token/user already came back
   *  from /api/auth/pin-login, so this just persists the session without
   *  another network round-trip. */
  const loginWithToken = (newToken: string, newUser: User) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('cashier_token', newToken)
    localStorage.setItem('cashier_user', JSON.stringify(newUser))
  }

  const logout = () => {
    // MyPos devices are shared per-counter — clean up this device's push
    // subscription so it doesn't keep notifying whoever's logging out on
    // behalf of whoever logs in next. Fire-and-forget: must not block/delay
    // the actual logout even if this fails.
    if (token) import('@/lib/push-client').then(({ unsubscribeFromPush }) => unsubscribeFromPush(token)).catch(() => {})
    setToken(null)
    setUser(null)
    localStorage.removeItem('cashier_token')
    localStorage.removeItem('cashier_user')
  }

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithToken, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
