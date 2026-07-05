'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { getPendingCount, onQueueEvent, startAutoFlush, resumeFlush } from '@/lib/offline-queue'

// Mirrors AppShell's own MyPOS-vs-office login routing so a re-login prompt
// sends staff back to whichever login screen matches where they were.
const MYPOS_PREFIXES = ['/pos', '/mypos', '/schedule', '/events']

/**
 * App-wide indicator for the offline order-queue (see lib/offline-queue.ts):
 * a small badge showing how many actions are still waiting to sync, visible
 * from any screen — not just the one where something was queued — plus a
 * full-screen re-login prompt if a flush attempt comes back 401 (the queue
 * itself is untouched by logging out and back in).
 */
export function OfflineQueueBadge() {
  const { token, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [pendingCount, setPendingCount] = useState(0)
  const [authExpired, setAuthExpired] = useState(false)

  const getToken = useCallback(() => token, [token])

  useEffect(() => {
    if (!token) return
    startAutoFlush(getToken)
    resumeFlush(getToken)
    setAuthExpired(false)
  }, [token, getToken])

  useEffect(() => {
    getPendingCount().then(setPendingCount).catch(() => {})
    return onQueueEvent((event) => {
      if (event.type === 'queue-changed') setPendingCount(event.pendingCount)
      if (event.type === 'auth-expired') setAuthExpired(true)
    })
  }, [])

  const reLogin = () => {
    logout()
    const isMyPos = MYPOS_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
    router.push(isMyPos ? '/mypos/staff-login' : '/login')
  }

  if (authExpired) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm text-center">
          <div className="text-4xl mb-3">🔒</div>
          <h3 className="font-bold text-gray-800 text-lg mb-2">Muda wa kuingia umeisha</h3>
          <p className="text-sm text-gray-500 mb-4">Ingia tena ili kuendelea — kazi zako zilizosalia kutumwa hazitapotea, zitatumwa baada ya kuingia.</p>
          <button onClick={reLogin} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700">Ingia tena</button>
        </div>
      </div>
    )
  }

  if (pendingCount === 0) return null

  return (
    <span className="flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full whitespace-nowrap">
      🔄 {pendingCount} zinasubiri kutumwa
    </span>
  )
}
