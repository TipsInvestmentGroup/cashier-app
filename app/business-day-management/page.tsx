'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate, formatDateTime } from '@/lib/utils'
import { BusinessDayRoleAccessPanel } from '@/components/BusinessDayRoleAccessPanel'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { notifyNotificationsChanged } from '@/lib/pendingBellEvents'
import toast from 'react-hot-toast'

interface AuditLog { id: string; action: string; reason?: string; userName?: string; approvedByName?: string; createdAt: string }
interface BusinessDay {
  id: string; date: string; status: string; isComplete: boolean
  missingItems: { label: string }[]
  outlet: { id: string; name: string }
  closedByName?: string; reopenedByName?: string; reopenReason?: string; lockExpiresAt?: string
  auditLogs?: AuditLog[]
}
interface Outlet { id: string; name: string }

const DURATIONS = [
  { value: '15m', label: '15 minutes' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: 'CUSTOM', label: 'Custom' },
]

function BusinessDayManagementInner() {
  const { request } = useApi()
  const { user } = useAuth()
  const isOwner = (user?.email || '').toLowerCase() === (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const searchParams = useSearchParams()
  const focusId = searchParams.get('id')
  const [days, setDays] = useState<BusinessDay[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(focusId)
  const [unlockTarget, setUnlockTarget] = useState<BusinessDay | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockDuration, setUnlockDuration] = useState('30m')
  const [unlockCustomMinutes, setUnlockCustomMinutes] = useState(60)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      const r = await request(`/api/business-days?${qs}`)
      setDays(r.businessDays || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, outletId])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await request(`/api/business-days/${id}`)
      setDays((prev) => prev.map((d) => (d.id === id ? { ...d, auditLogs: r.auditLogs } : d)))
    } catch { /* ignore */ }
  }, [request])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (expanded) loadDetail(expanded) }, [expanded, loadDetail])

  const toggle = (d: BusinessDay) => setExpanded((e) => (e === d.id ? null : d.id))

  const close = async (d: BusinessDay, allowIncomplete = false) => {
    setBusy(true)
    try {
      await request(`/api/business-days/${d.id}/close`, { method: 'POST', body: JSON.stringify({ allowIncomplete }) })
      toast.success('Day closed')
      await load()
      if (expanded === d.id) loadDetail(d.id)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not close day')
    } finally { setBusy(false) }
  }

  const lockAgain = async (d: BusinessDay) => {
    setBusy(true)
    try {
      await request(`/api/business-days/${d.id}/lock`, { method: 'POST' })
      toast.success('Day locked')
      await load()
      if (expanded === d.id) loadDetail(d.id)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not lock day')
    } finally { setBusy(false) }
  }

  const submitUnlock = async () => {
    if (!unlockTarget || !unlockReason.trim()) return toast.error('A reason is required')
    setBusy(true)
    try {
      await request(`/api/business-days/${unlockTarget.id}/unlock`, {
        method: 'POST',
        body: JSON.stringify({ reason: unlockReason, durationMinutes: unlockDuration, customMinutes: unlockCustomMinutes }),
      })
      toast.success('Day unlocked')
      notifyNotificationsChanged()
      const targetId = unlockTarget.id
      setUnlockTarget(null); setUnlockReason(''); setUnlockDuration('30m')
      await load()
      if (expanded === targetId) loadDetail(targetId)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not unlock day')
    } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Day Management</h1>
          <p className="text-gray-500 text-sm">Close, unlock, and re-lock business days — with reason, scope, and duration control</p>
        </div>

        {isOwner && <BusinessDayRoleAccessPanel />}

        <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
          className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : days.length === 0 ? (
            <EmptyState icon="🔐" title="No business days found" />
          ) : (
            <div className="divide-y divide-gray-50">
              {days.map((d) => (
                <div key={d.id}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(d)}>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-800">{formatDate(d.date)}</span>
                      <span className="text-gray-500 text-sm">{d.outlet.name}</span>
                      <Badge status={d.isComplete ? d.status : 'PENDING'}>{d.isComplete ? d.status : `${d.status} · INCOMPLETE`}</Badge>
                      {d.lockExpiresAt && d.status === 'REOPENED' && (
                        <span className="text-xs text-amber-600">unlocked until {formatDateTime(d.lockExpiresAt)}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {(d.status === 'OPEN' || d.status === 'REOPENED') && (
                        <button disabled={busy} onClick={() => close(d)} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">Close</button>
                      )}
                      {!d.isComplete && d.status !== 'CLOSED' && (
                        <button disabled={busy} onClick={() => close(d, true)} className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40">Close Anyway</button>
                      )}
                      {d.status === 'CLOSED' && (
                        <button disabled={busy} onClick={() => setUnlockTarget(d)} className="px-3 py-1.5 text-xs font-semibold bg-gray-800 text-white rounded-lg hover:bg-black disabled:opacity-40">Unlock</button>
                      )}
                      {d.status === 'REOPENED' && (
                        <button disabled={busy} onClick={() => lockAgain(d)} className="px-3 py-1.5 text-xs font-semibold bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-40">Lock Again</button>
                      )}
                    </div>
                  </div>
                  {expanded === d.id && (
                    <div className="px-4 pb-4 bg-gray-50/60">
                      {d.missingItems.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {d.missingItems.map((m, i) => <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 text-[11px] rounded-full">{m.label}</span>)}
                        </div>
                      )}
                      {d.reopenReason && <p className="text-xs text-gray-500 mb-2">Reopen reason: {d.reopenReason} — by {d.reopenedByName}</p>}
                      <p className="text-xs font-semibold text-gray-600 mb-1">Audit History</p>
                      <div className="space-y-1">
                        {(d.auditLogs || []).length === 0 ? (
                          <p className="text-xs text-gray-400">No audit entries yet.</p>
                        ) : d.auditLogs!.map((a) => (
                          <div key={a.id} className="text-xs text-gray-500 flex gap-2">
                            <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span>
                            <Badge tone="indigo">{a.action}</Badge>
                            <span>{a.userName || a.approvedByName || ''}{a.reason ? ` — ${a.reason}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!unlockTarget} onClose={() => setUnlockTarget(null)} title="Unlock Business Day">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <textarea value={unlockReason} onChange={(e) => setUnlockReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Unlock Duration</label>
            <select value={unlockDuration} onChange={(e) => setUnlockDuration(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {unlockDuration === 'CUSTOM' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Custom Minutes</label>
              <input type="number" min={1} value={unlockCustomMinutes} onChange={(e) => setUnlockCustomMinutes(Number(e.target.value))}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
          <button disabled={busy} onClick={submitUnlock} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Unlocking…' : 'Unlock Day'}
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <BusinessDayManagementInner />
    </Suspense>
  )
}
