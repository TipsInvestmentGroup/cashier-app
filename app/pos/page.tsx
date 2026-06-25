'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'

const SHIFTS = [
  { name: 'MORNING', label: 'Shift ya Asubuhi', time: '09:00 – 16:00', color: 'bg-amber-500'  },
  { name: 'EVENING', label: 'Shift ya Jioni',   time: '16:00 – 05:00', color: 'bg-indigo-600' },
]
const shiftLabel = (name: string) => SHIFTS.find((s) => s.name === name)?.label ?? name

interface Shift { id: string; name: string; openedAt: string; closedAt: string | null }
interface Outlet { id: string; name: string }

export default function PosHomePage() {
  const { user, token } = useAuth()
  const router = useRouter()

  const [shifts, setShifts] = useState<Shift[]>([])
  const [activeShift, setActiveShift] = useState<Shift | null>(null)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [selectedOutletId, setSelectedOutletId] = useState(user?.outlet?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Fetch outlets list if user has no outletId
  useEffect(() => {
    if (user?.outlet?.id) { setSelectedOutletId(user.outlet.id); return }
    if (!token) return
    fetch('/api/outlets', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: Outlet[]) => setOutlets(data))
  }, [user, token])

  const loadShifts = useCallback(async () => {
    if (!token || !selectedOutletId) return
    const res = await fetch(`/api/pos/shifts?outletId=${selectedOutletId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data: Shift[] = await res.json()
      setShifts(data)
      setActiveShift(data.find(s => !s.closedAt) ?? null)
    }
  }, [token, selectedOutletId])

  useEffect(() => { loadShifts() }, [loadShifts])

  const openShift = async (name: string) => {
    if (!token) return
    if (!selectedOutletId) { setError('Chagua outlet kwanza kabla ya kufungua shift.'); return }
    setError('')
    setBusy(true)
    const res = await fetch('/api/pos/shifts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, outletId: selectedOutletId }),
    })
    if (res.ok) {
      const shift: Shift = await res.json()
      setActiveShift(shift)
      router.push(`/pos/tables?shiftId=${shift.id}&outletId=${selectedOutletId}`)
    } else {
      const data = await res.json()
      setError(data.error ?? 'Hitilafu — jaribu tena.')
    }
    setBusy(false)
  }

  const goToTables = () => {
    if (activeShift) router.push(`/pos/tables?shiftId=${activeShift.id}&outletId=${selectedOutletId}`)
  }

  const needsOutletPicker = !user?.outlet?.id && outlets.length > 0

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🍹</div>
          <h1 className="text-2xl font-bold text-indigo-900">Tips MyPos</h1>
          <p className="text-gray-500 text-sm mt-1">Karibu, {user?.name}</p>
        </div>

        {/* Outlet picker — only shown when user has no fixed outlet */}
        {needsOutletPicker && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-5">
            <label className="block text-sm font-semibold text-gray-700 mb-2">Chagua Outlet yako</label>
            <select
              value={selectedOutletId}
              onChange={e => { setSelectedOutletId(e.target.value); setShifts([]); setActiveShift(null) }}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
            >
              <option value="">-- Chagua Outlet --</option>
              {outlets.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-4 text-rose-700 text-sm text-center">
            ⚠️ {error}
          </div>
        )}

        {activeShift ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-6 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="font-bold text-green-800 text-lg">{shiftLabel(activeShift.name)} — Iko Wazi</p>
            <p className="text-green-600 text-sm">
              Imefunguliwa: {new Date(activeShift.openedAt).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button
              onClick={goToTables}
              className="mt-4 w-full bg-indigo-600 text-white py-3 rounded-xl font-bold text-lg hover:bg-indigo-700 active:scale-95 transition-all"
            >
              Ingia kwenye Meza →
            </button>
          </div>
        ) : (
          <div className="mb-6">
            <h2 className="text-gray-700 font-semibold mb-3 text-center">Chagua Shift Yako</h2>
            <div className="grid grid-cols-2 gap-3">
              {SHIFTS.map(s => (
                <button
                  key={s.name}
                  onClick={() => openShift(s.name)}
                  disabled={busy || (!selectedOutletId)}
                  className={`${s.color} text-white rounded-2xl p-5 text-left hover:opacity-90 active:scale-95 transition-all disabled:opacity-40`}
                >
                  <div className="font-bold text-lg">{s.label}</div>
                  <div className="text-white/80 text-xs mt-1">{s.time}</div>
                  {busy && <div className="text-white/70 text-xs mt-1">Inafungua...</div>}
                </button>
              ))}
            </div>
            {!selectedOutletId && (
              <p className="text-center text-amber-600 text-sm mt-3">⚠️ Chagua outlet kwanza</p>
            )}
          </div>
        )}

        {shifts.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-500 mb-3">Shifts za Leo</h3>
            <div className="space-y-2">
              {shifts.map(s => (
                <div key={s.id} className="flex justify-between items-center text-sm">
                  <span className="font-medium text-gray-700">{shiftLabel(s.name)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.closedAt ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-700'}`}>
                    {s.closedAt ? 'Imefungwa' : 'Wazi'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
