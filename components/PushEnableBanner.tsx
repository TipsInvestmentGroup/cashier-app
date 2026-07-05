'use client'
import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { checkPushSupport, getExistingSubscription, subscribeToPush, type PushSupport } from '@/lib/push-client'
import toast from 'react-hot-toast'

/**
 * Prompts a MyPos user to enable push notifications for "order ready to
 * collect" alerts — the in-page beep is unreliable once a phone's tab isn't
 * the active one, so this is the reliable channel. Shows nothing once
 * already subscribed, and on iOS walks through the required Home Screen
 * install step (Safari can't subscribe to push from a normal browser tab).
 */
export function PushEnableBanner() {
  const { token } = useAuth()
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const s = checkPushSupport()
    setSupport(s)
    if (s !== 'ready' || !token) return
    getExistingSubscription().then((sub) => {
      setSubscribed(!!sub)
      // Self-heal: a browser can already hold a subscription the server
      // never actually saved (a bug in an earlier version silently dropped
      // failed saves). Re-POSTing an existing subscription is a harmless
      // no-op if it was already saved, and repairs it silently if it wasn't
      // — no need for every affected person to notice and re-click Wezesha.
      if (sub) subscribeToPush(token).catch(() => {})
    })
  }, [token])

  if (!support || support === 'unsupported' || dismissed) return null

  const enable = async () => {
    if (!token) return
    setBusy(true)
    const result = await subscribeToPush(token)
    setBusy(false)
    if (result === 'subscribed') { setSubscribed(true); toast.success('Arifa zimewezeshwa!') }
    else if (result === 'denied') toast.error('Umekataa arifa. Unaweza kuwezesha tena kwenye mipangilio ya kivinjari.')
    else toast.error('Imeshindikana kuwezesha arifa — jaribu tena.')
  }

  const resync = async () => {
    if (!token) return
    setBusy(true)
    const result = await subscribeToPush(token)
    setBusy(false)
    if (result === 'subscribed') toast.success('✓ Usajili umesasishwa kwenye seva.')
    else toast.error('Imeshindikana kusasisha — jaribu tena, au bofya Tuma jaribio kuangalia hitilafu.')
  }

  const sendTest = async () => {
    if (!token) return
    setBusy(true)
    let res: Response
    try {
      res = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    } catch (err) {
      // The request never reached the server at all (offline, DNS, timeout).
      toast.error(`Mtandao: ${err instanceof Error ? err.message : 'haijulikani'}`)
      setBusy(false)
      return
    }
    try {
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || `Server error (${res.status})`); return }
      if (data.sent > 0) toast.success(`✓ Jaribio limetumwa (${data.sent}/${data.attempted}) — subiri arifa kwenye simu yako.`)
      else toast.error(`Halikutumwa: ${data.failed?.[0]?.error || 'Haijulikani sababu'}`)
    } catch {
      // The server responded, but not with JSON — likely an unhandled server
      // error page. Surface the raw status so it's still actionable.
      toast.error(`Server error (${res.status}) — jibu si JSON`)
    } finally {
      setBusy(false)
    }
  }

  if (subscribed) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-3 flex-wrap">
        <span className="text-lg">✓</span>
        <p className="flex-1 text-sm text-green-800 font-medium min-w-[140px]">Arifa za simu zimewezeshwa.</p>
        <button
          onClick={sendTest}
          disabled={busy}
          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 transition disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? '...' : '🔔 Tuma jaribio'}
        </button>
        <button
          onClick={resync}
          disabled={busy}
          className="px-3 py-1.5 border border-green-300 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-100 transition disabled:opacity-50 whitespace-nowrap"
        >
          {busy ? '...' : '🔄 Sasisha usajili'}
        </button>
        <button onClick={() => setDismissed(true)} className="text-green-300 hover:text-green-700 text-lg leading-none">✕</button>
      </div>
    )
  }

  if (support === 'ios-needs-install') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-sm text-amber-800 flex items-start gap-2">
        <span className="text-lg">📲</span>
        <div className="flex-1">
          <p className="font-semibold">Weka programu kwenye Home Screen kwa arifa za kutegemewa</p>
          <p className="text-xs mt-0.5">Bofya <strong>Share</strong> (⬆️) chini ya Safari, kisha <strong>&quot;Add to Home Screen&quot;</strong>. Fungua programu kutoka kwenye icon hiyo, kisha uwezeshe arifa.</p>
        </div>
        <button onClick={() => setDismissed(true)} className="text-amber-400 hover:text-amber-700 text-lg leading-none">✕</button>
      </div>
    )
  }

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 mb-4 flex items-center gap-3">
      <span className="text-lg">🔔</span>
      <p className="flex-1 text-sm text-indigo-800 font-medium">Wezesha arifa za simu ili upate taarifa hata ukiwa kwenye tab nyingine.</p>
      <button
        onClick={enable}
        disabled={busy}
        className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? '...' : 'Wezesha'}
      </button>
      <button onClick={() => setDismissed(true)} className="text-indigo-300 hover:text-indigo-700 text-lg leading-none">✕</button>
    </div>
  )
}
