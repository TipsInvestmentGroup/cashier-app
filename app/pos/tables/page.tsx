'use client'
import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PosLeanShell, type FabAction } from '@/components/Layout/PosLeanShell'
import { useAuth } from '@/contexts/AuthContext'
import { useUnlockedAudio } from '@/lib/audio-unlock'
import { apiFetch, NetworkError, createLocalOrder } from '@/lib/offline-queue'
import { getWithCache } from '@/lib/offline-cache'
import { RefreshCw, Info, ArrowLeftRight, Bell } from 'lucide-react'

interface TableOrder {
  id: string
  orderNo: string
  status: string
  totalAmount: number
  createdAt: string
  waiterId: string
  waiter: { name: string }
}

interface PosTable {
  id: string
  number: number
  label: string | null
  capacity: number
  orders: TableOrder[]
}

interface Shift { id: string; name: string; closedAt: string | null }

const SHIFT_LABELS: Record<string, string> = { MORNING: 'Asubuhi', EVENING: 'Jioni' }

// The data model only ever puts a table in one of these four buckets — no
// separate Reserved/Cleaning state exists yet, so those aren't shown here.
type Status = 'free' | 'mine' | 'ready' | 'other'

const STATUS_STYLE: Record<Status, { card: string; dot: string; label: string }> = {
  free:  { card: 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100', dot: 'bg-emerald-500', label: 'Available' },
  mine:  { card: 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700', dot: 'bg-white', label: 'Occupied' },
  ready: { card: 'bg-amber-500 border-amber-600 text-white hover:bg-amber-600 animate-pulse', dot: 'bg-white', label: 'Ready' },
  other: { card: 'bg-rose-50 border-rose-300 text-rose-800', dot: 'bg-rose-500', label: 'Occupied (other)' },
}

function elapsed(createdAt: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(createdAt).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

function TableFloor() {
  const { user, token } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlShiftId = searchParams.get('shiftId') ?? ''
  const outletId = searchParams.get('outletId') ?? user?.outlet?.id ?? ''
  const eventId = searchParams.get('eventId') ?? ''

  const [tables, setTables] = useState<PosTable[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const [shiftName, setShiftName] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [shiftId, setShiftId] = useState(urlShiftId)

  const readySeenRef = useRef<Set<string>>(new Set())
  const firstLoadRef = useRef(true)
  const audioRef = useUnlockedAudio()
  const myIdRef = useRef<string | undefined>(user?.id)
  useEffect(() => { myIdRef.current = user?.id }, [user])

  // Tick the elapsed-time labels every 30s without a full data refetch.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const beep = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioRef.current ??= new Ctx()
      const ctx = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      for (const at of [0, 0.45]) {
        const o = ctx.createOscillator(); const g = ctx.createGain()
        o.connect(g); g.connect(ctx.destination)
        o.type = 'sine'; o.frequency.value = 1175
        g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + at + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.3)
        o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3)
      }
    } catch { /* audio blocked — ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadTables = useCallback(async () => {
    if (!token) return
    const url = outletId ? `/api/pos/tables?outletId=${outletId}` : '/api/pos/tables'
    try {
      const { data } = await getWithCache<PosTable[]>(`tables_${outletId}`, async () => {
        const res = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Failed to load tables')
        return res.json()
      })
      const myReady = data.flatMap(t => t.orders).filter(o => o.status === 'READY' && o.waiterId === myIdRef.current)
      const fresh = myReady.filter(o => !readySeenRef.current.has(o.id))
      if (!firstLoadRef.current && fresh.length > 0) beep()
      myReady.forEach(o => readySeenRef.current.add(o.id))
      firstLoadRef.current = false
      setTables(data)
    } catch { /* real rejection or no cache yet — leave current state as-is */ }
    setLoading(false)
  }, [token, outletId, beep])

  useEffect(() => { loadTables() }, [loadTables])

  // Resolve the open shift (id + name) if the URL didn't carry one.
  useEffect(() => {
    if (!token || !outletId) return
    getWithCache<Shift[]>(`shifts_${outletId}`, async () => {
      const res = await apiFetch(`/api/pos/shifts?outletId=${outletId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('Failed to load shifts')
      return res.json()
    })
      .then(({ data }) => {
        const open = data.find(s => !s.closedAt)
        if (open) {
          if (!urlShiftId) setShiftId(open.id)
          setShiftName(open.name)
        }
      })
      .catch(() => {})
  }, [urlShiftId, token, outletId])

  // Auto-refresh every 10 seconds (also drives the ready-to-collect beep)
  useEffect(() => {
    const t = setInterval(loadTables, 10_000)
    return () => clearInterval(t)
  }, [loadTables])

  const openTable = async (table: PosTable) => {
    if (!token) return

    if (table.orders.length > 0) {
      setOpening(table.id)
      router.push(`/pos/order/${table.orders[0].id}`)
      return
    }

    if (!shiftId) {
      alert('Hakuna shift iliyo wazi. Fungua shift kwanza.')
      router.push('/pos')
      return
    }

    setBusy(table.id)
    setOpening(table.id)
    try {
      const res = await apiFetch('/api/pos/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId: table.id, shiftId, outletId, eventId: eventId || undefined }),
      })
      if (res.ok) {
        const order = await res.json()
        router.push(`/pos/order/${order.id}`)
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'Imeshindikana kufungua meza — jaribu tena.')
        setOpening(null)
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        const localOrderId = await createLocalOrder({
          tableId: table.id, shiftId, outletId, eventId: eventId || undefined, tableNumber: table.number, tableLabel: table.label,
        })
        router.push(`/pos/order/${localOrderId}`)
      } else {
        alert('Tatizo la mtandao — jaribu tena.')
        setOpening(null)
      }
    }
    setBusy(null)
  }

  const getStatus = (table: PosTable): Status => {
    if (table.orders.length === 0) return 'free'
    const order = table.orders[0]
    if (order.waiterId === user?.id) return order.status === 'READY' ? 'ready' : 'mine'
    return 'other'
  }

  const counts = useMemo(() => {
    const c = { free: 0, mine: 0, ready: 0, other: 0 }
    tables.forEach(t => { c[getStatus(t)]++ }) // eslint-disable-line react-hooks/exhaustive-deps
    return c
  }, [tables, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fabActions: FabAction[] = [
    { label: 'Refresh', icon: <RefreshCw className="w-4 h-4" />, onClick: loadTables },
    { label: 'Legend', icon: <Info className="w-4 h-4" />, onClick: () => setShowLegend(s => !s) },
    { label: 'Badilisha Shift', icon: <ArrowLeftRight className="w-4 h-4" />, onClick: () => router.push('/pos') },
  ]

  return (
    <PosLeanShell
      title="Floor Map"
      subtitle={`${user?.outlet?.name ?? ''}${shiftName ? ` · Shift ${SHIFT_LABELS[shiftName] ?? shiftName}` : ''}`}
      actions={fabActions}
    >
      <div className="h-full flex flex-col p-3 sm:p-4">
        {/* Compact status strip — tap to expand into the full legend */}
        <button onClick={() => setShowLegend(s => !s)} className="shrink-0 flex items-center gap-3 sm:gap-4 mb-3 text-xs font-medium text-gray-600 bg-white rounded-xl border border-gray-100 px-3 py-2 w-fit">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />{counts.free} Free</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-600" />{counts.mine} Mine</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />{counts.ready} Ready</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" />{counts.other} Other</span>
          <Info className="w-3.5 h-3.5 text-gray-400" />
        </button>

        {showLegend && (
          <div className="shrink-0 mb-3 text-xs text-gray-500 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2">
            🟢 Available — no order yet · 🔵 Occupied (yours) · 🟠 Ready to collect · 🔴 Occupied by another waiter
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">Inapakia...</div>
        ) : tables.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center">
            <div>
              <p className="text-gray-500 mb-2">Hakuna meza zilizosanidiwa.</p>
              <p className="text-sm text-gray-400">Wasiliana na Admin ili kusanidi meza.</p>
            </div>
          </div>
        ) : (
          <div
            className="flex-1 min-h-0 grid gap-2.5 sm:gap-3 overflow-y-auto content-start"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gridAutoRows: 'min-content' }}
          >
            {tables.map(table => {
              const status = getStatus(table)
              const style = STATUS_STYLE[status]
              const order = table.orders[0]
              const isBusy = busy === table.id
              const isOpening = opening === table.id
              return (
                <button
                  key={table.id}
                  onClick={() => openTable(table)}
                  disabled={status === 'other' || isBusy}
                  className={`relative border-2 rounded-2xl p-3 sm:p-4 aspect-square flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:cursor-not-allowed shadow-sm ${style.card} ${isOpening ? 'ring-4 ring-indigo-300 scale-95' : ''}`}
                >
                  {status === 'ready' && (
                    <span className="absolute top-2 right-2">
                      <Bell className="w-3.5 h-3.5" />
                    </span>
                  )}
                  <div className="font-bold text-2xl sm:text-3xl leading-none">{table.number}</div>
                  {table.label && <div className="text-[10px] opacity-80 truncate max-w-full">{table.label}</div>}
                  {order ? (
                    <>
                      <div className="text-xs font-semibold mt-0.5">TSh {(order.totalAmount / 1000).toFixed(0)}k</div>
                      <div className="text-[10px] opacity-75">{elapsed(order.createdAt, now)}</div>
                    </>
                  ) : (
                    <div className="text-[10px] opacity-70 mt-0.5">{style.label}</div>
                  )}
                  {isOpening && <div className="absolute inset-0 rounded-2xl bg-white/30 flex items-center justify-center text-xs font-bold">Opening…</div>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </PosLeanShell>
  )
}

export default function TablesPage() {
  return (
    <Suspense>
      <TableFloor />
    </Suspense>
  )
}
