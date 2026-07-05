'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Staff { id: string; name: string; position: string | null; outlet: { id: string; name: string } | null }

const PIN_LENGTH = 4
const POSITION_COLORS: Record<string, string> = {
  'OUTSIDE STAFF': 'bg-indigo-100 text-indigo-700',
  'BAR LADY': 'bg-rose-100 text-rose-700',
  'VIP BAR': 'bg-amber-100 text-amber-700',
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase()
}

export default function StaffLoginPage() {
  const router = useRouter()
  const { loginWithToken } = useAuth()

  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Staff | null>(null)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/auth/pin-login/staff')
      .then((r) => (r.ok ? r.json() : []))
      .then(setStaff)
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q ? staff.filter((s) => s.name.toLowerCase().includes(q)) : staff
    const byOutlet = new Map<string, Staff[]>()
    for (const s of filtered) {
      const key = s.outlet?.name || 'Unassigned'
      if (!byOutlet.has(key)) byOutlet.set(key, [])
      byOutlet.get(key)!.push(s)
    }
    return [...byOutlet.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [staff, search])

  const closePin = useCallback(() => { setSelected(null); setPin(''); setError('') }, [])

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
      <div className="w-full max-w-4xl">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <div className="text-5xl mb-3">🍹</div>
            <h1 className="text-2xl font-bold">Tips MyPos</h1>
            <p className="text-indigo-200 text-sm mt-1">{selected ? `Enter PIN for ${selected.name}` : 'Tap your name to sign in'}</p>
          </div>

          <div className="p-6 sm:p-8">
            {selected ? (
              /* ---- PIN PAD ---- */
              <div className="max-w-xs mx-auto text-center">
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

                {error && <p className="text-rose-600 text-sm font-medium mb-3">{error}</p>}
                {busy && <p className="text-indigo-600 text-sm font-medium mb-3">Checking...</p>}

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
                  <button onClick={closePin} className="py-4 rounded-2xl text-sm font-semibold text-gray-500 hover:bg-gray-100 active:scale-95 transition">
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
            ) : (
              /* ---- STAFF GRID ---- */
              <div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your name..."
                  className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:outline-none text-lg transition mb-6"
                />

                {loading ? (
                  <div className="text-center text-gray-400 py-16">Loading staff...</div>
                ) : grouped.length === 0 ? (
                  <div className="text-center text-gray-400 py-16">No staff found</div>
                ) : (
                  <div className="space-y-6 max-h-[55vh] overflow-y-auto pr-1">
                    {grouped.map(([outletName, people]) => (
                      <div key={outletName}>
                        <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{outletName}</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                          {people.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => { setSelected(s); setPin(''); setError('') }}
                              className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-gray-100 hover:border-indigo-300 hover:bg-indigo-50 active:scale-95 transition text-center"
                            >
                              <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center">
                                {initials(s.name)}
                              </div>
                              <span className="font-semibold text-gray-800 text-sm leading-tight">{s.name}</span>
                              {s.position && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${POSITION_COLORS[s.position] || 'bg-gray-100 text-gray-600'}`}>
                                  {s.position}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-gray-100 p-4 text-center">
            <Link href="/login" className="text-sm font-semibold text-gray-400 hover:text-indigo-600">
              Manager / office login →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
