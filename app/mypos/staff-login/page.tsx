'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string; isEventsOnly: boolean }
interface Staff { id: string; name: string; position: string | null; outlet: { id: string; name: string } | null }

const PIN_LENGTH = 4
const POSITION_COLORS: Record<string, string> = {
  'OUTSIDE STAFF': 'bg-indigo-100 text-indigo-700',
  'BAR LADY': 'bg-rose-100 text-rose-700',
  'VIP BAR': 'bg-amber-100 text-amber-700',
  'SHISHA COUNTER': 'bg-emerald-100 text-emerald-700',
  'KITCHEN COUNTER': 'bg-orange-100 text-orange-700',
}

// Distinct per-outlet theme so staff instantly recognise their branch by
// colour alone — events outlets get a festive purple/pink regardless of name,
// everyone else cycles through a fixed palette keyed by name for consistency.
const OUTLET_PALETTE = [
  { grad: 'from-blue-600 to-indigo-600', ring: 'ring-blue-300', soft: 'bg-blue-50 text-blue-700', icon: '🏝️' },
  { grad: 'from-teal-500 to-cyan-600', ring: 'ring-teal-300', soft: 'bg-teal-50 text-teal-700', icon: '🌊' },
  { grad: 'from-fuchsia-600 to-orange-500', ring: 'ring-fuchsia-300', soft: 'bg-fuchsia-50 text-fuchsia-700', icon: '🎉' },
  { grad: 'from-emerald-600 to-lime-600', ring: 'ring-emerald-300', soft: 'bg-emerald-50 text-emerald-700', icon: '🌿' },
]
function outletTheme(outlet: Outlet, idx: number) {
  if (outlet.isEventsOnly) return OUTLET_PALETTE[2]
  return OUTLET_PALETTE[idx % OUTLET_PALETTE.length]
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

type Step = 'outlet' | 'staff' | 'pin'

export default function StaffLoginPage() {
  const router = useRouter()
  const { loginWithToken } = useAuth()

  const [step, setStep] = useState<Step>('outlet')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loadingOutlets, setLoadingOutlets] = useState(true)
  const [outlet, setOutlet] = useState<Outlet | null>(null)

  const [staff, setStaff] = useState<Staff[]>([])
  const [loadingStaff, setLoadingStaff] = useState(false)
  const [search, setSearch] = useState('')

  const [selected, setSelected] = useState<Staff | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/pin-login/outlets')
      .then((r) => (r.ok ? r.json() : []))
      .then(setOutlets)
      .finally(() => setLoadingOutlets(false))
  }, [])

  const pickOutlet = useCallback((o: Outlet) => {
    setOutlet(o)
    setStep('staff')
    setSearch('')
    setLoadingStaff(true)
    fetch(`/api/auth/pin-login/staff?outletId=${o.id}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setStaff)
      .finally(() => setLoadingStaff(false))
  }, [])

  const backToOutlets = useCallback(() => { setStep('outlet'); setOutlet(null); setStaff([]); setSearch('') }, [])

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? staff.filter((s) => s.name.toLowerCase().includes(q)) : staff
  }, [staff, search])

  const pickStaff = useCallback((s: Staff) => { setSelected(s); setPin(''); setError(''); setStep('pin') }, [])
  const backToStaff = useCallback(() => { setStep('staff'); setSelected(null); setPin(''); setError('') }, [])

  const submit = useCallback(async (fullPin: string) => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/pin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selected.id, pin: fullPin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Incorrect PIN')
        setPin('')
        setBusy(false)
        return
      }
      loginWithToken(data.token, data.user)
      toast.success(`Karibu, ${selected.name}!`)
      router.push('/mypos')
    } catch {
      setError('Network error — try again')
      setPin('')
      setBusy(false)
    }
  }, [selected, loginWithToken, router])

  const tapDigit = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return
    const next = pin + d
    setError('')
    setPin(next)
    if (next.length === PIN_LENGTH) submit(next)
  }
  const backspace = () => { if (!busy) { setPin((p) => p.slice(0, -1)); setError('') } }

  const outletIdx = outlet ? outlets.findIndex((o) => o.id === outlet.id) : -1
  const theme = outlet ? outletTheme(outlet, outletIdx) : OUTLET_PALETTE[0]

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col bg-gradient-to-br ${theme.grad} transition-colors duration-300 select-none`}>
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-4 text-white text-center relative">
        {step !== 'outlet' && (
          <button
            onClick={step === 'pin' ? backToStaff : backToOutlets}
            className="absolute left-3 top-[max(1rem,env(safe-area-inset-top))] px-3 py-2 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 transition text-sm font-semibold"
          >
            ← Back
          </button>
        )}
        <div className="text-4xl sm:text-5xl mb-1">🍹</div>
        <h1 className="text-xl sm:text-2xl font-bold">Tips MyPos</h1>
        <p className="text-white/80 text-xs sm:text-sm mt-0.5">
          {step === 'outlet' && 'Tap your outlet to begin'}
          {step === 'staff' && `${outlet?.name} · Tap your name`}
          {step === 'pin' && `Enter PIN for ${selected?.name}`}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 bg-white rounded-t-[2rem] sm:rounded-t-[2.5rem] shadow-2xl flex flex-col overflow-hidden">
        {step === 'outlet' && (
          <div className="flex-1 flex items-center justify-center p-4 sm:p-8">
            {loadingOutlets ? (
              <div className="text-gray-400 text-lg">Loading outlets...</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 w-full max-w-4xl">
                {outlets.map((o, i) => {
                  const t = outletTheme(o, i)
                  return (
                    <button
                      key={o.id}
                      onClick={() => pickOutlet(o)}
                      className={`group flex flex-col items-center justify-center gap-3 p-6 sm:p-10 rounded-3xl bg-gradient-to-br ${t.grad} text-white shadow-lg active:scale-95 transition focus:outline-none focus-visible:ring-4 ${t.ring}`}
                    >
                      <span className="text-5xl sm:text-6xl">{t.icon}</span>
                      <span className="text-lg sm:text-2xl font-bold text-center leading-tight">{o.name}</span>
                      {o.isEventsOnly && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/20">Event staffing</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {step === 'staff' && (
          <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6">
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your name..."
              className="w-full shrink-0 px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-base sm:text-lg transition mb-4"
            />

            {loadingStaff ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">Loading staff...</div>
            ) : filteredStaff.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">No staff found</div>
            ) : (
              <div
                className="flex-1 min-h-0 grid gap-2 sm:gap-3 overflow-y-auto content-start"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gridAutoRows: 'min-content' }}
              >
                {filteredStaff.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pickStaff(s)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 active:scale-95 transition text-center bg-gradient-to-br ${theme.soft}`}
                  >
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white text-gray-700 font-bold flex items-center justify-center text-sm shadow-sm">
                      {initials(s.name)}
                    </div>
                    <span className="font-semibold text-gray-800 text-[13px] leading-tight line-clamp-2">{s.name}</span>
                    {s.position && (
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${POSITION_COLORS[s.position] || 'bg-gray-100 text-gray-600'}`}>
                        {s.position}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'pin' && selected && (
          <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
            <div className="w-full max-w-xs text-center">
              <div className="w-16 h-16 rounded-full bg-indigo-100 text-indigo-700 font-bold text-xl flex items-center justify-center mx-auto mb-3">
                {initials(selected.name)}
              </div>
              <p className="font-semibold text-gray-800 mb-1">{selected.name}</p>
              {selected.position && (
                <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-4 ${POSITION_COLORS[selected.position] || 'bg-gray-100 text-gray-600'}`}>
                  {selected.position}
                </span>
              )}

              <div className="flex items-center justify-center gap-3 my-5">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 transition ${i < pin.length ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'} ${error ? 'border-rose-500' : ''}`}
                  />
                ))}
              </div>

              <div className="h-6 mb-2">
                {error && <p className="text-rose-600 text-sm font-medium">{error}</p>}
                {busy && !error && <p className="text-indigo-600 text-sm font-medium">Checking...</p>}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    onClick={() => tapDigit(d)}
                    disabled={busy}
                    className="py-4 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-95 transition text-xl font-bold text-gray-800 disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
                <button onClick={backToStaff} className="py-4 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition">
                  ← Back
                </button>
                <button
                  onClick={() => tapDigit('0')}
                  disabled={busy}
                  className="py-4 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-95 transition text-xl font-bold text-gray-800 disabled:opacity-50"
                >
                  0
                </button>
                <button onClick={backspace} disabled={busy} className="py-4 rounded-2xl text-lg font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition disabled:opacity-50">
                  ⌫
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-gray-100 p-3 text-center">
          <Link href="/login" className="text-sm font-semibold text-gray-400 hover:text-indigo-600">
            Manager / office login →
          </Link>
        </div>
      </div>
    </div>
  )
}
