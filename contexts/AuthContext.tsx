'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'

interface User {
  id: string
  name: string
  email: string
  role: string
  position?: string | null
  outlet?: { id: string; name: string } | null
  /** The company this session is signed in to. */
  company?: { id: string; name: string; slug: string | null } | null
  /** True for the owner OF THIS COMPANY. Supplied by the server (never derived from an address in the
   *  client bundle). Absent on sessions stored before this existed until /api/auth/me refreshes it. */
  isOwner?: boolean
  /** The owner's email, returned only to authenticated users (used by a few admin screens). */
  ownerEmail?: string
}

export interface CompanyChoice { id: string; name: string; slug: string | null; active?: boolean }

/** Result of the first sign-in step: either signed in, or the person belongs to several companies and must pick one. */
export type LoginResult =
  | { needsCompany: false }
  | { needsCompany: true; selectToken: string; companies: CompanyChoice[] }

interface AuthContextType {
  user: User | null
  token: string | null
  /** Companies this login can switch into (the switcher only shows when there is more than one). */
  companies: CompanyChoice[]
  login: (email: string, password: string, company?: string) => Promise<LoginResult>
  selectCompany: (selectToken: string, company: string) => Promise<void>
  switchCompany: (company: string) => Promise<void>
  loginWithToken: (token: string, user: User) => void
  logout: () => void
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Per-device data that belongs to ONE company's session: reference data cached for offline POS and the
 *  analytics scope. Cleared on logout and on every company switch so nothing carries across. (The unsent
 *  offline ORDER queue is deliberately NOT cleared here - those are real, unsynced sales - which is why a
 *  company switch is refused while any are pending.) */
function clearCompanyScopedLocalState() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('mypos_cache_') || k === 'tips.analyticsScope') localStorage.removeItem(k)
    }
  } catch { /* storage unavailable */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [companies, setCompanies] = useState<CompanyChoice[]>([])
  const [isLoading, setIsLoading] = useState(true)

  /** Re-read the caller's identity + company list from the server (also the revocation check). */
  const refreshMe = (tok: string) =>
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          // Revoked / deactivated / company suspended: sign out right away instead of showing a stale UI.
          setToken(null); setUser(null); setCompanies([])
          localStorage.removeItem('cashier_token'); localStorage.removeItem('cashier_user')
          return
        }
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (data?.user) {
          setUser(data.user)
          localStorage.setItem('cashier_user', JSON.stringify(data.user))
        }
        if (Array.isArray(data?.companies)) setCompanies(data.companies)
      })
      .catch(() => { /* offline / transient: keep the cached session */ })

  useEffect(() => {
    const stored = localStorage.getItem('cashier_token')
    const storedUser = localStorage.getItem('cashier_user')
    if (stored && storedUser) {
      setToken(stored)
      try { setUser(JSON.parse(storedUser)) } catch { localStorage.removeItem('cashier_user') }
      // A network failure (e.g. an offline MyPOS terminal) leaves the cached session alone.
      void refreshMe(stored)
    }
    setIsLoading(false)
  }, [])

  const adoptSession = (newToken: string, newUser: User) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('cashier_token', newToken)
    localStorage.setItem('cashier_user', JSON.stringify(newUser))
    void refreshMe(newToken)
  }

  const post = async (url: string, body: unknown, bearer?: string | null) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  const login = async (email: string, password: string, company?: string): Promise<LoginResult> => {
    const data = await post('/api/auth/login', { email, password, ...(company ? { company } : {}) })
    if (data.needsCompany) {
      return { needsCompany: true, selectToken: data.selectToken, companies: data.companies || [] }
    }
    adoptSession(data.token, data.user)
    return { needsCompany: false }
  }

  const selectCompany = async (selectToken: string, company: string) => {
    const data = await post('/api/auth/select-company', { selectToken, company })
    adoptSession(data.token, data.user)
  }

  const switchCompany = async (company: string) => {
    // Unsent offline orders belong to the CURRENT company; sending them under another company's session
    // would be wrong, and dropping them would lose sales. Make the person sync (or discard) first.
    try {
      const { getPendingCount } = await import('@/lib/offline-queue')
      if ((await getPendingCount()) > 0) throw new Error('You have unsent offline orders. Let them sync (or discard them) before switching company.')
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('You have unsent')) throw err
      /* the offline store is unavailable: nothing to protect */
    }
    const data = await post('/api/auth/switch-company', { company }, token)
    clearCompanyScopedLocalState()
    adoptSession(data.token, data.user)
    // Full reload: every page re-reads its data under the new company; nothing stale survives in memory.
    window.location.assign('/dashboard')
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
    setCompanies([])
    localStorage.removeItem('cashier_token')
    localStorage.removeItem('cashier_user')
    clearCompanyScopedLocalState()
  }

  return (
    <AuthContext.Provider value={{ user, token, companies, login, selectCompany, switchCompany, loginWithToken, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
