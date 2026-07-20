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

interface PaymentVerification {
  id: string
  outletId: string | null
  date: string
  reference: string | null
  channel: string
  amount: number
  customerName: string | null
  paidAt: string | null
  status: string
  source: string
  failureReason: string | null
  createdAt: string
}
interface Outlet { id: string; name: string }

const STATUSES = ['PENDING', 'VERIFIED', 'FAILED', 'DUPLICATE']

export default function PaymentVerificationsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<PaymentVerification[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [status, setStatus] = useState('PENDING')
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ date: '', channel: 'CASH', amount: '', reference: '', customerName: '' })
  const [submitting, setSubmitting] = useState(false)
  const [rejectTarget, setRejectTarget] = useState<PaymentVerification | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      if (status) qs.set('status', status)
      if (channel) qs.set('channel', channel)
      const r = await request(`/api/payment-verifications?${qs}`)
      setItems(r.paymentVerifications || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, outletId, status, channel])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])

  const submitManual = async () => {
    if (!form.date || !form.channel || !form.amount) return toast.error('Date, channel, and amount are required')
    setSubmitting(true)
    try {
      await request('/api/payment-verifications', {
        method: 'POST',
        body: JSON.stringify({
          outletId: outletId || null,
          date: form.date,
          channel: form.channel,
          amount: Number(form.amount),
          reference: form.reference || null,
          customerName: form.customerName || null,
        }),
      })
      toast.success('Payment recorded')
      setShowForm(false)
      setForm({ date: '', channel: 'CASH', amount: '', reference: '', customerName: '' })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not record payment')
    } finally { setSubmitting(false) }
  }

  const verify = async (id: string) => {
    setDeciding(id)
    try {
      await request(`/api/payment-verifications/${id}/verify`, { method: 'POST', body: JSON.stringify({}) })
      toast.success('Verified')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not verify')
    } finally { setDeciding(null) }
  }

  const submitReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return toast.error('A reason is required')
    setDeciding(rejectTarget.id)
    try {
      await request(`/api/payment-verifications/${rejectTarget.id}/reject`, { method: 'POST', body: JSON.stringify({ failureReason: rejectReason }) })
      toast.success('Marked failed')
      setRejectTarget(null); setRejectReason('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reject')
    } finally { setDeciding(null) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payment Verifications</h1>
            <p className="text-gray-500 text-sm">Real-time verification by reference, customer, amount, and channel — sourced from API, file import, manual entry, or the system itself (Cash/Bank/POS).</p>
          </div>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 whitespace-nowrap">Record Payment</button>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Channel (e.g. CASH, MPESA)"
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : items.length === 0 ? (
            <EmptyState icon="💳" title="No payment verifications found" hint="Payments verified via API, import, manual entry, or system events (Cash/Bank/POS) appear here." />
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{p.channel} · {formatCurrency(p.amount)} {p.reference && <span className="text-gray-400 font-normal">· {p.reference}</span>}</p>
                    <p className="text-xs text-gray-400">
                      {p.customerName || 'No customer'} · source {p.source} · {formatDateTime(p.createdAt)}
                      {p.failureReason && <span className="text-red-500"> · {p.failureReason}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge status={p.status}>{p.status}</Badge>
                    {p.status === 'PENDING' && (
                      <>
                        <button disabled={deciding === p.id} onClick={() => verify(p.id)}
                          className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">Verify</button>
                        <button disabled={deciding === p.id} onClick={() => setRejectTarget(p)}
                          className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Record Payment">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Channel</label>
              <input value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Amount</label>
              <input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Reference (optional)</label>
            <input value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Customer (optional)</label>
            <input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <button disabled={submitting} onClick={submitManual} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-60">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>

      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Reject Payment">
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Failure Reason</label>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={3}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
          </div>
          <button disabled={!!deciding} onClick={submitReject} className="w-full py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-60">
            Reject Payment
          </button>
        </div>
      </Modal>
    </AppShell>
  )
}
