'use client'
import React, { createContext, useContext, useState, useEffect } from 'react'

interface User {
  id: string
  name: string
  email: string
  role: string
  outlet?: { id: string; name: string } | null
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
      setUser(JSON.parse(storedUser))
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
