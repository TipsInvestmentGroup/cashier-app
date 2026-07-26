'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { targetLevels, fmtTarget, targetDeptKey, TARGET_SCOPES, type TargetDef } from '@/lib/targets'
import { formatDate } from '@/lib/utils'
import { generateWarningLetters, type FlaggedItem } from '@/lib/warning-letter-pdf'
import { generateRewardLetters } from '@/lib/reward-letter-pdf'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns'
import { Wallet, Cigarette, UtensilsCrossed, Building2, User, Crown, Trash2, Lock, Unlock } from 'lucide-react'
import toast from 'react-hot-toast'

function deptIconEl(d: string, className: string) {
  const k = targetDeptKey(d)
  return k === 'shisha' ? <Cigarette className={className} /> : k === 'food' ? <UtensilsCrossed className={className} /> : <Wallet className={className} />
}
function scopeIconEl(s: string, className: string) {
  return s === 'Per Outlet' ? <Building2 className={className} /> : s === 'Per Manager' ? <Crown className={className} /> : <User className={className} />
}
const deptKey = targetDeptKey

interface OutletRow { id: string; name: string }
interface StaffRow { staffName: string; collection: number; shisha: number; food: number }
interface Perf { outlets: OutletRow[]; byOutlet: Record<string, { collection: number; shisha: number; food: number }>; byStaff: Record<string, StaffRow[]> }

interface UploadRow { id: string; date: string; staffName: string; value: number; outletId?: string; outlet?: { name: string } }
interface LbMetric { department: string; unit: string; unitLabel?: string; actual: number; target: number; pct: number }
interface LbRow { rank: number; staff: string; outlet: string; overallPct: number; status: 'reward' | 'ontrack' | 'letter'; metrics: LbMetric[] }

export default function TargetsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()
  const isAdmin = user?.role === 'ADMIN'
  const now = new Date()
  const [view, setView] = useState<'targets' | 'performance' | 'leaderboard' | 'uploads'>('targets')
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly')
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [outlet, setOutlet] = useState<string>('All')
  const [targets, setTargets] = useState<TargetDef[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const [perf, setPerf] = useState<Perf | null>(null)
  const [perfPrev, setPerfPrev] = useState<Perf | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadDept, setUploadDept] = useState<'SHISHA' | 'FOOD'>('SHISHA')
  const [uploads, setUploads] = useState<UploadRow[]>([])
  const [lockedDays, setLockedDays] = useState<Set<string>>(new Set())
  const [leaderboard, setLeaderboard] = useState<LbRow[]>([])

  const [my, mm] = month.split('-').map(Number)
  const daysInMonth = new Date(my, mm, 0).getDate()
  const win = period === 'weekly'
    ? { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    : { from: startOfMonth(new Date(my, mm - 1, 1)), to: endOfMonth(new Date(my, mm - 1, 1)) }
  const prevWin = period === 'weekly'
    ? { from: startOfWeek(subWeeks(win.from, 1), { weekStartsOn: 1 }), to: endOfWeek(subWeeks(win.from, 1), { weekStartsOn: 1 }) }
    : { from: startOfMonth(subMonths(win.from, 1)), to: endOfMonth(subMonths(win.from, 1)) }

  const loadTargets = useCallback(async () => {
    try { setTargets(await request('/api/targets') || []) } catch { /* view renders empty */ }
  }, [request])
  useEffect(() => { loadTargets() }, [loadTargets])

  // Outlet filter chips — derived from the configured targets, not hardcoded.
  const outletNames = [...new Set(targets.map((t) => t.outletName))]
  const OUTLETS = ['All', ...outletNames]

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

  const loadLeaderboard = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from: format(win.from, 'yyyy-MM-dd'), to: format(win.to, 'yyyy-MM-dd'), period, days: String(daysInMonth) })
      const r = await request(`/api/targets/leaderboard?${qs}`)
      setLeaderboard(r.rows || [])
    } finally { setLoading(false) }
  }, [request, period, month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (view === 'leaderboard') loadLeaderboard() }, [view, loadLeaderboard])

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

  const groups = outletNames.filter((o) => outlet === 'All' || o === outlet)
  const dbOutlet = (g: string) => perf?.outlets.find((o) => o.name === g)

  // Build the performance model once (drives summary, CSV and the tables).
  const model = (view === 'performance' && perf) ? groups.map((g) => {
    const o = dbOutlet(g)
    const totals = (o && perf.byOutlet[o.id]) || { collection: 0, shisha: 0, food: 0 }
    const staff = (o && perf.byStaff[o.id]) || []
    const prevStaff = (o && perfPrev?.byStaff[o.id]) || []
    const items = targets.filter((t) => t.outletName === g)
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
    else if (lab === 'Letter') { flags.letter++; flaggedItems.push({ staff: r.name, outlet: m.g, department: st.t.department, unit: st.t.unit, unitLabel: st.t.unitLabel || undefined, actual: r.actual, target: st.lv.target, threshold: st.lv.letterBelow }) }
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
            {isAdmin && (
              <button onClick={() => setManageOpen(true)}
                className="px-4 py-2.5 bg-white border-2 border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:border-gray-300 transition">
                ⚙️ Manage Targets
              </button>
            )}
          </div>
        </div>

        {/* View + outlet filters */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-2 bg-white border border-gray-200 rounded-xl p-1">
            {(['targets', 'performance', 'leaderboard', 'uploads'] as const).map((v) => (
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
          const items = targets.filter((t) => t.outletName === g)
          return (
            <div key={g}>
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400 mb-3">{g}</h2>
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
                <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">{m.g}</h2>
                {!m.o && <p className="text-sm text-gray-400">No matching outlet found.</p>}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {m.outletTargets.map((x, i) => <ProgressCard key={i} t={x.t} actual={x.actual} levels={x.lv} />)}
                </div>
                {m.staffTargets.map((x, i) => <StaffTable key={i} t={x.t} levels={x.lv} rows={x.rows} />)}
              </div>
            ))}
          </>
        ))}

        {view === 'leaderboard' && (() => {
          const shown = leaderboard.filter((r) => outlet === 'All' || r.outlet === outlet)
          const pctOf = (r: LbRow, dept: string) => r.metrics.find((m) => m.department === dept)?.pct
          const eligible = shown.filter((r) => r.status === 'reward')
          const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`)
          const rewardItems = eligible.map((r) => {
            const ach = r.metrics.filter((m) => m.pct >= 80)
            return { staff: r.staff, outlet: r.outlet, achievements: (ach.length ? ach : r.metrics) }
          })
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold bg-green-50 text-green-700">🏆 {eligible.length} reward-eligible</span>
                {eligible.length > 0 && (
                  <Button variant="success" size="sm" onClick={() => generateRewardLetters(rewardItems, period === 'weekly' ? `${format(win.from, 'dd MMM')} – ${format(win.to, 'dd MMM yyyy')}` : format(win.from, 'MMMM yyyy'))}>🏆 Reward letters ({eligible.length})</Button>
                )}
              </div>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {loading ? <p className="px-4 py-10 text-center text-gray-400">Loading…</p> : shown.length === 0 ? (
                  <EmptyState icon="🏆" title="No staff activity in this window" hint="Record collections and upload shisha/food sales to rank staff." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                        <tr><th className="px-3 py-2 text-left w-12">#</th><th className="px-3 py-2 text-left">Staff</th><th className="px-3 py-2 text-left">Outlet</th><th className="px-3 py-2 text-right">Collection</th><th className="px-3 py-2 text-right">Shisha</th><th className="px-3 py-2 text-right">Food</th><th className="px-3 py-2 text-right">Overall</th><th className="px-3 py-2 text-right">Status</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {shown.map((r) => {
                          const col = pctOf(r, 'Total Collection'); const sh = pctOf(r, 'Shisha Sales'); const fd = pctOf(r, 'Food Sales')
                          const cell = (v?: number) => v == null ? <span className="text-gray-300">—</span> : <span className={v >= 80 ? 'text-green-700 font-semibold' : v < 34 ? 'text-red-600 font-semibold' : 'text-gray-700'}>{v}%</span>
                          return (
                            <tr key={r.rank} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-bold text-gray-500">{medal(r.rank)}</td>
                              <td className="px-3 py-2 font-medium text-gray-800">{r.staff}</td>
                              <td className="px-3 py-2 text-gray-500">{r.outlet}</td>
                              <td className="px-3 py-2 text-right">{cell(col)}</td>
                              <td className="px-3 py-2 text-right">{cell(sh)}</td>
                              <td className="px-3 py-2 text-right">{cell(fd)}</td>
                              <td className="px-3 py-2 text-right font-bold text-gray-900">{r.overallPct}%</td>
                              <td className="px-3 py-2 text-right"><Badge tone={r.status === 'reward' ? 'green' : r.status === 'letter' ? 'red' : 'amber'}>{r.status === 'reward' ? 'Reward' : r.status === 'letter' ? 'Letter' : 'On track'}</Badge></td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400">Overall = average of each staff&apos;s applicable target achievements. Reward-eligible at ≥ 80% overall.</p>
            </div>
          )
        })()}

        {view === 'uploads' && (() => {
          const unit = uploadDept === 'SHISHA' ? 'COUNT' as const : 'TZS' as const
          const shown = uploads.filter((r) => outlet === 'All' || r.outlet?.name === outlet)
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

      {isAdmin && manageOpen && (
        <ManageTargetsModal request={request} onClose={() => setManageOpen(false)} onChanged={loadTargets} />
      )}
    </AppShell>
  )
}

interface ManagedTarget extends TargetDef { isActive: boolean }

/** Admin CRUD for SalesTarget rows — what used to require a code edit. */
function ManageTargetsModal({ request, onClose, onChanged }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (url: string, opts?: any) => Promise<any>
  onClose: () => void
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<ManagedTarget[]>([])
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ outletId: '', scope: 'Per Staff', department: '', unit: 'TZS' as 'TZS' | 'COUNT', unitLabel: '', weeklyTarget: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ts, os] = await Promise.all([request('/api/targets?all=1'), request('/api/outlets')])
      setRows(ts || [])
      setOutlets((os || []).filter((o: { isActive?: boolean }) => o.isActive !== false))
    } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const saveWeekly = async (t: ManagedTarget) => {
    const raw = edits[t.id]
    if (raw === undefined || Number(raw) === t.weeklyTarget) return
    const weekly = Number(raw)
    if (!Number.isFinite(weekly) || weekly <= 0) return toast.error('Weekly target must be > 0')
    setBusy(true)
    try {
      await request(`/api/targets/${t.id}`, { method: 'PUT', body: JSON.stringify({ weeklyTarget: weekly }) })
      toast.success('Target updated'); load(); onChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save') } finally { setBusy(false) }
  }

  const toggleActive = async (t: ManagedTarget) => {
    setBusy(true)
    try {
      await request(`/api/targets/${t.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !t.isActive }) })
      load(); onChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not update') } finally { setBusy(false) }
  }

  const remove = async (t: ManagedTarget) => {
    if (!(await confirm({ title: 'Delete target', message: `Delete "${t.department} · ${t.scope}" for ${t.outletName}?`, danger: true, confirmLabel: 'Delete' }))) return
    setBusy(true)
    try {
      await request(`/api/targets/${t.id}`, { method: 'DELETE' })
      toast.success('Target deleted'); load(); onChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') } finally { setBusy(false) }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.outletId) return toast.error('Select an outlet')
    if (!form.department.trim()) return toast.error('Department is required')
    const weekly = Number(form.weeklyTarget)
    if (!Number.isFinite(weekly) || weekly <= 0) return toast.error('Weekly target must be > 0')
    setBusy(true)
    try {
      await request('/api/targets', { method: 'POST', body: JSON.stringify({ ...form, weeklyTarget: weekly }) })
      toast.success('Target added')
      setForm((f) => ({ ...f, department: '', unitLabel: '', weeklyTarget: '' }))
      load(); onChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add') } finally { setBusy(false) }
  }

  const selCls = 'px-2.5 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-bold text-gray-900">⚙️ Manage Sales Targets</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>
        <div className="p-4 space-y-4">
          <form onSubmit={add} className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
            <select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })} className={`${selCls} col-span-2 sm:col-span-1`}>
              <option value="">Outlet…</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} className={selCls}>
              {TARGET_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Department"
              className={`${selCls} col-span-2 sm:col-span-1`} />
            <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as 'TZS' | 'COUNT' })} className={selCls}>
              <option value="TZS">Amount</option>
              <option value="COUNT">Count</option>
            </select>
            {form.unit === 'COUNT'
              ? <input value={form.unitLabel} onChange={(e) => setForm({ ...form, unitLabel: e.target.value })} placeholder="Unit (e.g. shisha)" className={selCls} />
              : <span className="hidden sm:block" />}
            <div className="flex gap-2 col-span-2 sm:col-span-1">
              <input value={form.weeklyTarget} onChange={(e) => setForm({ ...form, weeklyTarget: e.target.value })} placeholder="Weekly" inputMode="numeric"
                className={`${selCls} flex-1 min-w-0`} />
              <button type="submit" disabled={busy} className="px-3 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">Add</button>
            </div>
          </form>

          {loading ? (
            <p className="py-8 text-center text-gray-400 text-sm">Loading…</p>
          ) : (
            <div className="overflow-x-auto border border-gray-100 rounded-xl">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2 text-left">Outlet</th>
                    <th className="px-3 py-2 text-left">Scope</th>
                    <th className="px-3 py-2 text-left">Department</th>
                    <th className="px-3 py-2 text-right">Weekly Target</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((t) => (
                    <tr key={t.id} className={t.isActive ? 'hover:bg-gray-50' : 'opacity-50 hover:bg-gray-50'}>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{t.outletName}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{t.scope}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{t.department}{t.unit === 'COUNT' ? <span className="text-gray-400 font-normal"> ({t.unitLabel || 'count'})</span> : ''}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          value={edits[t.id] ?? String(t.weeklyTarget)}
                          onChange={(e) => setEdits({ ...edits, [t.id]: e.target.value })}
                          onBlur={() => saveWeekly(t)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          inputMode="numeric"
                          className="w-32 px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm text-right focus:border-indigo-500 focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button onClick={() => toggleActive(t)} disabled={busy}
                          className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100 mr-1">
                          {t.isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button onClick={() => remove(t)} disabled={busy}
                          className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No targets yet — add one above.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">Weekly figures drive everything: daily = weekly ÷ 7, monthly = daily × days in month, letter &lt; ⅓, reward ≥ 80%. Edit a weekly figure and press Enter to save.</p>
        </div>
      </div>
    </div>
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
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">{scopeIconEl(t.scope, 'w-4 h-4')} {t.department} · {t.scope}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="flex items-end justify-between">
        <p className="text-xl font-bold text-gray-900">{fmtTarget(actual, t.unit, t.unitLabel)}</p>
        <p className="text-xs text-gray-400">of {fmtTarget(levels.target, t.unit, t.unitLabel)} · {pct}%</p>
      </div>
      <div className="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div className={`h-full ${st.bar}`} style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

function StaffTable({ t, levels, rows }: { t: TargetDef; levels: { target: number; rewardFrom: number; letterBelow: number }; rows: { name: string; actual: number; prev: number; rank: number }[] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-gray-800 text-sm">{deptIconEl(t.department, 'w-4 h-4 text-gray-400')} {t.department} — per staff</span>
        <span className="text-xs text-gray-400">Target {fmtTarget(levels.target, t.unit, t.unitLabel)}</span>
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
                  <td className="px-4 py-2 text-right text-gray-700">{fmtTarget(r.actual, t.unit, t.unitLabel)}</td>
                  <td className="px-4 py-2 text-right text-xs">
                    {r.prev === 0 && delta === 0
                      ? <span className="text-gray-300">—</span>
                      : <span className={delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '–'} {fmtTarget(Math.abs(delta), t.unit, t.unitLabel)}</span>}
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
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <Badge tone={t.department === 'Shisha Sales' ? 'purple' : t.department === 'Food Sales' ? 'amber' : 'indigo'}>{t.department}</Badge>
          <div className="flex items-center gap-1.5 mt-1.5 text-gray-600 text-xs font-medium">{scopeIconEl(t.scope, 'w-3.5 h-3.5')} {t.scope}</div>
        </div>
        <span className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 flex items-center justify-center flex-shrink-0">{deptIconEl(t.department, 'w-4 h-4')}</span>
      </div>
      <p className="text-[11px] text-gray-400">{period === 'weekly' ? 'Weekly' : 'Monthly'} target</p>
      <p className="text-xl font-bold text-indigo-700 tracking-tight leading-tight">{fmtTarget(target, t.unit, t.unitLabel)}</p>
      <div className="mt-2.5 space-y-1 text-xs">
        <div className="flex items-center justify-between gap-2"><span className="text-green-700">🎯 Reward ≥</span><span className="font-semibold text-green-700">{fmtTarget(rewardFrom, t.unit, t.unitLabel)}</span></div>
        <div className="flex items-center justify-between gap-2"><span className="text-red-600">⚠️ Letter &lt;</span><span className="font-semibold text-red-600">{fmtTarget(letterBelow, t.unit, t.unitLabel)}</span></div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-1 text-[11px]"><span className="text-gray-500">Reward</span><span className="text-gray-400 italic">Set by management</span></div>
      </div>
    </div>
  )
}
