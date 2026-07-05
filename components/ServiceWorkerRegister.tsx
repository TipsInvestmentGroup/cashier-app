'use client'
import { useEffect } from 'react'

/**
 * Registers public/sw.js unconditionally on app load — previously this only
 * happened when a user opted into push notifications (lib/push-client.ts's
 * subscribeToPush), so anyone who never clicked "Wezesha" got no offline
 * app-shell caching either. Registration is idempotent (the browser dedupes
 * by scriptURL/scope), so this is safe to run alongside that existing call.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])
  return null
}
