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
    if (s === 'ready') getExistingSubscription().then((sub) => setSubscribed(!!sub))
  }, [])

  if (!support || support === 'unsupported' || subscribed || dismissed) return null

  const enable = async () => {
    if (!token) return
    setBusy(true)
    const result = await subscribeToPush(token)
    setBusy(false)
    if (result === 'subscribed') { setSubscribed(true); toast.success('Arifa zimewezeshwa!') }
    else if (result === 'denied') toast.error('Umekataa arifa. Unaweza kuwezesha tena kwenye mipangilio ya kivinjari.')
    else toast.error('Imeshindikana kuwezesha arifa — jaribu tena.')
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
