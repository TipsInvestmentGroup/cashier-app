'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'

interface TableOrder {
  id: string
  orderNo: string
  status: string
  totalAmount: number
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

function TableFloor() {
  const { user, token } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const shiftId = searchParams.get('shiftId') ?? ''
  const outletId = searchParams.get('outletId') ?? ''

  const [tables, setTables] = useState<PosTable[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const loadTables = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const url = outletId ? `/api/pos/tables?outletId=${outletId}` : '/api/pos/tables'
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setTables(await res.json())
    setLoading(false)
  }, [token, outletId])

  useEffect(() => { loadTables() }, [loadTables])

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const t = setInterval(loadTables, 30_000)
    return () => clearInterval(t)
  }, [loadTables])

  const openTable = async (table: PosTable) => {
    if (!token || !shiftId) return
    setBusy(table.id)

    if (table.orders.length > 0) {
      // Table already has an open order — go directly to it
      router.push(`/pos/order/${table.orders[0].id}`)
      return
    }

    // Create a new order for this table
    const res = await fetch('/api/pos/orders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId: table.id, shiftId }),
    })
    if (res.ok) {
      const order = await res.json()
      router.push(`/pos/order/${order.id}`)
    }
    setBusy(null)
  }

  const getTableStatus = (table: PosTable) => {
    if (table.orders.length === 0) return 'free'
    const order = table.orders[0]
    if (order.waiterId === user?.id) return 'mine'
    return 'other'
  }

  const TABLE_COLORS: Record<string, string> = {
    free:  'bg-green-50 border-green-300 text-green-800 hover:bg-green-100',
    mine:  'bg-indigo-600 border-indigo-700 text-white hover:bg-indigo-700',
    other: 'bg-rose-50 border-rose-300 text-rose-800',
  }

  const TABLE_ICONS: Record<string, string> = {
    free: '🟢', mine: '🔵', other: '🔴',
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-indigo-900">Floor Map</h1>
            <p className="text-sm text-gray-500">Gusa meza kuchagua</p>
          </div>
          <button onClick={loadTables} className="text-sm text-indigo-600 hover:underline">
            Refresh ↻
          </button>
        </div>

        {/* Legend */}
        <div className="flex gap-4 mb-4 text-xs text-gray-600">
          <span>🟢 Huru</span>
          <span>🔵 Yangu</span>
          <span>🔴 Staff mwingine</span>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : tables.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-4">Hakuna meza zilizosanidiwa.</p>
            <p className="text-sm text-gray-400">Wasiliana na Admin ili kusanidi meza.</p>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
            {tables.map(table => {
              const status = getTableStatus(table)
              const order = table.orders[0]
              const isBusy = busy === table.id
              return (
                <button
                  key={table.id}
                  onClick={() => openTable(table)}
                  disabled={status === 'other' || isBusy}
                  className={`border-2 rounded-2xl p-3 text-center transition-all active:scale-95 disabled:cursor-not-allowed ${TABLE_COLORS[status]}`}
                >
                  <div className="text-lg mb-1">{TABLE_ICONS[status]}</div>
                  <div className="font-bold text-lg">{table.number}</div>
                  {table.label && <div className="text-xs opacity-70 truncate">{table.label}</div>}
                  {order && (
                    <div className="text-xs mt-1 font-medium">
                      {(order.totalAmount / 1000).toFixed(0)}k
                    </div>
                  )}
                  {isBusy && <div className="text-xs mt-1">...</div>}
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            onClick={() => router.push('/pos')}
            className="text-sm text-gray-500 hover:text-indigo-600"
          >
            ← Badilisha Shift
          </button>
        </div>

        {tables.length === 0 && !loading && (
          <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-center">
            Hakuna meza. Wasiliana na Admin kupiga <strong>POST /api/pos/setup</strong> kwanza.
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function TablesPage() {
  return (
    <Suspense>
      <TableFloor />
    </Suspense>
  )
}
