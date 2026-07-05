// Browser-side helper for the MyPos "ready to collect" push notifications.
// See lib/push.ts (server send) and public/sw.js (service worker).

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i)
  return output
}

export type PushSupport = 'unsupported' | 'ios-needs-install' | 'ready'

/** Whether this browser/device can even attempt push, and whether iOS needs
 *  the Home Screen install step first (regular Safari tabs can't subscribe). */
export function checkPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  // Safari exposes navigator.standalone; other iOS browsers (e.g. Chrome for
  // iOS) share WebKit's same install-to-subscribe restriction.
  const isStandalone = ('standalone' in navigator && (navigator as unknown as { standalone?: boolean }).standalone) ||
    window.matchMedia('(display-mode: standalone)').matches
  if (isIos && !isStandalone) return 'ios-needs-install'
  return 'ready'
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return null
  return reg.pushManager.getSubscription()
}

export async function subscribeToPush(token: string): Promise<'subscribed' | 'denied' | 'error'> {
  try {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return 'error'

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return 'denied'

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
    })

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(sub.toJSON()),
    })
    return 'subscribed'
  } catch {
    return 'error'
  }
}
