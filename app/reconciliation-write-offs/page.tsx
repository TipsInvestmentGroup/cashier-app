'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import toast from 'react-hot-toast'

interface WriteOffRequest {
  id: string
  sourceModel: string
  sourceId: string
  expectedAmount: number
  receivedAmount: number
  amount: number
  reason: string
  evidenceUrl?: string | null
  status: string
  requestedByName: string
  approverName?: string | null
  approverComment?: string | null
  createdAt: string
}

const SOURCE_MODELS = ['CashRecon', 'BankRecon', 'CollectionExcess', 'CashReconExcess']

export default function ReconciliationWriteOffsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<WriteOffRequest[]>([])
  const [status, setStatus] = useState('PENDING')
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ sourceModel: 'CashRecon', sourceId: '', expectedAmount: '', receivedAmount: '', reason: '', evidenceUrl: '' })
  const [submitting, setSubmitting] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<WriteOffRequest | null>(null)
  const [rejectComment, setRejectComment] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      const r = await request(`/api/write-off-requests?${qs}`)
      setItems(r.writeOffRequests || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, status])

  useEffect(() => { load() }, [load])

  const submitRequest = async () => {
    if (!form.sourceId || !form.expectedAmount || !form.receivedAmount || !form.reason) {
      return toast.error('Source, amounts, and reason are required')
    }
    setSubmitting(true)
    try {
      await request('/api/write-off-requests', {
        method: 'POST',
        body: JSON.stringify({
          sourceModel: form.sourceModel,
          sourceId: form.sourceId,
          expectedAmount: Number(form.expectedAmount),
          receivedAmount: Number(form.receivedAmount),
          reason: form.reason,
          evidenceUrl: form.evidenceUrl || null,
        }),
      })
      toast.success('Write-off requested')
      setShowForm(false)
      setForm({ sourceModel: 'CashRecon', sourceId: '', expectedAmount: '', receivedAmount: '', reason: '', evidenceUrl: '' })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not submit request')
    } finally { setSubmitting(false) }
  }

  const approve = async (id: string) => {
    setDeciding(id)
    try {
      await request(`/api/write-off-requests/${id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      toast.success('Approved — accounting adjustment posted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not approve')
    } finally { setDeciding(null) }
  }

  const submitReject = async () => {
    if (!rejectTarget || !rejectComment.trim()) return toast.error('A comment is required to reject')
    setDeciding(rejectTarget.id)
    try {
      await request(`/api/write-off-requests/${rejectTarget.id}/reject`, { method: 'POST', body: JSON.stringify({ comment: rejectComment }) })
      toast.success('Rejected')
      setRejectTarget(null); setRejectComment('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reject')
    } finally { setDeciding(null) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Reconciliation Write-Offs</h1>
            <p className="text-gray-500 text-sm">Controlled adjustments for reconciliation discrepancies — never edits the original record; every write-off needs evidence and Finance Manager approval.</p>
          </div>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 whitespace-nowrap">Request Write-Off</button>
        </div>

        <div className="flex gap-2">
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', ''].map((s) => (
            <button key={s || 'ALL'} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${status === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon="✍️" title="No write-off requests" hint="Requests for cash shortages or unreconciled variances appear here for approval." />
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((w) => (
                <div key={w.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{w.sourceModel} · {formatCurrency(w.amount)}</p>
                      <p className="text-xs text-gray-400">Expected {formatCurrency(w.expectedAmount)} · Received {formatCurrency(w.receivedAmount)} · requested by {w.requestedByName} · {formatDateTime(w.createdAt)}</p>
                    </div>
                    <Badge status={w.status}>{w.status}</Badge>
                  </div>
                  <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">{w.reason}</p>
                  {w.evidenceUrl && <a href={w.evidenceUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">View evidence</a>}
                  {w.approverComment && <p className="text-xs text-gray-500">Approver comment: {w.approverComment}</p>}
                  {w.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button disabled={deciding === w.id} onClick={() => approve(w.id)}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">Approve</button>
                      <button disabled={deciding === w.id} onClick={() => setRejectTarget(w)}
                        className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Request Write-Off">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Source Record Type</label>
            <select value={form.sourceModel} onChange={(e) => setForm((f) => ({ ...f, sourceModel: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none">
              {SOURCE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Source Record ID</label>
            <input value={form.sourceId} onChange={(e) => setForm((f) => ({ ...f, sourceId: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Expected Amount</label>
              <input type="number" value={form.expectedAmount} onChange={(e) => setForm((f) => ({ ...f, expectedAmount: e.target.value }))}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Received Amount</label>
              <input type="number" value={form.receivedAmount} onChange={(e) => setForm((f) => ({ ...f, receivedAmount: e.target.value }))}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
            <textarea value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} rows={2}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Evidence URL (optional)</label>
            <input value={form.evidenceUrl} onChange={(e) => setForm((f) => ({ ...f, evidenceUrl: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <button disabled={submitting} onClick={submitRequest} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Write-Off">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Comment</label>
            <textarea value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
          </div>
          <button disabled={!!deciding} onClick={submitReject} className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-60">
            Reject Request
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}
