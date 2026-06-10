import { useAuth } from '@/contexts/AuthContext'
import { useCallback } from 'react'

export function useApi() {
  const { token } = useAuth()

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
        throw new Error(data.error || `Request failed: ${res.status}`)
      }
      return res.json()
    },
    [token]
  )

  return { request }
}
