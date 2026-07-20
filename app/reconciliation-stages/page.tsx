'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatDate, formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import toast from 'react-hot-toast'

interface CheckResult { checkType: string; status: string; detail: unknown }
interface AuditLog { id: string; action: string; reason?: string; userName?: string; approvedByName?: string; createdAt: string }
interface Stage {
  id: string
  outlet: { id: string; name: string } | null
  date: string
  stageKey: string
  status: string
  openedAt?: string
  closedAt?: string
  closedByName?: string
  result?: string
  resultDetail?: unknown
  escalatedAt?: string
  checkResults: CheckResult[]
  auditLogs?: AuditLog[]
}
interface Outlet { id: string; name: string }
interface ExceptionRow {
  id: string
  outletId: string | null
  date: string
  stageKey: string
  status: string
  escalatedAt: string
  escalatedToRoles: string[] | null
  failingChecks: CheckResult[]
}
interface UnlockRequestRow {
  id: string
  reason: string
  requestedByName: string
  createdAt: string
  stage: { id: string; date: string; stageKey: string; outlet: { id: string; name: string } | null }
}

const STAGE_KEYS = ['BUSINESS_DAY', 'CASHIER_RECON', 'FINANCE_RECON', 'FINANCIAL_CLOSE', 'ARCHIVED']
const STAGE_LABEL: Record<string, string> = {
  BUSINESS_DAY: 'Business Day', CASHIER_RECON: 'Cashier Reconciliation', FINANCE_RECON: 'Finance Reconciliation',
  FINANCIAL_CLOSE: 'Financial Close', ARCHIVED: 'Archived',
}
const STATUSES = ['PENDING', 'OPEN', 'INCOMPLETE', 'CLOSED', 'REOPENED', 'SKIPPED', 'ARCHIVED']

export default function ReconciliationStagesPage() {
  const { request } = useApi()
  const [stages, setStages] = useState<Stage[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [stageKey, setStageKey] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reopenTarget, setReopenTarget] = useState<Stage | null>(null)
  const [reopenReason, setReopenReason] = useState('')
  const [requestUnlockTarget, setRequestUnlockTarget] = useState<Stage | null>(null)
  const [requestUnlockReason, setRequestUnlockReason] = useState('')
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [unlockRequests, setUnlockRequests] = useState<UnlockRequestRow[]>([])
  const [decidingRequestId, setDecidingRequestId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      if (stageKey) qs.set('stageKey', stageKey)
      if (status) qs.set('status', status)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const r = await request(`/api/reconciliation-stages?${qs}`)
      setStages(r.stages || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, outletId, stageKey, status, from, to])

  const loadExceptions = useCallback(async () => {
    try {
      const r = await request('/api/reconciliation-stages/exceptions')
      setExceptions(r.exceptions || [])
    } catch { /* not authorized or none — fail quiet, this is a supplementary panel */ }
  }, [request])

  const loadUnlockRequests = useCallback(async () => {
    try {
      const r = await request('/api/reconciliation-stage-unlock-requests?status=PENDING')
      setUnlockRequests(r.requests || [])
    } catch { /* not authorized — fail quiet, this queue is approver-only */ }
  }, [request])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await request(`/api/reconciliation-stages/${id}`)
      setStages((prev) => prev.map((s) => (s.id === id ? { ...s, auditLogs: r.auditLogs } : s)))
    } catch { /* ignore */ }
  }, [request])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])
  useEffect(() => { loadExceptions() }, [loadExceptions])
  useEffect(() => { loadUnlockRequests() }, [loadUnlockRequests])
  useEffect(() => { if (expanded) loadDetail(expanded) }, [expanded, loadDetail])

  const toggle = (s: Stage) => setExpanded((e) => (e === s.id ? null : s.id))

  const close = async (s: Stage, allowIncomplete = false) => {
    setBusy(true)
    try {
      await request(`/api/reconciliation-stages/${s.id}/close`, { method: 'POST', body: JSON.stringify({ allowIncomplete }) })
      toast.success('Stage closed')
      await load()
      if (expanded === s.id) loadDetail(s.id)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not close stage')
    } finally { setBusy(false) }
  }

  const submitReopen = async () => {
    if (!reopenTarget || !reopenReason.trim()) return toast.error('A reason is required')
    setBusy(true)
    try {
      await request(`/api/reconciliation-stages/${reopenTarget.id}/reopen`, { method: 'POST', body: JSON.stringify({ reason: reopenReason }) })
      toast.success('Stage reopened')
      const targetId = reopenTarget.id
      setReopenTarget(null); setReopenReason('')
      await load()
      if (expanded === targetId) loadDetail(targetId)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen stage')
    } finally { setBusy(false) }
  }

  const submitRequestUnlock = async () => {
    if (!requestUnlockTarget || !requestUnlockReason.trim()) return toast.error('A reason is required')
    setBusy(true)
    try {
      await request(`/api/reconciliation-stages/${requestUnlockTarget.id}/unlock-request`, { method: 'POST', body: JSON.stringify({ reason: requestUnlockReason }) })
      toast.success('Unlock requested — awaiting approval')
      setRequestUnlockTarget(null); setRequestUnlockReason('')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not request unlock')
    } finally { setBusy(false) }
  }

  const decideUnlockRequest = async (id: string, approve: boolean) => {
    setDecidingRequestId(id)
    try {
      await request(`/api/reconciliation-stage-unlock-requests/${id}/resolve`, { method: 'POST', body: JSON.stringify({ approve }) })
      toast.success(approve ? 'Unlock approved' : 'Unlock rejected')
      await Promise.all([loadUnlockRequests(), load()])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not resolve request')
    } finally { setDecidingRequestId(null) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation Stages</h1>
          <p className="text-gray-500 text-sm">Business Day → Cashier Reconciliation → Finance Reconciliation → Financial Close → Archived, per outlet/date</p>
        </div>

        {unlockRequests.length > 0 && (
          <Card className="border-amber-200 bg-amber-50/40">
            <p className="text-sm font-semibold text-amber-800 mb-2">Pending Unlock Requests ({unlockRequests.length})</p>
            <div className="divide-y divide-amber-100">
              {unlockRequests.map((r) => (
                <div key={r.id} className="py-2 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm text-gray-800">
                      <span className="font-medium">{STAGE_LABEL[r.stage.stageKey]}</span> · {r.stage.outlet ? r.stage.outlet.name : 'Company-wide'} · {formatDate(r.stage.date)}
                    </p>
                    <p className="text-xs text-gray-500">{r.requestedByName} — {r.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <button disabled={decidingRequestId === r.id} onClick={() => decideUnlockRequest(r.id, true)}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">Approve</button>
                    <button disabled={decidingRequestId === r.id} onClick={() => decideUnlockRequest(r.id, false)}
                      className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {exceptions.length > 0 && (
          <Card className="border-red-200 bg-red-50/40">
            <p className="text-sm font-semibold text-red-800 mb-2">Exception Report — escalated and unresolved ({exceptions.length})</p>
            <div className="divide-y divide-red-100">
              {exceptions.map((e) => (
                <div key={e.id} className="py-2">
                  <p className="text-sm text-gray-800">
                    <span className="font-medium">{STAGE_LABEL[e.stageKey]}</span> · {formatDate(e.date)} · escalated {formatDateTime(e.escalatedAt)}
                    {e.escalatedToRoles && <span className="text-gray-500"> → {e.escalatedToRoles.join(', ')}</span>}
                  </p>
                  {e.failingChecks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {e.failingChecks.map((c, i) => (
                        <span key={i} className="px-2 py-0.5 bg-red-100 text-red-700 text-[11px] rounded-full">{c.checkType.replace('_', ' ')} · {c.status}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-wrap gap-2 items-center">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={stageKey} onChange={(e) => setStageKey(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All stages</option>
            {STAGE_KEYS.map((k) => <option key={k} value={k}>{STAGE_LABEL[k]}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : stages.length === 0 ? (
            <EmptyState icon="🧾" title="No reconciliation stages found" hint="Stages are created the first time a Business Day, Cashier Recon, or Finance Recon window opens for a date." />
          ) : (
            <div className="divide-y divide-gray-50">
              {stages.map((s) => (
                <div key={s.id}>
                  <div className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(s)}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium text-gray-800">{formatDate(s.date)}</span>
                      <span className="text-gray-500 text-sm">{s.outlet ? s.outlet.name : 'Company-wide'}</span>
                      <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-semibold rounded-full">{STAGE_LABEL[s.stageKey]}</span>
                      <Badge status={s.status}>{s.status}</Badge>
                      {s.escalatedAt && <span className="text-xs text-red-600">escalated {formatDateTime(s.escalatedAt)}</span>}
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {(s.status === 'OPEN' || s.status === 'INCOMPLETE' || s.status === 'REOPENED') && (
                        <button disabled={busy} onClick={() => close(s)} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">Close</button>
                      )}
                      {s.status === 'INCOMPLETE' && (
                        <button disabled={busy} onClick={() => close(s, true)} className="px-3 py-1.5 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40">Close Anyway</button>
                      )}
                      {s.status === 'CLOSED' && (
                        <>
                          <button disabled={busy} onClick={() => setReopenTarget(s)} className="px-3 py-1.5 text-xs font-semibold bg-gray-800 text-white rounded-lg hover:bg-black disabled:opacity-40">Reopen</button>
                          <button disabled={busy} onClick={() => setRequestUnlockTarget(s)} className="px-3 py-1.5 text-xs font-semibold bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-40">Request Unlock</button>
                        </>
                      )}
                    </div>
                  </div>
                  {expanded === s.id && (
                    <div className="px-4 pb-4 bg-gray-50/60">
                      {s.checkResults.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {s.checkResults.map((c, i) => (
                            <span key={i} className={`px-2 py-0.5 text-[11px] rounded-full ${c.status === 'COMPLETE' ? 'bg-emerald-50 text-emerald-700' : c.status === 'SKIPPED' ? 'bg-gray-100 text-gray-500' : 'bg-red-50 text-red-700'}`}>
                              {c.checkType.replace('_', ' ')} · {c.status}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-xs font-semibold text-gray-600 mb-1">Audit History</p>
                      <div className="space-y-1">
                        {(s.auditLogs || []).length === 0 ? (
                          <p className="text-xs text-gray-400">No audit entries yet.</p>
                        ) : s.auditLogs!.map((a) => (
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

      <Modal open={!!reopenTarget} onClose={() => setReopenTarget(null)} title="Reopen Stage">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
          </div>
          <button disabled={busy} onClick={submitReopen} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Reopening…' : 'Reopen Stage'}
          </button>
        </div>
      </Modal>

      <Modal open={!!requestUnlockTarget} onClose={() => setRequestUnlockTarget(null)} title="Request Unlock">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Sends a request to an approver rather than reopening directly — use this if you don&apos;t have direct reopen access.</p>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <textarea value={requestUnlockReason} onChange={(e) => setRequestUnlockReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
          </div>
          <button disabled={busy} onClick={submitRequestUnlock} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}
