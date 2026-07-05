'use client'
import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'
import { useUnlockedAudio } from '@/lib/audio-unlock'

// Outlets can have different physical counter setups (e.g. Mikocheni's Main
// Bar + VIP + Shisha + Kitchen), so the tab list is fetched per-outlet (see
// loadCounters below) rather than hardcoded. This icon map is cosmetic only.
const COUNTER_ICONS: Record<string, string> = {
  MAIN: '🍹', BAR: '🍺', VIP: '👑', SHISHA: '💨', KITCHEN: '🍽',
}
const REFRESH_MS = 5_000

interface CounterDef { code: string; label: string; serviceModel: string }

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

interface Group {
  orderNo: string
  table: { number: number; label: string | null } | null
  waiter: { name: string }
  items: OrderItem[]
  earliest: number
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return <button onClick={onClick} className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${on ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}>{label}</button>
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
const parseExtras = (e: string | null): string[] => { if (!e) return []; try { return JSON.parse(e) } catch { return [] } }

function groupItems(items: OrderItem[]): Group[] {
  const m = new Map<string, Group>()
  for (const it of items) {
    let g = m.get(it.order.orderNo)
    if (!g) { g = { orderNo: it.order.orderNo, table: it.order.table, waiter: it.order.waiter, items: [], earliest: Infinity }; m.set(it.order.orderNo, g) }
    g.items.push(it)
    const t = it.sentAt ? new Date(it.sentAt).getTime() : 0
    if (t < g.earliest) g.earliest = t
  }
  return [...m.values()].sort((a, b) => a.earliest - b.earliest)
}

function buildChit(g: Group, counterLabel: string, when: string): string {
  const rows = g.items.map((i) => {
    const ex = parseExtras(i.extras)
    return `<tr><td class="q">${i.quantity}×</td><td>${esc(i.productName)}${ex.length ? `<div class="ex">+ ${esc(ex.join(', '))}</div>` : ''}</td></tr>`
  }).join('')
  const tableLine = g.table ? `Meza: ${g.table.number}${g.table.label ? ` - ${esc(g.table.label)}` : ''}` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(g.orderNo)}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { width: 80mm; margin: 0; padding: 4mm; font-family: 'Courier New', monospace; color: #000; }
h1 { font-size: 16px; text-align: center; margin: 0 0 2mm; letter-spacing: 1px; }
.meta { font-size: 12px; margin: 0 0 1mm; }
hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
table { width: 100%; font-size: 14px; border-collapse: collapse; }
td { vertical-align: top; padding: 1mm 0; }
.q { width: 10mm; font-weight: bold; }
.ex { font-size: 11px; padding-left: 2mm; }
.foot { text-align: center; font-size: 11px; margin-top: 3mm; }
</style></head><body>
<h1>${esc(counterLabel)}</h1>
<div class="meta">Agizo: ${esc(g.orderNo)}</div>
${tableLine ? `<div class="meta">${tableLine}</div>` : ''}
<div class="meta">Waiter: ${esc(g.waiter.name)}</div>
<div class="meta">${esc(when)}</div>
<hr/>
<table>${rows}</table>
<hr/>
<div class="foot">Tips MyPos</div>
</body></html>`
}

function CounterView() {
  const { token, user } = useAuth()
  const searchParams = useSearchParams()
  const [counters, setCounters] = useState<CounterDef[]>([])
  const [activeCounter, setActiveCounter] = useState(searchParams.get('code') ?? '')
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(true)
  const [doneToday, setDoneToday] = useState(0)
  const [marking, setMarking] = useState<string | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [autoPrint, setAutoPrint] = useState(false)
  const [flash, setFlash] = useState(false)
  const [newOrders, setNewOrders] = useState<Set<string>>(new Set())

  const seenRef = useRef<Set<string>>(new Set())
  const firstLoadRef = useRef(true)
  const audioRef = useUnlockedAudio()
  const soundRef = useRef(soundOn)
  const autoPrintRef = useRef(autoPrint)
  useEffect(() => { soundRef.current = soundOn }, [soundOn])
  useEffect(() => { autoPrintRef.current = autoPrint }, [autoPrint])

  const counterLabel = counters.find((c) => c.code === activeCounter)?.label ?? activeCounter

  useEffect(() => {
    if (!token || !user?.outlet?.id) return
    fetch(`/api/pos/counters?outletId=${user.outlet.id}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : [])
      .then((data: CounterDef[]) => {
        setCounters(data)
        setActiveCounter(prev => prev || data[0]?.code || '')
      })
  }, [token, user?.outlet?.id])

  const beep = useCallback(() => {
    if (!soundRef.current) return
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioRef.current ??= new Ctx()
      const ctx = audioRef.current
      if (ctx.state === 'suspended') ctx.resume()
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = 880
      g.gain.setValueAtTime(0.0001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
      o.start(); o.stop(ctx.currentTime + 0.35)
    } catch { /* audio blocked — ignore */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const printChit = useCallback((g: Group) => {
    const html = buildChit(g, counterLabel.toUpperCase(), new Date().toLocaleString('sw-TZ'))
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    document.body.appendChild(iframe)
    const doc = iframe.contentWindow?.document
    if (!doc) { document.body.removeChild(iframe); return }
    doc.open(); doc.write(html); doc.close()
    iframe.contentWindow?.focus()
    setTimeout(() => {
      try { iframe.contentWindow?.print() } catch { /* ignore */ }
      setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe) }, 1500)
    }, 300)
  }, [counterLabel])

  const load = useCallback(async () => {
    if (!token || !activeCounter) return
    const res = await fetch(`/api/pos/counter?code=${activeCounter}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) { setLoading(false); return }
    const data: OrderItem[] = await res.json()

    const fresh = data.filter((d) => !seenRef.current.has(d.id))
    if (!firstLoadRef.current && fresh.length > 0) {
      beep()
      setFlash(true); setTimeout(() => setFlash(false), 1600)
      const freshOrders = new Set(fresh.map((f) => f.order.orderNo))
      setNewOrders(freshOrders); setTimeout(() => setNewOrders(new Set()), 4000)
      if (autoPrintRef.current) {
        for (const g of groupItems(data).filter((g) => freshOrders.has(g.orderNo))) printChit(g)
      }
    }
    data.forEach((d) => seenRef.current.add(d.id))
    firstLoadRef.current = false
    setItems(data)
    setLoading(false)
  }, [token, activeCounter, beep, printChit])

  // Reset "seen" tracking when switching counters so other counters' items
  // don't all register as "new".
  useEffect(() => {
    seenRef.current = new Set(); firstLoadRef.current = true
    setItems([]); setLoading(true); setNewOrders(new Set())
  }, [activeCounter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const groups = useMemo(() => groupItems(items), [items])

  const markPrepared = useCallback(async (itemId: string) => {
    if (!token) return
    setMarking(itemId)
    setItems((prev) => prev.filter((i) => i.id !== itemId))
    const res = await fetch('/api/pos/counter', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    })
    if (res.ok) setDoneToday((n) => n + 1); else load()
    setMarking(null)
  }, [token, load])

  const markGroup = useCallback(async (g: Group) => {
    for (const it of g.items) await markPrepared(it.id)
  }, [markPrepared])

  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return ''
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
    if (diff < 1) return 'Sasa hivi'
    return `Min ${diff} iliyopita`
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className={`max-w-2xl mx-auto transition-colors ${flash ? 'ring-4 ring-amber-300 rounded-2xl' : ''}`}>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-bold text-indigo-900">Counter View</h1>
          <div className="flex items-center gap-2">
            <Toggle on={soundOn} onClick={() => setSoundOn((v) => !v)} label={soundOn ? '🔔 Sauti' : '🔕 Sauti'} />
            <Toggle on={autoPrint} onClick={() => setAutoPrint((v) => !v)} label="🖨 Auto-chapisha" />
            {doneToday > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">✓ Tayari: {doneToday}</span>}
            <button onClick={load} className="text-sm text-indigo-600 hover:underline">↻</button>
          </div>
        </div>

        {/* Counter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {counters.map((c) => (
            <button
              key={c.code}
              onClick={() => setActiveCounter(c.code)}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${activeCounter === c.code ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {COUNTER_ICONS[c.code] ?? '🔸'} {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : groups.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-gray-500 font-medium">Hakuna maagizo mapya</p>
            <p className="text-gray-400 text-sm mt-1">Inaboresha kila sekunde {REFRESH_MS / 1000}...</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const isNew = newOrders.has(g.orderNo)
              return (
                <div key={g.orderNo} className={`bg-white rounded-2xl shadow-sm border-l-4 border-amber-400 p-4 transition-all ${isNew ? 'ring-2 ring-amber-400' : ''}`}>
                  {/* Group header — table + order + waiter */}
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      {g.table ? (
                        <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full text-sm font-bold">
                          Meza {g.table.number}{g.table.label ? ` — ${g.table.label}` : ''}
                        </span>
                      ) : (
                        <span className="font-bold text-gray-800">{g.orderNo}</span>
                      )}
                      <span className="ml-2 text-xs text-gray-400">{g.orderNo}</span>
                    </div>
                    <span className="text-xs text-gray-400">{timeAgo(g.items[0]?.sentAt ?? null)}</span>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-gray-50">
                    {g.items.map((item) => {
                      const ex = parseExtras(item.extras)
                      return (
                        <div key={item.id} className="flex items-center justify-between py-2">
                          <div>
                            <div className="font-semibold text-gray-900">{item.quantity} × {item.productName}</div>
                            {ex.length > 0 && <div className="text-sm text-amber-700 font-medium">+ {ex.join(', ')}</div>}
                          </div>
                          <button
                            onClick={() => markPrepared(item.id)}
                            disabled={marking === item.id}
                            className="bg-green-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50"
                          >
                            {marking === item.id ? '...' : '✓ Tayari'}
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  {/* Group footer — waiter + actions */}
                  <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
                    <span className="text-xs text-gray-400">Waiter: {g.waiter.name}</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => printChit(g)} className="text-xs font-semibold text-indigo-600 border border-indigo-200 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors">🖨 Chapisha</button>
                      {g.items.length > 1 && (
                        <button onClick={() => markGroup(g)} className="text-xs font-bold text-white bg-green-600 px-3 py-1.5 rounded-lg hover:bg-green-700 transition-colors">✓ Tayari zote</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
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
