import { useAuth } from '@/contexts/AuthContext'
import { useCallback, useEffect, useRef } from 'react'

export function useApi() {
  const { token, logout } = useAuth()
  // Held in a ref so `request` keeps a stable identity (it is a dependency of countless page
  // effects; AuthContext's logout is re-created every render).
  const logoutRef = useRef(logout)
  useEffect(() => { logoutRef.current = logout })

  const request = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // The account was deactivated / its sessions were revoked (see proxy.ts): sign out cleanly
        // instead of leaving the user on a page that fails every request.
        if ((res.status === 401 && data.code === 'SESSION_REVOKED') || (res.status === 403 && data.code === 'COMPANY_SUSPENDED')) logoutRef.current()
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      return res.json()
    },
    [token]
  )

  return { request }
}
