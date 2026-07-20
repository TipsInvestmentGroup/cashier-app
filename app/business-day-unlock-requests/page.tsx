'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate, formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { notifyNotificationsChanged } from '@/lib/pendingBellEvents'
import toast from 'react-hot-toast'

interface UnlockRequest {
  id: string; reason: string; status: string; requestedDuration?: string; createdAt: string
  approverComment?: string
  businessDay: { id: string; date: string; status: string; outlet: { id: string; name: string } }
  requestedBy: { name: string; role: string }
  approver?: { name: string }
}
interface Outlet { id: string; name: string }

const TABS = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']

export default function BusinessDayUnlockRequestsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [tab, setTab] = useState('PENDING')
  const [scope, setScope] = useState<'approve' | 'mine'>('approve')
  const [requests, setRequests] = useState<UnlockRequest[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [rejectTarget, setRejectTarget] = useState<UnlockRequest | null>(null)
  const [rejectComment, setRejectComment] = useState('')
  const [busy, setBusy] = useState(false)

  const [newOutletId, setNewOutletId] = useState('')
  const [newDate, setNewDate] = useState('')
  const [newReason, setNewReason] = useState('')
  const [newDuration, setNewDuration] = useState('30m')
  const [requestOpen, setRequestOpen] = useState(false)

  const isMgmt = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'].includes(user?.role || '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ status: tab })
      if (scope === 'mine') qs.set('requestedById', user?.id || '')
      const r = await request(`/api/business-day-unlock-requests?${qs}`)
      setRequests(r.requests || [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [request, tab, scope, user])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])

  const approve = async (r: UnlockRequest) => {
    setBusy(true)
    try {
      await request(`/api/business-day-unlock-requests/${r.id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      toast.success('Approved')
      notifyNotificationsChanged()
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not approve')
    } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!rejectTarget) return
    setBusy(true)
    try {
      await request(`/api/business-day-unlock-requests/${rejectTarget.id}/reject`, { method: 'POST', body: JSON.stringify({ comment: rejectComment }) })
      toast.success('Rejected')
      notifyNotificationsChanged()
      setRejectTarget(null); setRejectComment('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reject')
    } finally { setBusy(false) }
  }

  const complete = async (r: UnlockRequest) => {
    setBusy(true)
    try {
      await request(`/api/business-day-unlock-requests/${r.id}/complete`, { method: 'POST', body: JSON.stringify({}) })
      toast.success('Marked complete — day re-closed')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not complete — check for remaining missing data')
    } finally { setBusy(false) }
  }

  const submitRequest = async () => {
    if (!newOutletId || !newDate || !newReason.trim()) return toast.error('Outlet, date and reason are required')
    setBusy(true)
    try {
      await request('/api/business-day-unlock-requests', {
        method: 'POST',
        body: JSON.stringify({ outletId: newOutletId, date: newDate, reason: newReason, requestedDuration: newDuration }),
      })
      toast.success('Unlock requested')
      setRequestOpen(false); setNewOutletId(''); setNewDate(''); setNewReason(''); setNewDuration('30m')
      setScope('mine'); setTab('PENDING')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not submit request')
    } finally { setBusy(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Unlock Requests</h1>
            <p className="text-gray-500 text-sm">Request → Approval → Reopen → Submit → Auto-Lock</p>
          </div>
          <button onClick={() => setRequestOpen(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">
            + Request Unlock
          </button>
        </div>

        {isMgmt && (
          <div className="flex gap-2">
            <button onClick={() => setScope('approve')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${scope === 'approve' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Approver Queue</button>
            <button onClick={() => setScope('mine')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${scope === 'mine' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>My Requests</button>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === t ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>{t}</button>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : requests.length === 0 ? (
            <EmptyState icon="🔓" title="No requests here" />
          ) : (
            <div className="divide-y divide-gray-50">
              {requests.map((r) => (
                <div key={r.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-800">{formatDate(r.businessDay.date)}</span>
                      <span className="text-sm text-gray-500">{r.businessDay.outlet.name}</span>
                      <Badge status={r.status}>{r.status}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{r.reason}</p>
                    <p className="text-xs text-gray-400">Requested by {r.requestedBy.name} ({r.requestedBy.role}) · {formatDateTime(r.createdAt)}{r.approver ? ` · decided by ${r.approver.name}` : ''}</p>
                    {r.approverComment && <p className="text-xs text-gray-400">Comment: {r.approverComment}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {scope === 'approve' && r.status === 'PENDING' && (
                      <>
                        <button disabled={busy} onClick={() => approve(r)} className="px-3 py-1.5 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40">Approve</button>
                        <button disabled={busy} onClick={() => setRejectTarget(r)} className="px-3 py-1.5 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40">Reject</button>
                      </>
                    )}
                    {r.status === 'APPROVED' && (
                      <button disabled={busy} onClick={() => complete(r)} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40">Mark Submitted / Re-lock</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Request Unlock">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
            <select value={newOutletId} onChange={(e) => setNewOutletId(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">Select…</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <textarea value={newReason} onChange={(e) => setNewReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Requested Duration</label>
            <select value={newDuration} onChange={(e) => setNewDuration(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="15m">15 minutes</option>
              <option value="30m">30 minutes</option>
              <option value="1h">1 hour</option>
            </select>
          </div>
          <button disabled={busy} onClick={submitRequest} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {busy ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Unlock Request">
        <div className="space-y-3">
          <textarea value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} rows={3} placeholder="Reason for rejection (optional)"
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          <button disabled={busy} onClick={reject} className="w-full py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 disabled:opacity-60">
            {busy ? 'Rejecting…' : 'Reject Request'}
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}
