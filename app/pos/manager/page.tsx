'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-700',
  SENT: 'bg-amber-100 text-amber-700',
}

interface OrderItem {
  id: string
  productName: string
  quantity: number
  amount: number
  status: string
  counterCode: string | null
}

interface Order {
  id: string
  orderNo: string
  status: string
  totalAmount: number
  table: { number: number; label: string | null } | null
  waiter: { name: string }
  items: OrderItem[]
}

export default function ManagerPage() {
  const { token } = useAuth()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const res = await fetch('/api/pos/orders', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setOrders(await res.json())
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0)

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-indigo-900">All Active Orders</h1>
            <p className="text-sm text-gray-500">Live manager view · refreshes kila sec 30</p>
          </div>
          <button onClick={load} className="text-sm text-indigo-600 hover:underline">↻ Refresh</button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-indigo-600 text-white rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold">{orders.length}</div>
            <div className="text-indigo-200 text-xs mt-1">Meza Wazi</div>
          </div>
          <div className="bg-amber-500 text-white rounded-2xl p-4 text-center">
            <div className="text-2xl font-bold">{orders.filter(o => o.status === 'SENT').length}</div>
            <div className="text-amber-100 text-xs mt-1">Zimetumwa</div>
          </div>
          <div className="bg-green-600 text-white rounded-2xl p-4 text-center">
            <div className="text-sm font-bold">{(totalRevenue / 1000).toFixed(0)}k</div>
            <div className="text-green-100 text-xs mt-1">Jumla (TSh)</div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-500">Hakuna maagizo wazi sasa hivi.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div
                key={order.id}
                onClick={() => router.push(`/pos/order/${order.id}`)}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="font-bold text-gray-800">{order.orderNo}</span>
                    {order.table && (
                      <span className="ml-2 text-sm text-indigo-600 font-medium">
                        Meza {order.table.number}{order.table.label ? ` — ${order.table.label}` : ''}
                      </span>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {order.status}
                  </span>
                </div>

                <div className="text-xs text-gray-500 mb-2">Waiter: {order.waiter.name}</div>

                <div className="space-y-1">
                  {order.items.slice(0, 4).map(item => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-gray-700">{item.quantity} × {item.productName}</span>
                      <span className="text-gray-500">{(item.amount / 1000).toFixed(0)}k</span>
                    </div>
                  ))}
                  {order.items.length > 4 && (
                    <div className="text-xs text-gray-400">+{order.items.length - 4} zaidi...</div>
                  )}
                </div>

                <div className="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                  <span className="text-sm text-gray-500">{order.items.length} bidhaa</span>
                  <span className="font-bold text-indigo-900">TSh {order.totalAmount.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
