'use client'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import { buildBillHtml, printHtml, BILL_TYPES, BILL_TYPE_LABELS } from '@/lib/pos-receipt'
import { useUnlockedAudio } from '@/lib/audio-unlock'
import { PushEnableBanner } from '@/components/PushEnableBanner'
import { allowedCountersForCategory } from '@/lib/shared-constants'
import {
  apiFetch, NetworkError, addLocalItem, removeLocalItem, enqueueSendOrder,
  onQueueEvent, getChainState, getChainError, discardLocalOrder, retryChain,
} from '@/lib/offline-queue'
import { getLocalOrder, type LocalOrder } from '@/lib/offline-db'
import { getWithCache } from '@/lib/offline-cache'

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
  sentAt: string | null
  preparedAt: string | null
  preparedByName: string | null
}

interface Payment { id: string; amount: number; method: string; receivedByName: string; createdAt: string }

interface Order {
  id: string
  orderNo: string
  status: string
  billType: string
  totalAmount: number
  discount: number
  discountReason: string | null
  paidAmount: number
  createdAt: string
  outletId: string
  eventId?: string | null
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

/** Renders a still-unsynced LocalOrder (see lib/offline-db.ts) in the same
 *  shape as a real server Order, so the rest of this screen doesn't need a
 *  separate code path for the "never reached the server yet" case. */
function localOrderToOrderShape(local: LocalOrder, waiterName: string): Order {
  const items: OrderItem[] = local.items.map((i) => ({
    id: i.localItemId,
    productName: i.productName,
    unitPrice: i.unitPrice,
    quantity: i.quantity,
    amount: i.amount,
    extras: i.extras.length ? JSON.stringify(i.extras) : null,
    counterCode: i.counterCode,
    status: 'PENDING',
    sentAt: null,
    preparedAt: null,
    preparedByName: null,
  }))
  return {
    id: local.localOrderId,
    orderNo: '— bado haijatumwa —',
    status: 'OPEN',
    billType: 'CUSTOMER',
    totalAmount: items.reduce((s, i) => s + i.amount, 0),
    discount: 0,
    discountReason: null,
    paidAmount: 0,
    createdAt: new Date(local.createdAt).toISOString(),
    outletId: local.outletId,
    table: local.tableId ? { number: local.tableNumber ?? 0, label: local.tableLabel ?? null } : null,
    waiter: { name: waiterName },
    shift: { name: '' },
    outlet: null,
    items,
    payments: [],
  }
}

export default function OrderPage() {
  const { token, user } = useAuth()
  const router = useRouter()
  const { id: orderId } = useParams<{ id: string }>()
  const isLocalOrder = orderId.startsWith('local-')

  const [order, setOrder] = useState<Order | null>(null)
  const [chainState, setChainState] = useState<'synced' | 'pending' | 'blocked'>('synced')
  const [chainError, setChainError] = useState<string | undefined>()
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
  const [discountReasonInput, setDiscountReasonInput] = useState('')
  const [justReady, setJustReady] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const prevStatusRef = useRef<string | null>(null)
  const audioRef = useUnlockedAudio()

  // Shisha/food/other products can each only be sent to the counter(s) that
  // stock them — see allowedCountersForCategory. Narrows the picker and
  // auto-selects when there's only one valid counter.
  const availableCounters = useMemo(() => {
    if (!selectedProduct) return counters
    const allowed = allowedCountersForCategory(selectedProduct.category)
    return counters.filter((c) => allowed.includes(c.code))
  }, [counters, selectedProduct])

  useEffect(() => {
    if (!selectedProduct) return
    setSelectedCounter((prev) => {
      if (availableCounters.some((c) => c.code === prev)) return prev
      return availableCounters.length === 1 ? availableCounters[0].code : ''
    })
  }, [selectedProduct, availableCounters])

  const loadOrder = useCallback(async () => {
    // A never-synced order lives only in IndexedDB until its CREATE_ORDER
    // action flushes — see lib/offline-queue.ts's 'order-resolved' handling
    // below for the transition to a real, server-backed order.
    if (isLocalOrder) {
      const local = await getLocalOrder(orderId)
      if (local) setOrder(localOrderToOrderShape(local, user?.name ?? ''))
      return
    }
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
  }, [token, orderId, isLocalOrder, user?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadMenu = useCallback(async (eventId?: string | null) => {
    if (!token) return
    try {
      const url = eventId ? `/api/pos/products?eventId=${eventId}` : '/api/pos/products'
      const { data } = await getWithCache<{ grouped: Record<string, Product[]> }>(eventId ? `products_event_${eventId}` : 'products', async () => {
        const res = await apiFetch(url, { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Failed to load products')
        return res.json()
      })
      setProducts(data.grouped)
      const cats = Object.keys(data.grouped)
      if (cats.length > 0) setActiveCategory(cats[0])
    } catch { /* real rejection or no cache yet */ }
  }, [token])

  const loadExtras = useCallback(async () => {
    if (!token) return
    try {
      const { data } = await getWithCache<{ name: string }[]>('extras', async () => {
        const res = await apiFetch('/api/pos/extras', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) throw new Error('Failed to load extras')
        return res.json()
      })
      setExtras(data.map(e => e.name))
    } catch { /* real rejection or no cache yet */ }
  }, [token])

  useEffect(() => {
    loadOrder()
    loadMenu()
    loadExtras()
  }, [loadOrder, loadMenu, loadExtras])

  // Once this local order's CREATE_ORDER syncs, fetch the authoritative
  // server copy and swap the URL to the real id via router.replace (not
  // push) — no full navigation/remount, just the URL catching up to reality.
  useEffect(() => {
    return onQueueEvent((event) => {
      if (event.type === 'order-resolved' && event.localOrderId === orderId && token) {
        fetch(`/api/pos/orders/${event.realOrderId}`, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data) {
              setOrder(data)
              router.replace(`/pos/order/${event.realOrderId}`, { scroll: false })
            }
          })
          .catch(() => {})
      }
      if (event.type === 'chain-blocked' && event.chainKey === orderId) {
        setChainState('blocked')
        setChainError(event.error)
      }
    })
  }, [orderId, token, router])

  // Reflects this order's current queue state (pending sync / blocked /
  // fully synced) in the offline badge — checked on an interval since events
  // only fire on transitions, not on page (re)load with pre-existing state.
  useEffect(() => {
    let cancelled = false
    const check = () => {
      getChainState(orderId).then((s) => { if (!cancelled) setChainState(s) })
      getChainError(orderId).then((e) => { if (!cancelled) setChainError(e) })
    }
    check()
    const t = setInterval(check, ORDER_POLL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [orderId])

  // Once the order tells us it's tagged to an event, swap the menu to that
  // event's authorized-products list only (see /api/pos/products?eventId=).
  // Mirrors the counters effect below — both wait on a field that's only
  // known after the order loads.
  useEffect(() => {
    if (order?.eventId) loadMenu(order.eventId)
  }, [order?.eventId, loadMenu])

  // Counter list is outlet-specific (Mikocheni's Main Bar/VIP/Shisha/Kitchen
  // differs from other outlets), so it's fetched once the order tells us
  // which outlet it belongs to, rather than hardcoded.
  useEffect(() => {
    if (!token || !order?.outletId) return
    getWithCache<Counter[]>(`counters_${order.outletId}`, async () => {
      const res = await apiFetch(`/api/pos/counters?outletId=${order.outletId}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('Failed to load counters')
      return res.json()
    })
      .then(({ data }) => {
        setCounters(data)
        setSelectedCounter(prev => prev || data[0]?.code || '')
      })
      .catch(() => {})
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
    const itemPayload = {
      productId: selectedProduct.id, productName: selectedProduct.name, unitPrice: selectedProduct.sellingPrice,
      quantity: qty, amount: selectedProduct.sellingPrice * qty, extras: selectedExtras, counterCode: selectedCounter,
    }
    if (isLocalOrder) {
      // Never reached the server yet at all — add straight to the local
      // order and its queued CREATE_ORDER chain (see lib/offline-queue.ts).
      await addLocalItem(orderId, itemPayload)
      await loadOrder()
      setSelectedProduct(null); setSelectedExtras([]); setQty(1); setTab('order')
      setBusy(false)
      return
    }
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: itemPayload.productId, quantity: itemPayload.quantity, extras: itemPayload.extras, counterCode: itemPayload.counterCode }),
      })
      if (res.ok) {
        await loadOrder()
        setSelectedProduct(null); setSelectedExtras([]); setQty(1); setTab('order')
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error ?? 'Hitilafu')
      }
    } catch (err) {
      if (err instanceof NetworkError) {
        // The order already exists server-side; this one add-item call just
        // couldn't reach it right now — queue it against the real order id,
        // it'll sync automatically (see lib/offline-queue.ts).
        await addLocalItem(orderId, itemPayload)
        alert('📴 Hakuna mtandao — bidhaa imewekwa kwenye foleni, itatumwa yenyewe.')
        setSelectedProduct(null); setSelectedExtras([]); setQty(1); setTab('order')
      } else {
        alert('Tatizo la mtandao — jaribu tena.')
      }
    }
    setBusy(false)
  }

  const removeItem = async (itemId: string) => {
    if (!token) return
    if (isLocalOrder) {
      // Never left the device — nothing to undo server-side.
      await removeLocalItem(orderId, itemId)
      await loadOrder()
      return
    }
    // Captured for the Cancelled/Void Orders report — why, not just that.
    const reason = window.prompt('Sababu ya kuondoa bidhaa hii (hiari):') ?? ''
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}/items?itemId=${itemId}&reason=${encodeURIComponent(reason)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) alert('Imeshindikana kuondoa — jaribu tena.')
    } catch (err) {
      if (err instanceof NetworkError) alert('📴 Kuondoa bidhaa kunahitaji mtandao — jaribu tena.')
    }
    loadOrder()
  }

  const sendOrder = async () => {
    if (!token) return
    setBusy(true)
    if (isLocalOrder) {
      await enqueueSendOrder(orderId)
      alert('📴 Hakuna mtandao — order itatumwa kwa counter yenyewe mtandao utakaporudi.')
      setBusy(false)
      return
    }
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}/send`, {
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
    } catch (err) {
      if (err instanceof NetworkError) {
        await enqueueSendOrder(orderId)
        alert('📴 Hakuna mtandao — itatumwa yenyewe mtandao utakaporudi.')
      } else {
        alert('Tatizo la mtandao — jaribu tena.')
      }
    }
    setBusy(false)
  }

  // Discount, bill-type, printing, and closing all require a real, synced
  // order AND a live connection — never queued offline (payments-adjacent,
  // see the offline-resilience scope decision). These wrap apiFetch so a
  // transient network failure shows a clear message instead of failing
  // silently or throwing uncaught, which is what happened here before.
  const applyDiscount = async () => {
    if (!token || !order) return
    const val = parseFloat(discountInput)
    if (isNaN(val) || val < 0) return
    setBusy(true)
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount: val, discountReason: discountReasonInput.trim() || null }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error ?? 'Hitilafu'); setBusy(false); return }
      await loadOrder()
    } catch (err) {
      if (err instanceof NetworkError) alert('📴 Inahitaji mtandao — jaribu tena.')
    }
    setDiscountModal(false)
    setDiscountInput('')
    setDiscountReasonInput('')
    setBusy(false)
  }

  // ---- Bill printing & bill type ----
  const printBill = () => { if (order) printHtml(buildBillHtml(order)) }

  const setBillType = async (billType: string) => {
    if (!token || !order) return
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ billType }),
      })
      if (!res.ok) { const err = await res.json().catch(() => ({})); alert(err.error ?? 'Hitilafu'); return }
    } catch (err) {
      if (err instanceof NetworkError) { alert('📴 Inahitaji mtandao — jaribu tena.'); return }
    }
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
    try {
      const res = await apiFetch(`/api/pos/orders/${orderId}/pay`, {
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
    } catch (err) {
      if (err instanceof NetworkError) alert('📴 Malipo yanahitaji mtandao — jaribu tena.')
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
  // Once a counter marks an item prepared/served, it's done — keep the main
  // list focused on what's still in flight and move served items to History.
  const activeItems = order.items.filter(i => i.status !== 'PREPARED')
  const historyItems = order.items.filter(i => i.status === 'PREPARED')

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

        {/* Offline-queue state — a still-unsynced order or a chain the server
            genuinely rejected once reconnected (not a transient blip). */}
        {chainState === 'pending' && (
          <div className="mb-4 rounded-xl p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium text-center">
            📴 Bado haijatumwa — itatuma yenyewe mtandao utakaporudi.
          </div>
        )}
        {chainState === 'blocked' && (
          <div className="mb-4 rounded-xl p-3 bg-rose-50 border border-rose-200 text-rose-800 text-sm">
            <p className="font-bold mb-1">⚠️ Imeshindikana kutuma</p>
            <p className="mb-2">{chainError ?? 'Hitilafu haijulikani.'}</p>
            <div className="flex gap-2">
              <button
                onClick={() => retryChain(orderId, () => token)}
                className="text-xs font-semibold bg-rose-600 text-white px-3 py-1.5 rounded-lg hover:bg-rose-700"
              >
                🔄 Jaribu tena
              </button>
              {isLocalOrder && (
                <button
                  onClick={async () => { if (confirm('Futa order hii kabisa? Utaanza upya.')) { await discardLocalOrder(orderId); router.back() } }}
                  className="text-xs font-semibold text-rose-700 border border-rose-300 px-3 py-1.5 rounded-lg hover:bg-rose-100"
                >
                  🗑 Futa na uanze upya
                </button>
              )}
            </div>
          </div>
        )}

        {order.eventId && (
          <div className="mb-4 rounded-xl p-3 bg-indigo-50 border border-indigo-200 text-indigo-800 text-sm font-medium text-center">
            🎉 Event menu — bidhaa zilizoruhusiwa kwa tukio hili tu
          </div>
        )}

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
            {historyItems.length > 0 && (
              <button onClick={() => setShowHistory(true)} className="mb-3 text-xs font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">
                📜 Historia ya bidhaa zilizohudumiwa ({historyItems.length})
              </button>
            )}
            {activeItems.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <div className="text-4xl mb-2">{order.items.length === 0 ? '🛒' : '✅'}</div>
                <p>{order.items.length === 0 ? 'Hakuna bidhaa bado.' : 'Bidhaa zote zimehudumiwa — angalia Historia.'}</p>
                {!isClosed && order.items.length === 0 && <button onClick={() => setTab('menu')} className="mt-3 text-indigo-600 text-sm font-medium">Ongeza bidhaa →</button>}
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                {activeItems.map(item => (
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
                  {!isClosed && !isLocalOrder && ['MANAGER', 'ADMIN'].includes(user?.role ?? '') && (
                    <button onClick={() => { setDiscountInput(String(order.discount)); setDiscountReasonInput(order.discountReason ?? ''); setDiscountModal(true) }} className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full hover:bg-rose-200">
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
                disabled={isClosed || isLocalOrder}
                className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 disabled:bg-gray-50"
              >
                {BILL_TYPES.map(t => <option key={t} value={t}>{BILL_TYPE_LABELS[t]}</option>)}
              </select>
              <button
                onClick={printBill}
                disabled={order.items.length === 0 || isLocalOrder}
                className="bg-gray-800 text-white px-4 py-2 rounded-xl font-semibold text-sm hover:bg-gray-900 active:scale-95 transition-all disabled:opacity-40"
              >
                🖨 {order.billType === 'CUSTOMER' ? 'Customer Bill' : 'In-House Bill'}
              </button>
            </div>
            {isLocalOrder && (
              <p className="text-xs text-amber-600 -mt-3 mb-4">📴 Punguzo, aina ya bili, na kuchapisha bili vinahitaji order isawazishwe kwanza.</p>
            )}

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
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg mb-3 focus:outline-none focus:border-indigo-400"
                    autoFocus
                  />
                  <input
                    type="text"
                    value={discountReasonInput}
                    onChange={e => setDiscountReasonInput(e.target.value)}
                    placeholder="Sababu ya punguzo (hiari)"
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-indigo-400"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setDiscountModal(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                    <button onClick={applyDiscount} disabled={busy} className="bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">Weka</button>
                  </div>
                </div>
              </div>
            )}

            {showHistory && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowHistory(false)}>
                <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-800 text-lg">Historia ya bidhaa</h3>
                    <button onClick={() => setShowHistory(false)} className="text-gray-400 text-2xl leading-none">×</button>
                  </div>
                  <div className="space-y-3">
                    {historyItems.map(item => (
                      <div key={item.id} className="border border-gray-100 rounded-xl p-3">
                        <div className="flex justify-between items-start">
                          <div className="font-medium text-gray-800 text-sm">{item.quantity} × {item.productName}</div>
                          <div className="text-sm font-bold text-gray-800">TSh {item.amount.toLocaleString()}</div>
                        </div>
                        {item.counterCode && (
                          <span className="inline-block mt-1 bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-xs">
                            {counterLabel(item.counterCode, counters.find(c => c.code === item.counterCode)?.label)}
                          </span>
                        )}
                        <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                          {item.sentAt && <div>Iliyotumwa: {new Date(item.sentAt).toLocaleString('sw-TZ')}</div>}
                          {item.preparedAt && <div>Ilihudumiwa: {new Date(item.preparedAt).toLocaleString('sw-TZ')}</div>}
                          {item.preparedByName && <div>Na: {item.preparedByName}</div>}
                        </div>
                      </div>
                    ))}
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
                          try {
                            const res = await apiFetch(`/api/pos/orders/${orderId}/close`, {
                              method: 'POST',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ paymentMethod: 'SIGNED', paidAmount: 0 }),
                            })
                            if (res.ok) { alert('✅ Imefungwa kama Signed Bill'); router.back() }
                            else { const err = await res.json().catch(() => ({})); alert(err.error ?? 'Hitilafu') }
                          } catch (err) {
                            if (err instanceof NetworkError) alert('📴 Kufunga bili kunahitaji mtandao — jaribu tena.')
                          }
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
                  {availableCounters.map(c => (
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
