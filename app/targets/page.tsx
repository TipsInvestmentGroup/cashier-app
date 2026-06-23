'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { TARGETS, targetLevels, fmtTarget, type TargetDef } from '@/lib/targets'
import { formatDate } from '@/lib/utils'
import { generateWarningLetters, type FlaggedItem } from '@/lib/warning-letter-pdf'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns'
import { Target, Wallet, Cigarette, UtensilsCrossed, Building2, User, Crown, Trash2, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'

const OUTLETS = ['All', 'Mikocheni', 'Coco'] as const
const deptIcon = (d: string) => (d === 'Shisha Sales' ? Cigarette : d === 'Food Sales' ? UtensilsCrossed : Wallet)
const scopeIcon = (s: string) => (s === 'Per Outlet' ? Building2 : s === 'Per Manager' ? Crown : User)
const deptKey = (d: string): 'collection' | 'shisha' | 'food' => (d === 'Shisha Sales' ? 'shisha' : d === 'Food Sales' ? 'food' : 'collection')

interface OutletRow { id: string; name: string }
interface StaffRow { staffName: string; collection: number; shisha: number; food: number }
interface Perf { outlets: OutletRow[]; byOutlet: Record<string, { collection: number; shisha: number; food: number }>; byStaff: Record<string, StaffRow[]> }

interface UploadRow { id: string; date: string; staffName: string; value: number; outletId?: string; outlet?: { name: string } }

export default function TargetsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()
  const isAdmin = user?.role === 'ADMIN'
  const now = new Date()
  const [view, setView] = useState<'targets' | 'performance' | 'uploads'>('targets')
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [outlet, setOutlet] = useState<(typeof OUTLETS)[number]>('All')
  const [perf, setPerf] = useState<Perf | null>(null)
  const [perfPrev, setPerfPrev] = useState<Perf | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadDept, setUploadDept] = useState<'SHISHA' | 'FOOD'>('SHISHA')
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [lockedDays, setLockedDays] = useState<Set<string>>(new Set())

  const [my, mm] = month.split('-').map(Number)
  const daysInMonth = new Date(my, mm, 0).getDate()
  const win = period === 'weekly'
    ? { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    : { from: startOfMonth(new Date(my, mm - 1, 1)), to: endOfMonth(new Date(my, mm - 1, 1)) }
  const prevWin = period === 'weekly'
    ? { from: startOfWeek(subWeeks(win.from, 1), { weekStartsOn: 1 }), to: endOfWeek(subWeeks(win.from, 1), { weekStartsOn: 1 }) }
    : { from: startOfMonth(subMonths(win.from, 1)), to: endOfMonth(subMonths(win.from, 1)) }

  const loadPerf = useCallback(async () => {
    setLoading(true)
    try {
      const q = (w: { from: Date; to: Date }) => new URLSearchParams({ from: format(w.from, 'yyyy-MM-dd'), to: format(w.to, 'yyyy-MM-dd') })
      const [cur, prev] = await Promise.all([
        request(`/api/targets/performance?${q(win)}`),
        request(`/api/targets/performance?${q(prevWin)}`).catch(() => null),
      ])
      setPerf(cur); setPerfPrev(prev)
    } finally { setLoading(false) }
  }, [request, period, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'performance') loadPerf() }, [view, loadPerf])

  const loadUploads = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ department: uploadDept, from: format(win.from, 'yyyy-MM-dd'), to: format(win.to, 'yyyy-MM-dd') })
      const r = await request(`/api/sales-metrics?${qs}`)
      setUploads(r.rows || [])
      setLockedDays(new Set(r.lockedDays || []))
    } finally { setLoading(false) }
  }, [request, uploadDept, period, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'uploads') loadUploads() }, [view, loadUploads])

  const dayOf = (iso: string) => iso.slice(0, 10)
  const lockDate = async (date: string, outletId?: string) => {
    if (!outletId) return toast.error('No outlet for this date.')
    try { await request('/api/sales-metrics/lock', { method: 'POST', body: JSON.stringify({ department: uploadDept, date, outletId }) }); toast.success('Day locked'); loadUploads() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not lock') }
  }
  const unlockDate = async (date: string, outletId?: string) => {
    if (!outletId) return
    if (!(await confirm({ title: 'Unlock day', message: `Unlock ${formatDate(date)}? It will be editable again.`, confirmLabel: 'Unlock' }))) return
    try { await request(`/api/sales-metrics/lock?department=${uploadDept}&date=${date}&outletId=${outletId}`, { method: 'DELETE' }); toast.success('Day unlocked'); loadUploads() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not unlock') }
  }

  const deleteRow = async (id: string) => {
    if (!(await confirm({ title: 'Delete row', message: 'Remove this uploaded sales row?', danger: true, confirmLabel: 'Delete' }))) return
    try { await request(`/api/sales-metrics?id=${id}`, { method: 'DELETE' }); toast.success('Row deleted'); loadUploads() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }
  const clearShown = async (ids: string[]) => {
    if (!ids.length) return
    if (!(await confirm({ title: 'Clear rows', message: `Delete all ${ids.length} shown rows? This cannot be undone.`, danger: true, confirmLabel: 'Delete all' }))) return
    try { await request('/api/sales-metrics', { method: 'DELETE', body: JSON.stringify({ ids }) }); toast.success('Rows cleared'); loadUploads() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not clear') }
  }

  const groups = ['Mikocheni', 'Coco'].filter((o) => outlet === 'All' || o === outlet)
  const dbOutlet = (g: string) => perf?.outlets.find((o) => o.name.toLowerCase().includes(g.toLowerCase()))

  // Build the performance model once (drives summary, CSV and the tables).
  const model = (view === 'performance' && perf) ? groups.map((g) => {
    const o = dbOutlet(g)
    const totals = (o && perf.byOutlet[o.id]) || { collection: 0, shisha: 0, food: 0 }
    const staff = (o && perf.byStaff[o.id]) || []
    const prevStaff = (o && perfPrev?.byStaff[o.id]) || []
    const items = TARGETS.filter((t) => t.outlet === g)
    const outletTargets = items.filter((t) => t.scope !== 'Per Staff').map((t) => ({ t, lv: targetLevels(t, period, daysInMonth), actual: totals[deptKey(t.department)] }))
    const staffTargets = items.filter((t) => t.scope === 'Per Staff').map((t) => {
      const dk = deptKey(t.department); const lv = targetLevels(t, period, daysInMonth)
      const prevMap: Record<string, number> = {}; prevStaff.forEach((s) => { prevMap[s.staffName.toLowerCase()] = s[dk] })
      const rows = staff.map((s) => ({ name: s.staffName, actual: s[dk], prev: prevMap[s.staffName.toLowerCase()] ?? 0 }))
        .filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual).map((r, i) => ({ ...r, rank: i + 1 }))
      return { t, lv, rows }
    })
    return { g, o, outletTargets, staffTargets }
  }) : []

  const flags = { reward: 0, letter: 0, onTrack: 0 }
  const flaggedItems: FlaggedItem[] = []
  model.forEach((m) => m.staffTargets.forEach((st) => st.rows.forEach((r) => {
    const lab = statusOf(r.actual, st.lv).label
    if (lab === 'Reward') flags.reward++
    else if (lab === 'Letter') { flags.letter++; flaggedItems.push({ staff: r.name, outlet: m.g, department: st.t.department, unit: st.t.unit, actual: r.actual, target: st.lv.target, threshold: st.lv.letterBelow }) }
    else flags.onTrack++
  })))
  const periodLabel = period === 'weekly' ? `${format(win.from, 'dd MMM')} – ${format(win.to, 'dd MMM yyyy')}` : format(win.from, 'MMMM yyyy')
  const flaggedStaffCount = new Set(flaggedItems.map((f) => f.staff.toLowerCase())).size

  const exportPerfCsv = () => {
    const rows: Record<string, unknown>[] = []
    model.forEach((m) => m.staffTargets.forEach((st) => st.rows.forEach((r) => {
      rows.push({ Outlet: m.g, Department: st.t.department, Rank: r.rank, Staff: r.name, Actual: r.actual, Target: st.lv.target, Pct: st.lv.target > 0 ? Math.round((r.actual / st.lv.target) * 100) : 0, Status: statusOf(r.actual, st.lv).label, Previous: r.prev })
    })))
    if (!rows.length) return toast.error('Nothing to export')
    const headers = Object.keys(rows[0])
    const csv = [headers, ...rows.map((r) => headers.map((h) => { const s = String(r[h] ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }))].map((r) => r.join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `staff-performance-${period}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('CSV downloaded')
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales Targets</h1>
            <p className="text-gray-500 text-sm">Targets, thresholds and live performance per outlet, role and department</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {period === 'monthly' && (
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            )}
            <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1">
              {(['weekly', 'monthly'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition ${period === p ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* View + outlet filters */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1">
            {(['targets', 'performance', 'uploads'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize transition ${view === v ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'}`}>{v}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {OUTLETS.map((o) => (
              <button key={o} onClick={() => setOutlet(o)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${outlet === o ? 'bg-indigo-600 text-white shadow' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>{o}</button>
            ))}
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-900 flex flex-wrap gap-x-6 gap-y-1">
          <span><strong>Reward considered</strong> at ≥ 80% of target</span>
          <span><strong>Warning letter</strong> below ⅓ of target</span>
          <span className="text-indigo-500">
            {view === 'performance'
              ? `Window: ${format(win.from, 'dd MMM')} – ${format(win.to, 'dd MMM yyyy')}`
              : period === 'monthly' ? `Monthly = (Weekly ÷ 7) × ${daysInMonth} days` : 'Weekly = 7 days'}
          </span>
          {view === 'performance' && <span className="text-indigo-500 basis-full">Shisha &amp; Food actuals are net — signed bills (credit) and approved cancellations are subtracted.</span>}
        </div>

        {view === 'targets' && groups.map((g) => {
          const items = TARGETS.filter((t) => t.outlet === g)
          return (
            <div key={g}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400 mb-3">{g} Outlet</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {items.map((t, i) => <TargetCard key={i} t={t} period={period} daysInMonth={daysInMonth} />)}
              </div>
            </div>
          )
        })}

        {view === 'performance' && (loading ? (
          <div className="py-12 text-center text-gray-400">Loading performance…</div>
        ) : (
          <>
            {/* Flag summary + export */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-green-50 text-green-700">🎯 {flags.reward} for reward</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700">• {flags.onTrack} on track</span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-red-50 text-red-700">⚠️ {flags.letter} warning letters</span>
              </div>
              <div className="flex gap-2">
                {flaggedStaffCount > 0 && (
                  <Button variant="danger" size="sm" onClick={() => generateWarningLetters(flaggedItems, periodLabel)}>⚠️ Warning letters ({flaggedStaffCount})</Button>
                )}
                <Button variant="outline" size="sm" onClick={exportPerfCsv}>⬇ Export CSV</Button>
              </div>
            </div>

            {model.map((m) => (
              <div key={m.g} className="space-y-3">
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">{m.g} Outlet</h2>
                {!m.o && <p className="text-sm text-gray-400">No matching outlet found.</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {m.outletTargets.map((x, i) => <ProgressCard key={i} t={x.t} actual={x.actual} levels={x.lv} />)}
                </div>
                {m.staffTargets.map((x, i) => <StaffTable key={i} t={x.t} levels={x.lv} rows={x.rows} />)}
              </div>
            ))}
          </>
        ))}

        {view === 'uploads' && (() => {
          const unit = uploadDept === 'SHISHA' ? 'COUNT' as const : 'TZS' as const
          const shown = uploads.filter((r) => outlet === 'All' || (r.outlet?.name || '').toLowerCase().includes(outlet.toLowerCase()))
          const total = shown.reduce((s, r) => s + r.value, 0)
          const isLocked = (r: UploadRow) => lockedDays.has(dayOf(r.date))
          const unlockedIds = shown.filter((r) => !isLocked(r)).map((r) => r.id)
          // distinct day -> a representative outletId
          const dayMap = new Map<string, string | undefined>()
          shown.forEach((r) => { if (!dayMap.has(dayOf(r.date))) dayMap.set(dayOf(r.date), r.outletId) })
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-2">
                  {(['SHISHA', 'FOOD'] as const).map((d) => (
                    <button key={d} onClick={() => setUploadDept(d)}
                      className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${uploadDept === d ? 'bg-indigo-600 text-white shadow' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
                      {d === 'SHISHA' ? 'Shisha (Mikocheni)' : 'Food (Coco)'}
                    </button>
                  ))}
                </div>
                {unlockedIds.length > 0 && (
                  <Button variant="danger" size="sm" onClick={() => clearShown(unlockedIds)}>Clear unlocked ({unlockedIds.length})</Button>
                )}
              </div>

              {/* Lock / unlock per day */}
              {dayMap.size > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 flex flex-wrap gap-2 items-center">
                  <span className="text-xs font-semibold text-gray-500 mr-1">Days:</span>
                  {[...dayMap.entries()].map(([day, oid]) => {
                    const locked = lockedDays.has(day)
                    return (
                      <span key={day} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${locked ? 'bg-gray-100 text-gray-700' : 'bg-indigo-50 text-indigo-700'}`}>
                        {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}{formatDate(day)}
                        {locked
                          ? (isAdmin && <button onClick={() => unlockDate(day, oid)} className="ml-1 text-amber-600 hover:underline">Unlock</button>)
                          : <button onClick={() => lockDate(day, oid)} className="ml-1 text-indigo-600 hover:underline">Lock</button>}
                      </span>
                    )
                  })}
                  {!isAdmin && [...dayMap.keys()].some((d) => lockedDays.has(d)) && <span className="text-[11px] text-gray-400">Locked days can only be unlocked by a super user (Admin).</span>}
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between text-sm">
                  <span className="font-semibold text-gray-800">{shown.length} uploaded rows</span>
                  <span className="text-gray-500">Total: <strong>{fmtTarget(total, unit)}</strong></span>
                </div>
                {loading ? (
                  <p className="px-4 py-10 text-center text-gray-400">Loading…</p>
                ) : shown.length === 0 ? (
                  <p className="px-4 py-10 text-center text-gray-400">No uploads in this window. Use <strong>Upload Sales</strong> to add them.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0">
                        <tr><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Outlet</th><th className="px-4 py-2 text-left">Staff</th><th className="px-4 py-2 text-right">{uploadDept === 'SHISHA' ? 'Qty' : 'Amount'}</th><th className="px-4 py-2"></th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {shown.map((r) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatDate(r.date)}</td>
                            <td className="px-4 py-2 text-gray-500">{r.outlet?.name || '—'}</td>
                            <td className="px-4 py-2 font-medium text-gray-800">{r.staffName}</td>
                            <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmtTarget(r.value, unit)}</td>
                            <td className="px-4 py-2 text-right">
                              {isLocked(r)
                                ? <Lock className="w-4 h-4 text-gray-400 inline" />
                                : <button onClick={() => deleteRow(r.id)} title="Delete" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400">To fix a mistake: delete the wrong rows here, then re-upload the corrected file via <strong>Upload Sales</strong>.</p>
            </div>
          )
        })()}
      </div>
    </AppShell>
  )
}

function statusOf(actual: number, levels: { rewardFrom: number; letterBelow: number }) {
  if (actual >= levels.rewardFrom) return { tone: 'green' as const, label: 'Reward', bar: 'bg-green-500' }
  if (actual < levels.letterBelow) return { tone: 'red' as const, label: 'Letter', bar: 'bg-red-500' }
  return { tone: 'amber' as const, label: 'On track', bar: 'bg-amber-500' }
}

function ProgressCard({ t, actual, levels }: { t: TargetDef; actual: number; levels: { target: number; rewardFrom: number; letterBelow: number } }) {
  const pct = levels.target > 0 ? Math.min(100, Math.round((actual / levels.target) * 100)) : 0
  const st = statusOf(actual, levels)
  const ScopeIcon = scopeIcon(t.scope)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700"><ScopeIcon className="w-4 h-4" /> {t.department} · {t.scope}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-xl font-bold text-gray-900">{fmtTarget(actual, t.unit)}</p>
        <p className="text-xs text-gray-400">of {fmtTarget(levels.target, t.unit)} · {pct}%</p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className={`h-full ${st.bar}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function StaffTable({ t, levels, rows }: { t: TargetDef; levels: { target: number; rewardFrom: number; letterBelow: number }; rows: { name: string; actual: number; prev: number; rank: number }[] }) {
  const DeptIcon = deptIcon(t.department)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-gray-800 text-sm"><DeptIcon className="w-4 h-4 text-gray-400" /> {t.department} — per staff</span>
        <span className="text-xs text-gray-400">Target {fmtTarget(levels.target, t.unit)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-400">No staff activity in this window.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-2 text-left w-10">#</th><th className="px-4 py-2 text-left">Staff</th><th className="px-4 py-2 text-right">Actual</th><th className="px-4 py-2 text-right">vs last</th><th className="px-4 py-2 text-right w-28">%</th><th className="px-4 py-2 text-right">Status</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r, i) => {
              const pct = levels.target > 0 ? Math.round((r.actual / levels.target) * 100) : 0
              const st = statusOf(r.actual, levels)
              const delta = r.actual - r.prev
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400 font-semibold">{r.rank}</td>
                  <td className="px-4 py-2 font-medium text-gray-800">{r.name}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{fmtTarget(r.actual, t.unit)}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    {r.prev === 0 && delta === 0
                      ? <span className="text-gray-300">—</span>
                      : <span className={delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} {fmtTarget(Math.abs(delta), t.unit)}</span>}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="h-1.5 w-14 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${st.bar}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
                      <span className="text-xs text-gray-500 w-9 text-right">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right"><Badge tone={st.tone}>{st.label}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function TargetCard({ t, period, daysInMonth }: { t: TargetDef; period: 'weekly' | 'monthly'; daysInMonth: number }) {
  const { target, letterBelow, rewardFrom } = targetLevels(t, period, daysInMonth)
  const DeptIcon = deptIcon(t.department)
  const ScopeIcon = scopeIcon(t.scope)
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <Badge tone={t.department === 'Shisha Sales' ? 'purple' : t.department === 'Food Sales' ? 'amber' : 'indigo'}>{t.department}</Badge>
          <div className="flex items-center gap-1.5 mt-1.5 text-gray-600 text-xs font-medium"><ScopeIcon className="w-3.5 h-3.5" /> {t.scope}</div>
        </div>
        <span className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0"><DeptIcon className="w-4 h-4" /></span>
      </div>
      <p className="text-[11px] text-gray-400">{period === 'weekly' ? 'Weekly' : 'Monthly'} target</p>
      <p className="text-xl font-bold text-indigo-700 tracking-tight leading-tight">{fmtTarget(target, t.unit)}</p>
      <div className="mt-2.5 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="text-green-700">🎯 Reward ≥</span><span className="font-semibold text-green-700">{fmtTarget(rewardFrom, t.unit)}</span></div>
        <div className="flex items-center justify-between gap-2"><span className="text-red-600">⚠️ Letter &lt;</span><span className="font-semibold text-red-600">{fmtTarget(letterBelow, t.unit)}</span></div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-1 text-[11px]"><span className="text-gray-500">Reward</span><span className="text-gray-400 italic">Set by management</span></div>
      </div>
    </div>
  )
}
