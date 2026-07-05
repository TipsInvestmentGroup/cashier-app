'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { buildBillHtml, printHtml, BILL_TYPES, BILL_TYPE_LABELS } from '@/lib/pos-receipt'
import { useUnlockedAudio } from '@/lib/audio-unlock'
import { PushEnableBanner } from '@/components/PushEnableBanner'

const ORDER_POLL_MS = 5_000

/** Double high-pitched beep — same "ready to collect" tone used on the Floor Map. */
function playReadyBeep(ctx: AudioContext) {
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
}

// Outlets can have different physical counter setups (e.g. Mikocheni's Main
// Bar + VIP + Shisha + Kitchen), so the counter list is fetched per-outlet
// (see loadCounters below) rather than hardcoded — this icon map is just a
// display nicety, with a sensible fallback for any code it doesn't know.
const COUNTER_ICONS: Record<string, string> = {
  MAIN: '🍹', BAR: '🍺', VIP: '👑', SHISHA: '💨', KITCHEN: '🍽',
}
const counterLabel = (code: string, label?: string) => `${COUNTER_ICONS[code] ?? '🔸'} ${label ?? code}`
const PAY_METHODS = [
  { code: 'CASH', label: '💵 Cash' },
  { code: 'CRDB', label: '🏧 CRDB' },
  { code: 'STANBIC', label: '🏦 Stanbic' },
  { code: 'MPESA', label: '📱 M-Pesa' },
]

interface OrderItem {
  id: string
  productName: string
  unitPrice: number
  quantity: number
  amount: number
  extras: string | null
  counterCode: string | null
  status: string
}

interface Payment { id: string; amount: number; method: string; receivedByName: string; createdAt: string }

interface Order {
  id: string
  orderNo: string
  status: string
  billType: string
  totalAmount: number
  discount: number
  paidAmount: number
  createdAt: string
  outletId: string
  table: { number: number; label: string | null } | null
  waiter: { name: string }
  shift: { name: string }
  outlet?: { name: string; legalName: string | null; tin: string | null; vrn: string | null } | null
  items: OrderItem[]
  payments: Payment[]
}

interface Counter { code: string; label: string; serviceModel: string }

interface Product {
  id: string
  code: string
  name: string
  category: string | null
  sellingPrice: number
}

export default function OrderPage() {
  const { token, user } = useAuth()
  const router = useRouter()
  const { id: orderId } = useParams<{ id: string }>()

  const [order, setOrder] = useState<Order | null>(null)
  const [products, setProducts] = useState<Record<string, Product[]>>({})
  const [extras, setExtras] = useState<string[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [tab, setTab] = useState<'order' | 'menu'>('order')
  const [activeCategory, setActiveCategory] = useState('')
  const [search, setSearch] = useState('')

  // Add-item state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedCounter, setSelectedCounter] = useState('')
  const [selectedExtras, setSelectedExtras] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [discountModal, setDiscountModal] = useState(false)
  const [discountInput, setDiscountInput] = useState('')
  const [justReady, setJustReady] = useState(false)

  const prevStatusRef = useRef<string | null>(null)
  const audioRef = useUnlockedAudio()

  const loadOrder = useCallback(async () => {
    if (!token) return
    const res = await fetch(`/api/pos/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data: Order = await res.json()

    // Beep + flash the moment this order (being watched right here on this
    // screen) flips to READY — the counter just finished preparing it.
    if (prevStatusRef.current && prevStatusRef.current !== 'READY' && data.status === 'READY') {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        audioRef.current ??= new Ctx()
        playReadyBeep(audioRef.current)
      } catch { /* audio blocked — ignore */ }
      setJustReady(true)
      setTimeout(() => setJustReady(false), 6000)
    }
    prevStatusRef.current = data.status
    setOrder(data)
  }, [token, orderId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMenu = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/pos/products', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data = await res.json()
      setProducts(data.grouped)
      const cats = Object.keys(data.grouped)
      if (cats.length > 0) setActiveCategory(cats[0])
    }
  }, [token])

  const loadExtras = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/pos/extras', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data: { name: string }[] = await res.json()
      setExtras(data.map(e => e.name))
    }
  }, [token])

  useEffect(() => {
    loadOrder()
    loadMenu()
    loadExtras()
  }, [loadOrder, loadMenu, loadExtras])

  // Counter list is outlet-specific (Mikocheni's Main Bar/VIP/Shisha/Kitchen
  // differs from other outlets), so it's fetched once the order tells us
  // which outlet it belongs to, rather than hardcoded.
  useEffect(() => {
    if (!token || !order?.outletId) return
    fetch(`/api/pos/counters?outletId=${order.outletId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: Counter[]) => {
        setCounters(data)
        setSelectedCounter(prev => prev || data[0]?.code || '')
      })
  }, [token, order?.outletId])

  // Keep watching this order while it's still active — this is the screen a
  // waiter naturally sits on after sending to the counter, so it needs its
  // own live refresh (the Floor Map's beep only fires if they've navigated
  // away from here).
  useEffect(() => {
    if (order && (order.status === 'CLOSED' || order.status === 'CANCELLED')) return
    const t = setInterval(loadOrder, ORDER_POLL_MS)
    return () => clearInterval(t)
  }, [loadOrder, order?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = async () => {
    if (!selectedProduct || !token) return
    if (!selectedCounter) { alert('Counters bado zinapakia — subiri sekunde chache.'); return }
    setBusy(true)
    const res = await fetch(`/api/pos/orders/${orderId}/items`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: selectedProduct.id,
        quantity: qty,
        extras: selectedExtras,
        counterCode: selectedCounter,
      }),
    })
    if (res.ok) {
      await loadOrder()
      setSelectedProduct(null)
      setSelectedExtras([])
      setQty(1)
      setTab('order')
    }
    setBusy(false)
  }

  const removeItem = async (itemId: string) => {
    if (!token) return
    await fetch(`/api/pos/orders/${orderId}/items?itemId=${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    loadOrder()
  }

  const sendOrder = async () => {
    if (!token) return
    setBusy(true)
    const res = await fetch(`/api/pos/orders/${orderId}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      await loadOrder()
      alert('✅ Imetumwa kwa counter!')
    } else {
      const err = await res.json()
      alert(err.error ?? 'Hitilafu')
    }
    setBusy(false)
  }

  const applyDiscount = async () => {
    if (!token || !order) return
    const val = parseFloat(discountInput)
    if (isNaN(val) || val < 0) return
    setBusy(true)
    await fetch(`/api/pos/orders/${orderId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discount: val }),
    })
    await loadOrder()
    setDiscountModal(false)
    setDiscountInput('')
    setBusy(false)
  }

  // ---- Bill printing & bill type ----
  const printBill = () => { if (order) printHtml(buildBillHtml(order)) }

  const setBillType = async (billType: string) => {
    if (!token || !order) return
    await fetch(`/api/pos/orders/${orderId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ billType }),
    })
    loadOrder()
  }

  // ---- Payments (partial + balance) ----
  const [payModal, setPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')

  const net = order ? order.totalAmount - order.discount : 0
  const balance = order ? net - order.paidAmount : 0

  const recordPayment = async () => {
    if (!token || !order) return
    const amt = parseFloat(payAmount)
    if (isNaN(amt) || amt <= 0) { alert('Weka kiasi sahihi'); return }
    setBusy(true)
    const res = await fetch(`/api/pos/orders/${orderId}/pay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, method: payMethod }),
    })
    const data = await res.json()
    if (res.ok) {
      if (data.settled) {
        alert('✅ Bili imelipwa kamili — meza imefungwa!')
        setPayModal(false)
        await loadOrder()
      } else {
        alert(`Malipo yamepokewa. Baki: TSh ${Number(data.balance).toLocaleString()}`)
        setPayAmount('')
        await loadOrder()
      }
    } else {
      alert(data.error ?? 'Hitilafu')
    }
    setBusy(false)
  }

  const toggleExtra = (name: string) => {
    setSelectedExtras(prev => prev.includes(name) ? prev.filter(e => e !== name) : [...prev, name])
  }

  const filteredProducts = (() => {
    const source = activeCategory && products[activeCategory] ? products[activeCategory] : Object.values(products).flat()
    if (!search.trim()) return source
    const q = search.toLowerCase()
    return source.filter(p => p.name.toLowerCase().includes(q))
  })()

  if (!order) {
    return <AppShell><div className="text-center py-16 text-gray-400">Inapakia...</div></AppShell>
  }

  const pendingCount = order.items.filter(i => i.status === 'PENDING').length
  const isClosed = order.status === 'CLOSED' || order.status === 'CANCELLED'

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">←</button>
          <div className="flex-1">
            <h1 className="font-bold text-indigo-900 text-lg">
              {order.table ? `Meza ${order.table.number}${order.table.label ? ` — ${order.table.label}` : ''}` : 'Order'}
            </h1>
            <p className="text-xs text-gray-500">{order.orderNo} · Shift {order.shift.name} · {order.waiter.name}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${isClosed ? 'bg-gray-100 text-gray-500' : order.status === 'READY' ? 'bg-green-600 text-white' : pendingCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
            {isClosed ? 'Imefungwa' : order.status === 'READY' ? '✓ Tayari kuchukua' : pendingCount > 0 ? `${pendingCount} pending` : 'Imetumwa'}
          </span>
        </div>

        {!isClosed && <PushEnableBanner />}

        {/* Ready-to-collect banner — flashes for a few seconds right after the
            counter finishes preparing, alongside the beep. */}
        {(justReady || order.status === 'READY') && !isClosed && (
          <div className={`mb-4 rounded-xl p-3 text-center text-white font-bold text-sm transition ${justReady ? 'bg-green-600 animate-pulse' : 'bg-green-600'}`}>
            ✅ Bidhaa zako zipo tayari — chukua kwenye counter!
          </div>
        )}

        {/* Tabs */}
        {!isClosed && (
          <div className="flex gap-2 mb-4">
            <button onClick={() => setTab('order')} className={`flex-1 py-2 rounded-xl font-semibold text-sm transition-colors ${tab === 'order' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              🧾 Order ({order.items.length})
            </button>
            <button onClick={() => setTab('menu')} className={`flex-1 py-2 rounded-xl font-semibold text-sm transition-colors ${tab === 'menu' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              ➕ Ongeza Bidhaa
            </button>
          </div>
        )}

        {/* ORDER TAB */}
        {tab === 'order' && (
          <div>
            {order.items.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">🛒</div>
                <p>Hakuna bidhaa bado.</p>
                {!isClosed && <button onClick={() => setTab('menu')} className="mt-3 text-indigo-600 text-sm font-medium">Ongeza bidhaa →</button>}
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {order.items.map(item => (
                  <div key={item.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 flex gap-3 items-start">
                    <div className="flex-1">
                      <div className="font-medium text-gray-800 text-sm">{item.productName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.quantity} × TSh {item.unitPrice.toLocaleString()}
                        {item.counterCode && <span className="ml-2 bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">{counterLabel(item.counterCode, counters.find(c => c.code === item.counterCode)?.label)}</span>}
                      </div>
                      {item.extras && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          + {JSON.parse(item.extras).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-800 text-sm">TSh {item.amount.toLocaleString()}</div>
                      <span className={`text-xs ${item.status === 'PENDING' ? 'text-amber-600' : 'text-green-600'}`}>
                        {item.status === 'PREPARED' ? '✓ Tayari' : item.status === 'SENT' ? '✓ Sent' : '⏳ Pending'}
                      </span>
                    </div>
                    {!isClosed && item.status === 'PENDING' && (
                      <button onClick={() => removeItem(item.id)} className="text-rose-400 hover:text-rose-600 text-lg leading-none ml-1">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Totals */}
            <div className="bg-indigo-50 rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-1">
                <span>Jumla ya bidhaa</span>
                <span>TSh {order.totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-rose-600 mb-1 items-center">
                <span>Punguzo</span>
                <div className="flex items-center gap-2">
                  <span>{order.discount > 0 ? `− TSh ${order.discount.toLocaleString()}` : '—'}</span>
                  {!isClosed && ['MANAGER', 'ADMIN'].includes(user?.role ?? '') && (
                    <button onClick={() => { setDiscountInput(String(order.discount)); setDiscountModal(true) }} className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full hover:bg-rose-200">
                      {order.discount > 0 ? 'Badilisha' : '+ Weka'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between font-bold text-indigo-900 text-base border-t border-indigo-200 pt-2 mt-2">
                <span>KULIPA</span>
                <span>TSh {net.toLocaleString()}</span>
              </div>
              {order.paidAmount > 0 && (
                <>
                  <div className="flex justify-between text-sm text-green-700 mt-1">
                    <span>Imelipwa</span>
                    <span>TSh {order.paidAmount.toLocaleString()}</span>
                  </div>
                  {balance > 0.5 && (
                    <div className="flex justify-between text-sm font-bold text-rose-700">
                      <span>BAKI</span>
                      <span>TSh {balance.toLocaleString()}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Bill type + print */}
            <div className="flex items-center gap-2 mb-4">
              <select
                value={order.billType}
                onChange={e => setBillType(e.target.value)}
                disabled={isClosed}
                className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 disabled:bg-gray-50"
              >
                {BILL_TYPES.map(t => <option key={t} value={t}>{BILL_TYPE_LABELS[t]}</option>)}
              </select>
              <button
                onClick={printBill}
                disabled={order.items.length === 0}
                className="bg-gray-800 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-gray-900 active:scale-95 transition-all disabled:opacity-40"
              >
                🖨 {order.billType === 'CUSTOMER' ? 'Customer Bill' : 'In-House Bill'}
              </button>
            </div>

            {/* Payments history */}
            {order.payments.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-4">
                <p className="text-xs font-semibold text-gray-500 mb-2">Malipo yaliyopokewa</p>
                {order.payments.map(p => (
                  <div key={p.id} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                    <span className="text-gray-600">{p.method} · {p.receivedByName}</span>
                    <span className="font-semibold text-gray-800">TSh {p.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Discount modal */}
            {discountModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDiscountModal(false)}>
                <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <h3 className="font-bold text-gray-800 text-lg mb-1">Weka Punguzo</h3>
                  <p className="text-sm text-gray-500 mb-4">Jumla ya order: TSh {order.totalAmount.toLocaleString()}</p>
                  <input
                    type="number"
                    min="0"
                    max={order.totalAmount}
                    value={discountInput}
                    onChange={e => setDiscountInput(e.target.value)}
                    placeholder="Kiasi cha punguzo (TSh)"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg mb-4 focus:outline-none focus:border-indigo-400"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setDiscountModal(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                    <button onClick={applyDiscount} disabled={busy} className="bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">Weka</button>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            {!isClosed && (
              <div className="space-y-2">
                {pendingCount > 0 && (
                  <button
                    onClick={sendOrder}
                    disabled={busy}
                    className="w-full bg-amber-500 text-white py-3.5 rounded-xl font-bold text-base hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50"
                  >
                    📤 Tuma kwa Counter ({pendingCount} bidhaa)
                  </button>
                )}
                {order.items.length > 0 && pendingCount === 0 && balance > 0.5 && (
                  <>
                    <button
                      onClick={() => { setPayAmount(String(balance)); setPayModal(true) }}
                      disabled={busy}
                      className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-base hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                    >
                      💰 Pokea Malipo (Baki: TSh {balance.toLocaleString()})
                    </button>
                    {order.paidAmount === 0 && (
                      <button
                        onClick={async () => {
                          if (!token || !confirm('Funga kama Signed Bill (deni)?')) return
                          setBusy(true)
                          const res = await fetch(`/api/pos/orders/${orderId}/close`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ paymentMethod: 'SIGNED', paidAmount: 0 }),
                          })
                          if (res.ok) { alert('✅ Imefungwa kama Signed Bill'); router.back() }
                          setBusy(false)
                        }}
                        disabled={busy}
                        className="w-full border-2 border-gray-300 text-gray-600 py-2.5 rounded-xl font-semibold text-sm hover:bg-gray-50 transition-all disabled:opacity-50"
                      >
                        ✍️ Funga kama Signed Bill
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Payment modal — partial payments with running balance */}
            {payModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPayModal(false)}>
                <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
                  <h3 className="font-bold text-gray-800 text-lg mb-1">Pokea Malipo</h3>
                  <div className="text-sm text-gray-500 mb-4 space-y-0.5">
                    <div className="flex justify-between"><span>Jumla</span><span>TSh {net.toLocaleString()}</span></div>
                    {order.paidAmount > 0 && <div className="flex justify-between text-green-700"><span>Imelipwa</span><span>TSh {order.paidAmount.toLocaleString()}</span></div>}
                    <div className="flex justify-between font-bold text-gray-800"><span>Baki</span><span>TSh {balance.toLocaleString()}</span></div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="Kiasi kinacholipwa sasa (TSh)"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg mb-3 focus:outline-none focus:border-indigo-400"
                    autoFocus
                  />
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {PAY_METHODS.map(m => (
                      <button
                        key={m.code}
                        onClick={() => setPayMethod(m.code)}
                        className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition-colors ${payMethod === m.code ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setPayModal(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                    <button onClick={recordPayment} disabled={busy} className="bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 disabled:opacity-50">
                      {busy ? 'Inapokea...' : '✓ Pokea & Thibitisha'}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-3 text-center">Kupokea = kuthibitisha malipo. Ukilipa pungufu, baki litabaki kwenye bili.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* MENU TAB */}
        {tab === 'menu' && !isClosed && (
          <div>
            {/* Selected product form */}
            {selectedProduct ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="font-bold text-gray-800">{selectedProduct.name}</h3>
                    <p className="text-indigo-600 font-semibold">TSh {selectedProduct.sellingPrice.toLocaleString()}</p>
                  </div>
                  <button onClick={() => setSelectedProduct(null)} className="text-gray-400 text-2xl">×</button>
                </div>

                {/* Counter selection */}
                <p className="text-xs text-gray-500 font-medium mb-2">Tuma kwa counter:</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {counters.map(c => (
                    <button
                      key={c.code}
                      onClick={() => setSelectedCounter(c.code)}
                      className={`py-2 rounded-xl text-sm font-medium border-2 transition-colors ${selectedCounter === c.code ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 text-gray-600'}`}
                    >
                      {counterLabel(c.code, c.label)}
                    </button>
                  ))}
                </div>

                {/* Extras */}
                {extras.length > 0 && (
                  <>
                    <p className="text-xs text-gray-500 font-medium mb-2">Ongeza (optional):</p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      {extras.map(e => (
                        <button
                          key={e}
                          onClick={() => toggleExtra(e)}
                          className={`px-3 py-1 rounded-full text-sm border transition-colors ${selectedExtras.includes(e) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-600'}`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Quantity */}
                <p className="text-xs text-gray-500 font-medium mb-2">Idadi:</p>
                <div className="flex items-center gap-4 mb-4">
                  <button onClick={() => setQty(q => Math.max(1, q - 1))} className="w-10 h-10 rounded-full bg-gray-100 text-xl font-bold hover:bg-gray-200">−</button>
                  <span className="text-2xl font-bold w-10 text-center">{qty}</span>
                  <button onClick={() => setQty(q => q + 1)} className="w-10 h-10 rounded-full bg-gray-100 text-xl font-bold hover:bg-gray-200">+</button>
                  <span className="ml-auto font-bold text-indigo-900">
                    = TSh {(selectedProduct.sellingPrice * qty).toLocaleString()}
                  </span>
                </div>

                <button
                  onClick={addItem}
                  disabled={busy}
                  className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold text-base hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-50"
                >
                  ➕ Ongeza kwenye Order
                </button>
              </div>
            ) : (
              <>
                {/* Search */}
                <input
                  type="text"
                  placeholder="Tafuta bidhaa..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 focus:outline-none focus:border-indigo-400"
                />

                {/* Category tabs */}
                {!search && (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
                    {Object.keys(products).map(cat => (
                      <button
                        key={cat}
                        onClick={() => setActiveCategory(cat)}
                        className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${activeCategory === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {/* Product grid */}
                <div className="grid grid-cols-2 gap-2">
                  {filteredProducts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProduct(p); setQty(1); setSelectedExtras([]) }}
                      className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 text-left hover:border-indigo-300 hover:shadow-md transition-all active:scale-95"
                    >
                      <div className="text-sm font-medium text-gray-800 leading-tight mb-1">{p.name}</div>
                      <div className="text-indigo-600 font-bold text-sm">TSh {p.sellingPrice.toLocaleString()}</div>
                    </button>
                  ))}
                </div>

                {filteredProducts.length === 0 && (
                  <div className="text-center py-10 text-gray-400 text-sm">Hakuna bidhaa</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
