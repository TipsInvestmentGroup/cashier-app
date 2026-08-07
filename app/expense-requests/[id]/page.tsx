'use client'
import { useEffect, useState, useCallback, use } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { waitingForText, type CurrentApproverView } from '@/lib/expense-approver'
import { downloadExpenseRequestPdf, type ExpensePdfSnapshot } from '@/lib/expense-request-pdf'
import toast from 'react-hot-toast'

const MAX_ATTACHMENT = 2 * 1024 * 1024 // 2MB, same cap as PayModal's receipt upload

// Last-resort fallback only if the per-outlet payment-methods config can't be
// fetched — the effective list is resolved server-side (Outlet → Company →
// Global → built-in default) and configured under Expense Settings.
const FALLBACK_PAYMENT_METHODS = ['CASH', 'CRDB', 'M-PESA', 'BANK TRANSFER']

interface ExpenseItem { id: string; detail: string; unit: number; unitCost: number; amount: number }
interface ExpensePayment {
  id: string; fundingSourceId: string; amount: number; paymentMethod: string
  payeeName: string | null; payeeAccount: string | null; reference: string | null; paidAt: string; paidById: string | null
}
interface PaymentAllocation { id: string; amount: number; expensePayment: ExpensePayment }
interface VerificationRecord { id: string; stage: string; verifiedById: string | null; verifiedAt: string; note: string | null }
interface ExpenseRequestDetail {
  id: string; purpose: string; amount: number; currency: string; status: string; createdAt: string
  // allocatedAmount = the approver-adjusted (approved) figure; null until an
  // approver sets a partial amount. direction OUT = disbursement, IN = top-up.
  allocatedAmount: number | null; direction: string
  requestedById: string; outletId: string | null
  requestNumber: string | null; expenseType: string | null; stageEnteredAt: string | null
  outlet: { id: string; name: string } | null
  requestType: { id: string; name: string; approverRoles: string | null; requiredVerificationStages: string | null; requiredAttachments: string | null }
  category: { id: string; name: string }
  items: ExpenseItem[]
  paymentAllocations: PaymentAllocation[]
  verifications: VerificationRecord[]
  currentApprover?: CurrentApproverView | null
}
interface FundingSource { id: string; name: string; sourceType: string; isActive: boolean }
interface Attachment { id: string; url: string; docType: string; createdAt: string; uploadedById: string | null }

const STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber' | 'indigo' | 'blue' | 'purple'> = {
  DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'blue', REJECTED: 'red',
  PARTIALLY_PAID: 'indigo', PAID: 'indigo', VERIFIED: 'purple', CLOSED: 'green', CANCELLED: 'gray',
}
const VERIFICATION_STAGE_OPTIONS = ['RECEIPT_UPLOADED', 'RECEIPT_VERIFIED', 'GOODS_CONFIRMED', 'VALIDATED']
const MGMT_ONLY_STAGES = ['RECEIPT_VERIFIED', 'GOODS_CONFIRMED', 'VALIDATED']
const ATTACHMENT_DOC_TYPE_OPTIONS = ['RECEIPT', 'INVOICE', 'PROOF_OF_PAYMENT', 'SCREENSHOT', 'OTHER']
const DISBURSER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']
const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']
const CLOSER_ROLES = ['ACCOUNTANT', 'ADMIN']

function parseArr(raw: string | null): string[] { if (!raw) return []; try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] } }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 ${className}`}>{children}</div>
}

function ExpenseRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { request } = useApi()
  const { user } = useAuth()
  const [data, setData] = useState<ExpenseRequestDetail | null>(null)
  const [sources, setSources] = useState<FundingSource[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [paymentMethods, setPaymentMethods] = useState<string[]>(FALLBACK_PAYMENT_METHODS)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // Approver-adjusted amount (partial approval); blank = approve as requested.
  const [approveAmount, setApproveAmount] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, srcs, users, atts] = await Promise.all([
        request(`/api/expense/requests/${id}`),
        request('/api/expense/funding-sources').catch(() => []),
        request('/api/users').catch(() => []),
        request(`/api/expense/attachments?entityType=ExpenseRequest&entityId=${id}`).catch(() => []),
      ])
      setData(d)
      setSources((srcs || []).filter((s: FundingSource) => s.isActive))
      setNames(Object.fromEntries((users || []).map((u: { id: string; name: string }) => [u.id, u.name])))
      setAttachments(atts || [])
      // Payment methods are resolved for this request's outlet (Expense Settings
      // → per-outlet override → company → global → default).
      const pm = await request(`/api/expense/config/payment-methods?outletId=${d?.outletId || ''}`).catch(() => null)
      if (pm?.paymentMethods?.length) setPaymentMethods(pm.paymentMethods)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load request') }
    finally { setLoading(false) }
  }, [request, id])
  useEffect(() => { load() }, [load])

  const nameOf = (uid: string | null) => !uid ? '—' : uid === user?.id ? 'You' : (names[uid] || `${uid.slice(0, 8)}…`)

  const isOwner = data?.requestedById === user?.id
  const canDisburse = DISBURSER_ROLES.includes(user?.role || '')
  const canClose = CLOSER_ROLES.includes(user?.role || '')
  // The payable figure is the approved amount once an approver adjusted it,
  // otherwise the requested amount (mirrors lib/expense-funds.ts payableAmount).
  // Every "how much is left" figure on this page is against it, not `amount`.
  const approvedAmt = data ? (data.allocatedAmount != null && data.allocatedAmount > 0 ? data.allocatedAmount : data.amount) : 0
  const isPartialApproval = !!data && data.allocatedAmount != null && data.allocatedAmount > 0 && data.allocatedAmount !== data.amount
  const outstanding = data ? approvedAmt - data.paymentAllocations.reduce((s, a) => s + a.amount, 0) : 0

  const submitDraft = async () => {
    setBusy('submit')
    try { const r = await request(`/api/expense/requests/${id}/submit`, { method: 'POST' }); toast.success(`Submitted — now ${r.status.replace('_', ' ')}`); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not submit') }
    finally { setBusy(null) }
  }
  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject')
    // On approve, an approver may sign off a different (usually smaller) amount
    // than requested — sent only when they entered one and it actually differs.
    // The server applies it at the FINAL approval level (lib/expense-workflow.ts).
    const adj = approveAmount.trim() ? Number(approveAmount) : null
    const allocatedAmount = approve && adj != null && adj > 0 && data && adj !== data.amount ? adj : undefined
    try {
      const r = await request(`/api/expense/requests/${id}/decide`, { method: 'POST', body: JSON.stringify({ approve, ...(allocatedAmount != null ? { allocatedAmount } : {}) }) })
      toast.success(`Now ${r.status.replace('_', ' ')}`); setApproveAmount(''); load()
    }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not decide') }
    finally { setBusy(null) }
  }
  const cancelRequest = async () => {
    if (!confirm('Cancel this request?')) return
    setBusy('cancel')
    try { await request(`/api/expense/requests/${id}`, { method: 'DELETE' }); toast.success('Cancelled'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not cancel') }
    finally { setBusy(null) }
  }
  const closeRequest = async () => {
    setBusy('close')
    try { await request(`/api/expense/requests/${id}/close`, { method: 'POST' }); toast.success('Closed'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not close') }
    finally { setBusy(null) }
  }

  // ── Pay panel ──
  // Keep the raw numeric string in state (so Number(amount) works on submit),
  // but show it with thousand separators. e.g. "1500000" -> "1,500,000".
  const displayAmount = (raw: string) => {
    if (!raw) return ''
    const [int, dec] = raw.split('.')
    const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return dec !== undefined ? `${withCommas}.${dec}` : withCommas
  }
  const parseAmount = (formatted: string) => formatted.replace(/[^\d.]/g, '')
  const [payOpen, setPayOpen] = useState(false)
  const [payForm, setPayForm] = useState({ fundingSourceId: '', amount: '', paymentMethod: 'CASH', payeeName: '', payeeAccount: '', reference: '' })
  const openPay = () => { setPayForm({ fundingSourceId: sources[0]?.id || '', amount: String(outstanding), paymentMethod: paymentMethods[0] || 'CASH', payeeName: '', payeeAccount: '', reference: '' }); setPayOpen(true) }
  const submitPay = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payForm.fundingSourceId) return toast.error('Select a funding source')
    if (!payForm.paymentMethod.trim()) return toast.error('Payment method is required')
    setBusy('pay')
    try {
      await request(`/api/expense/requests/${id}/pay`, {
        method: 'POST', body: JSON.stringify({
          fundingSourceId: payForm.fundingSourceId, paymentMethod: payForm.paymentMethod, amount: Number(payForm.amount) || undefined,
          payeeName: payForm.payeeName || undefined, payeeAccount: payForm.payeeAccount || undefined, reference: payForm.reference || undefined,
        }),
      })
      toast.success('Payment recorded'); setPayOpen(false); load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not record payment') }
    finally { setBusy(null) }
  }

  // ── Verification panel ──
  const [stage, setStage] = useState('RECEIPT_UPLOADED')
  const [note, setNote] = useState('')
  const recordStage = async () => {
    setBusy('verify')
    try {
      const r = await request(`/api/expense/requests/${id}/verifications`, { method: 'POST', body: JSON.stringify({ stage, note: note || undefined }) })
      toast.success(r.requestStatus === 'VERIFIED' ? 'Recorded — request is now VERIFIED' : 'Recorded')
      setNote(''); load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not record') }
    finally { setBusy(null) }
  }

  // ── Attachment upload ──
  const [docType, setDocType] = useState('RECEIPT')
  const [pendingUrl, setPendingUrl] = useState('')
  const onFile = (file?: File) => {
    if (!file) return setPendingUrl('')
    if (file.size > MAX_ATTACHMENT) return toast.error('File must be under 2MB')
    const reader = new FileReader()
    reader.onload = () => setPendingUrl(String(reader.result || ''))
    reader.readAsDataURL(file)
  }
  const uploadAttachment = async () => {
    if (!pendingUrl) return toast.error('Choose a file first')
    setBusy('attach')
    try {
      await request('/api/expense/attachments', { method: 'POST', body: JSON.stringify({ entityType: 'ExpenseRequest', entityId: id, url: pendingUrl, docType }) })
      toast.success('Attached'); setPendingUrl(''); load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not attach') }
    finally { setBusy(null) }
  }

  // Download the frozen snapshot as a PDF — 'audit' for the full request→
  // payment→retirement trail, 'routing' for the not-yet-approved physical
  // routing copy. Read-only: fetching the snapshot never touches the workflow.
  const downloadPdf = async (variant: 'audit' | 'routing') => {
    setBusy(`pdf-${variant}`)
    try {
      const snap: ExpensePdfSnapshot = await request(`/api/expense/requests/${id}/pdf-data`)
      await downloadExpenseRequestPdf(snap, { variant, recordUrl: window.location.href })
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not generate PDF') }
    finally { setBusy(null) }
  }

  if (loading) return <AppShell><SectionTabs tabs={PETTY_TABS} /><div className="py-16 text-center text-gray-400">Loading…</div></AppShell>
  if (!data) return <AppShell><SectionTabs tabs={PETTY_TABS} /><div className="py-16 text-center text-gray-400">Request not found.</div></AppShell>

  const requiredStages = parseArr(data.requestType.requiredVerificationStages)
  const haveStages = new Set(data.verifications.map((v) => v.stage))
  const requiredDocs = parseArr(data.requestType.requiredAttachments)
  const haveDocs = new Set(attachments.map((a) => a.docType))
  const canVerifyPanel = ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'VERIFIED'].includes(data.status)
  const canPayPanel = (data.status === 'APPROVED' || data.status === 'PARTIALLY_PAID') && canDisburse

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6 max-w-4xl">
        <Link href="/expense-requests" className="text-sm text-indigo-600 hover:text-indigo-800">← All expense requests</Link>

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{data.purpose}</h1>
              {data.status === 'PENDING_APPROVAL' && data.currentApprover
                ? <Badge tone="amber">Waiting for approval</Badge>
                : <Badge tone={STATUS_TONE[data.status] || 'gray'}>{data.status.replace('_', ' ')}</Badge>}
            </div>
            <p className="text-gray-500 text-sm mt-1">
              {data.requestNumber && <span className="font-mono text-gray-700">{data.requestNumber}</span>}
              {data.requestNumber && ' · '}
              {data.expenseType ? `${data.expenseType} · ` : ''}{data.category.name}
              {data.outlet ? ` · ${data.outlet.name}` : ''} · {data.requestType.name} · requested by {nameOf(data.requestedById)} on {formatDate(data.createdAt)}
            </p>
            {data.status === 'PENDING_APPROVAL' && data.currentApprover && (
              <p className="text-sm mt-1.5 font-medium text-amber-700">
                ⏳ Waiting for: {waitingForText(data.currentApprover, user?.id)}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" onClick={() => downloadPdf('audit')} disabled={!!busy}>
              {busy === 'pdf-audit' ? 'Preparing…' : '⬇ Download PDF'}
            </Button>
            {['DRAFT', 'PENDING_APPROVAL'].includes(data.status) && (
              <Button variant="outline" onClick={() => downloadPdf('routing')} disabled={!!busy}>
                {busy === 'pdf-routing' ? 'Preparing…' : '⬇ Routing copy'}
              </Button>
            )}
            {data.status === 'DRAFT' && (isOwner || user?.role === 'ADMIN') && (
              <>
                <Button onClick={submitDraft} disabled={!!busy}>{busy === 'submit' ? 'Working…' : 'Submit'}</Button>
                <Button variant="danger" onClick={cancelRequest} disabled={!!busy}>Cancel</Button>
              </>
            )}
            {data.status === 'PENDING_APPROVAL' && (
              <>
                {/* Optional partial approval: approve for less than requested. Only
                    for OUT disbursements (an IN top-up's amount is set in its own
                    flow). Applied when the FINAL level clears; blank = as requested. */}
                {data.direction === 'OUT' && (
                  <label className="flex flex-col">
                    <span className="text-[10px] text-gray-400 leading-tight">Approve for (optional)</span>
                    <input type="text" inputMode="decimal"
                      className="w-32 px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
                      value={displayAmount(approveAmount)} onChange={(e) => setApproveAmount(parseAmount(e.target.value))}
                      placeholder={formatCurrency(data.amount)} />
                  </label>
                )}
                <Button variant="success" onClick={() => decide(true)} disabled={!!busy}>{busy === 'approve' ? 'Working…' : 'Approve'}</Button>
                <Button variant="danger" onClick={() => decide(false)} disabled={!!busy}>{busy === 'reject' ? 'Working…' : 'Reject'}</Button>
                {(isOwner || user?.role === 'ADMIN') && <Button variant="outline" onClick={cancelRequest} disabled={!!busy}>Cancel</Button>}
              </>
            )}
            {canPayPanel && <Button onClick={() => (payOpen ? setPayOpen(false) : openPay())}>{payOpen ? 'Close' : '💵 Pay'}</Button>}
            {data.status === 'VERIFIED' && canClose && <Button variant="success" onClick={closeRequest} disabled={!!busy}>{busy === 'close' ? 'Working…' : 'Close'}</Button>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <p className="text-xs text-gray-500">{isPartialApproval ? 'Approved' : 'Amount'}</p>
            <p className="text-xl font-bold mt-1 text-gray-800">{formatCurrency(approvedAmt)}</p>
            {isPartialApproval && <p className="text-[11px] text-amber-600 mt-0.5">of {formatCurrency(data.amount)} requested</p>}
          </Card>
          <Card><p className="text-xs text-gray-500">Paid</p><p className="text-xl font-bold mt-1 text-gray-800">{formatCurrency(data.paymentAllocations.reduce((s, a) => s + a.amount, 0))}</p></Card>
          <Card><p className="text-xs text-gray-500">Outstanding</p><p className={`text-xl font-bold mt-1 ${outstanding > 0 ? 'text-orange-600' : 'text-gray-800'}`}>{formatCurrency(outstanding)}</p></Card>
          <Card><p className="text-xs text-gray-500">Payments</p><p className="text-xl font-bold mt-1 text-gray-800">{data.paymentAllocations.length}</p></Card>
        </div>

        {data.items.length > 0 && (
          <Card>
            <h2 className="font-semibold text-gray-800 mb-3">Breakdown</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1 pr-3">Detail</th><th className="pr-3">Unit</th><th className="pr-3">Unit cost</th><th className="pr-3 text-right">Amount</th></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 text-gray-700">{it.detail}</td><td className="pr-3 text-gray-500">{it.unit}</td>
                    <td className="pr-3 text-gray-500">{formatCurrency(it.unitCost)}</td><td className="pr-3 text-right font-semibold text-gray-800">{formatCurrency(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {payOpen && canPayPanel && (
          <Card className="border-2 border-indigo-200">
            <h2 className="font-semibold text-gray-800 mb-3">Record payment</h2>
            <form onSubmit={submitPay} className="grid sm:grid-cols-2 gap-3">
              <label className="block"><span className="text-xs text-gray-500">Funding source</span>
                <select className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full bg-white" value={payForm.fundingSourceId} onChange={(e) => setPayForm({ ...payForm, fundingSourceId: e.target.value })}>
                  <option value="">Select…</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.sourceType})</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-gray-500">Payment method</span>
                <select className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full bg-white" value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })}>
                  {/* Guard: if the stored value isn't in the resolved list (e.g. an
                      older payment or a since-removed method), still show it. */}
                  {(paymentMethods.includes(payForm.paymentMethod) ? paymentMethods : [payForm.paymentMethod, ...paymentMethods].filter(Boolean)).map((m) => <option key={m} value={m}>{m}</option>)}
                </select></label>
              <label className="block"><span className="text-xs text-gray-500">Amount <span className="text-gray-400">(defaults to outstanding {formatCurrency(outstanding)})</span></span>
                <input type="text" inputMode="decimal" className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full" value={displayAmount(payForm.amount)} onChange={(e) => setPayForm({ ...payForm, amount: parseAmount(e.target.value) })} /></label>
              <label className="block"><span className="text-xs text-gray-500">Reference</span>
                <input className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Bank/MoMo txn id, cheque no." /></label>
              <label className="block"><span className="text-xs text-gray-500">Payee name</span>
                <input className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full" value={payForm.payeeName} onChange={(e) => setPayForm({ ...payForm, payeeName: e.target.value })} /></label>
              <label className="block"><span className="text-xs text-gray-500">Payee account</span>
                <input className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full" value={payForm.payeeAccount} onChange={(e) => setPayForm({ ...payForm, payeeAccount: e.target.value })} /></label>
              <div className="sm:col-span-2"><Button type="submit" disabled={busy === 'pay'}>{busy === 'pay' ? 'Recording…' : 'Record payment'}</Button></div>
            </form>
          </Card>
        )}

        {data.paymentAllocations.length > 0 && (
          <Card>
            <h2 className="font-semibold text-gray-800 mb-3">Payment history</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100"><th className="py-1 pr-3">Date</th><th className="pr-3">Method</th><th className="pr-3">Reference</th><th className="pr-3">Paid by</th><th className="pr-3 text-right">Amount</th></tr></thead>
              <tbody>
                {data.paymentAllocations.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50">
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{formatDateTime(a.expensePayment.paidAt)}</td>
                    <td className="pr-3 text-gray-600">{a.expensePayment.paymentMethod}</td>
                    <td className="pr-3 text-gray-500">{a.expensePayment.reference || '—'}</td>
                    <td className="pr-3 text-gray-500">{nameOf(a.expensePayment.paidById)}</td>
                    <td className="pr-3 text-right font-semibold text-gray-800">{formatCurrency(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {canVerifyPanel && (
          <Card>
            <h2 className="font-semibold text-gray-800 mb-1">Verification</h2>
            <p className="text-xs text-gray-400 mb-3">Payment alone never closes a request — record the stages this request type requires, then VALIDATED advances it to VERIFIED.</p>
            {(requiredStages.length > 0 || requiredDocs.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-3">
                {requiredStages.map((s) => (
                  <span key={s} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${haveStages.has(s) ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {haveStages.has(s) ? '✓' : '○'} {s.replace(/_/g, ' ')}
                  </span>
                ))}
                {requiredDocs.map((d) => (
                  <span key={d} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${haveDocs.has(d) ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                    {haveDocs.has(d) ? '✓' : '○'} {d.replace(/_/g, ' ')} attached
                  </span>
                ))}
              </div>
            )}

            {data.verifications.length > 0 && (
              <div className="divide-y divide-gray-50 mb-3">
                {data.verifications.map((v) => (
                  <div key={v.id} className="py-2 flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-700">{v.stage.replace(/_/g, ' ')}</span>
                    <span className="text-gray-400 text-xs">{nameOf(v.verifiedById)} · {formatDateTime(v.verifiedAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {data.status !== 'VERIFIED' && (
              <div className="grid sm:grid-cols-3 gap-2 items-end">
                <label className="block"><span className="text-xs text-gray-500">Stage</span>
                  <select className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full bg-white" value={stage} onChange={(e) => setStage(e.target.value)}>
                    {VERIFICATION_STAGE_OPTIONS.filter((s) => !MGMT_ONLY_STAGES.includes(s) || MGMT_ROLES.includes(user?.role || '')).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                  </select></label>
                <label className="block sm:col-span-1"><span className="text-xs text-gray-500">Note</span>
                  <input className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
                <Button onClick={recordStage} disabled={busy === 'verify'}>{busy === 'verify' ? 'Recording…' : 'Record stage'}</Button>
              </div>
            )}
          </Card>
        )}

        {canVerifyPanel && (
          <Card>
            <h2 className="font-semibold text-gray-800 mb-3">Attachments</h2>
            {attachments.length > 0 && (
              <div className="divide-y divide-gray-50 mb-3">
                {attachments.map((a) => (
                  <div key={a.id} className="py-2 flex items-center justify-between text-sm">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:text-indigo-800">{a.docType}</a>
                    <span className="text-gray-400 text-xs">{nameOf(a.uploadedById)} · {formatDateTime(a.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block"><span className="text-xs text-gray-500">Type</span>
                <select className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white" value={docType} onChange={(e) => setDocType(e.target.value)}>
                  {ATTACHMENT_DOC_TYPE_OPTIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
                </select></label>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0])}
                className="text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-medium" />
              <Button onClick={uploadAttachment} disabled={!pendingUrl || busy === 'attach'} size="sm">{busy === 'attach' ? 'Attaching…' : 'Attach'}</Button>
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

export default ExpenseRequestDetailPage
