'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'

const COUNTERS = [
  { code: 'BAR',     label: 'Bar Counter',     icon: '🍺' },
  { code: 'SHISHA',  label: 'Shisha Counter',  icon: '💨' },
  { code: 'KITCHEN', label: 'Kitchen Counter', icon: '🍽' },
  { code: 'MAIN',    label: 'Main Counter',    icon: '🍹' },
]

interface OrderItem {
  id: string
  productName: string
  quantity: number
  extras: string | null
  sentAt: string | null
  order: {
    orderNo: string
    table: { number: number; label: string | null } | null
    waiter: { name: string }
  }
}

function CounterView() {
  const { token } = useAuth()
  const searchParams = useSearchParams()
  const [activeCounter, setActiveCounter] = useState(searchParams.get('code') ?? 'BAR')
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const res = await fetch(`/api/pos/counter?code=${activeCounter}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setItems(await res.json())
    setLoading(false)
  }, [token, activeCounter])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [load])

  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return ''
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    if (diff < 1) return 'Sasa hivi'
    return `Min ${diff} iliyopita`
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-indigo-900">Counter View</h1>
          <button onClick={load} className="text-sm text-indigo-600 hover:underline">↻ Refresh</button>
        </div>

        {/* Counter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {COUNTERS.map(c => (
            <button
              key={c.code}
              onClick={() => setActiveCounter(c.code)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeCounter === c.code ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-500 font-medium">Hakuna maagizo mapya</p>
            <p className="text-gray-400 text-sm mt-1">Inaboresha kila sekunde 15...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map(item => (
              <div key={item.id} className="bg-white rounded-2xl shadow-sm border-l-4 border-amber-400 p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-bold text-gray-800 text-lg">{item.order.orderNo}</span>
                    {item.order.table && (
                      <span className="ml-2 bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-bold">
                        Meza {item.order.table.number}
                        {item.order.table.label ? ` — ${item.order.table.label}` : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{timeAgo(item.sentAt)}</span>
                </div>
                <div className="font-semibold text-gray-900 text-base">
                  {item.quantity} × {item.productName}
                </div>
                {item.extras && (
                  <div className="text-sm text-amber-700 mt-1 font-medium">
                    + {JSON.parse(item.extras).join(', ')}
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-2">
                  Waiter: {item.order.waiter.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default function CounterPage() {
  return (
    <Suspense>
      <CounterView />
    </Suspense>
  )
}
