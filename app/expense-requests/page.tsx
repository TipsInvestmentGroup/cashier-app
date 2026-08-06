'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { MoneyInput } from '@/components/MoneyInput'
import { ExpenseDynamicFields } from '@/components/ExpenseDynamicFields'
import { FUND_CLASS_LABELS, type FundClass } from '@/lib/expense-funds'
import { waitingForText, type CurrentApproverView } from '@/lib/expense-approver'
import { computeAging, type AgingTone } from '@/lib/expense-aging'
import { EXPENSE_TYPES } from '@/lib/shared-constants'
import toast from 'react-hot-toast'

interface RequestType { id: string; name: string; allowedCategoryIds: string | null; isActive: boolean }
interface Category { id: string; name: string; isActive: boolean }
interface FundingSourceOption {
  id: string; name: string; sourceType: string; isActive: boolean
  fundClass: FundClass | null; allocationMode: string | null
  availableBalance: number; approvalThreshold: number
}
interface ExpenseItem { id?: string; detail: string; unit: number; unitCost: number; amount: number }
interface ExpenseRequest {
  id: string; purpose: string; amount: number; currency: string; status: string; createdAt: string
  requestedById: string; requestType: { id: string; name: string }; category: { id: string; name: string }
  items: ExpenseItem[]; _count?: { paymentAllocations: number }
  currentApprover?: CurrentApproverView | null
  requestNumber?: string | null; expenseType?: string | null; stageEnteredAt?: string | null
  outletId?: string | null; outlet?: { id: string; name: string } | null
}

const AGING_CLASS: Record<AgingTone, string> = {
  green: 'text-emerald-600', amber: 'text-amber-600', red: 'text-red-600 font-semibold',
}

const STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber' | 'indigo' | 'blue' | 'purple'> = {
  DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'blue', REJECTED: 'red',
  PARTIALLY_PAID: 'indigo', PAID: 'indigo', VERIFIED: 'purple', CLOSED: 'green', CANCELLED: 'gray',
}
const STATUS_FILTERS = ['', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VERIFIED', 'CLOSED', 'REJECTED', 'CANCELLED']

function parseIdList(raw: string | null): string[] | null {
  if (!raw) return null
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : null } catch { return null }
}

export default function ExpenseRequestsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<ExpenseRequest[]>([])
  const [requestTypes, setRequestTypes] = useState<RequestType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [fundingSources, setFundingSources] = useState<FundingSourceOption[]>([])
  const [requesters, setRequesters] = useState<{ id: string; name: string }[]>([])
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])

  const [fundingSourceId, setFundingSourceId] = useState('')
  const [requestedById, setRequestedById] = useState('')
  const [expenseType, setExpenseType] = useState('')
  const [outletId, setOutletId] = useState('')
  const [requestTypeId, setRequestTypeId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [purpose, setPurpose] = useState('')
  const [amount, setAmount] = useState('')
  const [lineItems, setLineItems] = useState<{ detail: string; unit: string; unitCost: string }[]>([])
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const itemRowAmount = (r: { unit: string; unitCost: string }) => (Number(r.unit) || 0) * (Number(r.unitCost) || 0)
  const itemsTotal = lineItems.reduce((s, r) => s + itemRowAmount(r), 0)
  const hasItems = lineItems.some((r) => r.detail.trim() || Number(r.unitCost) > 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [its, types, cats, users, sources, eligible, outletList] = await Promise.all([
        request('/api/expense/requests'), request('/api/expense/request-types'), request('/api/expense/categories'),
        request('/api/users').catch(() => []),
        request('/api/expense/funding-sources').catch(() => []),
        // §4: who may be named as the requester comes from the access list, not
        // from the user table. Empty means requesting access hasn't been
        // configured yet, in which case the form falls back to the caller.
        request('/api/expense/access-grants/eligible?grantType=REQUEST').catch(() => []),
        request('/api/outlets').catch(() => []),
      ])
      setItems(its || [])
      setRequestTypes((types || []).filter((t: RequestType) => t.isActive))
      setCategories((cats || []).filter((c: Category) => c.isActive))
      setNames(Object.fromEntries((users || []).map((u: { id: string; name: string }) => [u.id, u.name])))
      setFundingSources((sources || []).filter((s: FundingSourceOption) => s.isActive && s.fundClass))
      setRequesters(eligible || [])
      setOutlets((outletList || []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name })))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const isAdmin = user?.role === 'ADMIN'
  // §2.2: Outlet defaults to the requester's assigned outlet and is Admin-editable
  // only. Set the default once the user is known and leave it unless an Admin picks.
  useEffect(() => { if (!outletId && user?.outlet?.id) setOutletId(user.outlet.id) }, [user?.outlet?.id, outletId])

  const selectedFund = fundingSources.find((s) => s.id === fundingSourceId)
  const requestedAmount = hasItems ? itemsTotal : Number(amount) || 0
  // §5: flag before submit rather than only on the server round-trip — the
  // requester can then fix the amount or pick a different fund instead of
  // discovering the problem after the request exists.
  const overBalance = !!selectedFund && requestedAmount > 0 && requestedAmount > selectedFund.availableBalance
  // §3: selecting a fund auto-assigns the custodian who will pay it, and the
  // threshold tells the requester up-front whether this needs approval at all.
  const skipsApproval = !!selectedFund && selectedFund.approvalThreshold > 0 && requestedAmount > 0 && requestedAmount <= selectedFund.approvalThreshold

  const selectedType = requestTypes.find((t) => t.id === requestTypeId)
  const allowedCategoryIds = selectedType ? parseIdList(selectedType.allowedCategoryIds) : null
  const availableCategories = allowedCategoryIds ? categories.filter((c) => allowedCategoryIds.includes(c.id)) : categories

  const addItem = () => setLineItems([...lineItems, { detail: '', unit: '1', unitCost: '' }])
  const updItem = (i: number, patch: Partial<{ detail: string; unit: string; unitCost: string }>) => setLineItems(lineItems.map((r, x) => (x === i ? { ...r, ...patch } : r)))
  const rmItem = (i: number) => setLineItems(lineItems.filter((_, x) => x !== i))

  const resetForm = () => { setFundingSourceId(''); setRequestedById(''); setExpenseType(''); setRequestTypeId(''); setCategoryId(''); setPurpose(''); setAmount(''); setLineItems([]); setFieldValues({}) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!fundingSourceId) return toast.error('Select where this will be paid from')
    if (!expenseType) return toast.error('Select an expense type')
    if (!outletId) return toast.error('Select an outlet')
    if (!requestTypeId) return toast.error('Select a request type')
    if (!categoryId) return toast.error('Select a category')
    if (!purpose.trim()) return toast.error('Purpose is required')
    const cleanItems = lineItems.filter((r) => r.detail.trim() || Number(r.unitCost) > 0)
      .map((r) => ({ detail: r.detail.trim() || 'Item', unit: Number(r.unit) || 1, unitCost: Number(r.unitCost) || 0, amount: itemRowAmount(r) }))
    const finalAmount = cleanItems.length ? itemsTotal : Number(amount)
    if (!finalAmount || finalAmount <= 0) return toast.error('Amount must be > 0 (enter an amount or add items)')

    setSubmitting(true)
    try {
      const created = await request('/api/expense/requests', {
        method: 'POST',
        body: JSON.stringify({
          fundingSourceId, requestTypeId, categoryId, purpose, amount: finalAmount, items: cleanItems, fieldValues,
          expenseType, outletId,
          ...(requestedById ? { requestedById } : {}),
        }),
      })
      // The server's balance check is authoritative; surface its warning rather
      // than assuming the client-side estimate matched (the fund's balance can
      // move between page load and submit).
      if (created.balanceWarning) toast(`Submitted, but flagged: ${created.balanceWarning}`, { icon: '⚠️', duration: 6000 })
      const submitted = await request(`/api/expense/requests/${created.id}/submit`, { method: 'POST' })
      toast.success(submitted?.skipReason ? 'Submitted — no approval needed, ready to pay' : 'Request submitted!')
      resetForm(); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error submitting request') }
    finally { setSubmitting(false) }
  }

  const filtered = statusFilter ? items.filter((i) => i.status === statusFilter) : items
  const total = filtered.reduce((s, i) => s + i.amount, 0)

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expense Requests</h1>
          <p className="text-gray-500 text-sm">The Universal Expense &amp; Disbursement Framework — request, approve, pay, and verify against admin-configured request types and categories.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* LEFT: list */}
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                <p className="text-indigo-100 text-xs">Total ({filtered.length})</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">⏳ Awaiting approval</p>
                <p className="text-lg font-bold mt-1 text-orange-600">{items.filter((i) => i.status === 'PENDING_APPROVAL').length}</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-600 mr-1">Status:</span>
              {STATUS_FILTERS.map((s) => (
                <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${statusFilter === s ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {s ? s.replace('_', ' ') : 'All'}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-4 py-3 font-semibold">Request #</th>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Requested By</th>
                        <th className="px-4 py-3 font-semibold">Outlet</th>
                        <th className="px-4 py-3 font-semibold">Type</th>
                        <th className="px-4 py-3 font-semibold">Category</th>
                        <th className="px-4 py-3 font-semibold">Purpose</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Aging</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => (window.location.href = `/expense-requests/${i.id}`)}>
                          <td className="px-4 py-3 font-mono text-[11px] text-gray-600 whitespace-nowrap">{i.requestNumber || <span className="text-gray-300 italic">draft</span>}</td>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{i.requestedById === user?.id ? 'You' : (names[i.requestedById] || '—')}</td>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{i.outlet?.name || '—'}</td>
                          <td className="px-4 py-3 text-gray-700">{i.expenseType || <span className="text-gray-300">—</span>}<span className="block text-[11px] text-gray-400">{i.requestType.name}</span></td>
                          <td className="px-4 py-3 text-gray-500">{i.category.name}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={i.purpose}>
                            <Link href={`/expense-requests/${i.id}`} className="text-indigo-600 hover:text-indigo-800" onClick={(e) => e.stopPropagation()}>{i.purpose}</Link>
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">{(() => {
                            // Aging is dead only in terminal states — for CLOSED/REJECTED/
                            // CANCELLED "time in stage" is noise, so show a dash.
                            if (['CLOSED', 'REJECTED', 'CANCELLED', 'PAID', 'VERIFIED'].includes(i.status)) return <span className="text-gray-300">—</span>
                            const a = computeAging(i.stageEnteredAt || i.createdAt)
                            return a ? <span className={`text-xs ${AGING_CLASS[a.tone]}`}>{a.label}</span> : <span className="text-gray-300">—</span>
                          })()}</td>
                          <td className="px-4 py-3">
                            {i.status === 'PENDING_APPROVAL' && i.currentApprover ? (
                              <div>
                                <Badge tone="amber">Waiting for approval</Badge>
                                <span className="block text-[11px] text-gray-500 mt-0.5" title={`Waiting for: ${waitingForText(i.currentApprover, user?.id)}`}>
                                  → {waitingForText(i.currentApprover, user?.id)}
                                </span>
                              </div>
                            ) : (
                              <Badge tone={STATUS_TONE[i.status] || 'gray'}>{i.status.replace('_', ' ')}</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={10}><EmptyState icon="🧾" title="No expense requests" hint="Submit one with the form on the right." /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Expense Form (§3) */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:sticky lg:top-4">
              <h2 className="text-lg font-bold text-gray-800 mb-1">🧾 Expense Form</h2>
              <p className="text-xs text-gray-400 mb-4">Start with the fund this will be paid from — the custodian, approval chain, and available balance all follow from that.</p>
              <form onSubmit={submit} className="space-y-3">
                {/* §3: Funding Source is the FIRST field and drives everything below it. */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Pay From *</label>
                  <select value={fundingSourceId} onChange={(e) => setFundingSourceId(e.target.value)}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required>
                    <option value="">Select a fund…</option>
                    {fundingSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fundClass ? FUND_CLASS_LABELS[s.fundClass] : s.sourceType} — {s.name}
                      </option>
                    ))}
                  </select>
                  {fundingSources.length === 0 && (
                    <p className="text-[11px] text-amber-600 mt-1">No funds configured yet — ask an admin to add one in Expense Settings.</p>
                  )}
                  {selectedFund && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-gray-500">
                        Available: <span className={`font-semibold ${overBalance ? 'text-red-600' : 'text-gray-700'}`}>{formatCurrency(selectedFund.availableBalance)}</span>
                        <span className="text-gray-400">
                          {selectedFund.allocationMode === 'ROLLING_CASH_BALANCE' ? " · today's cash position"
                            : selectedFund.allocationMode === 'BANK_BALANCE' ? ' · linked bank account'
                            : ' · allocated float'}
                        </span>
                      </p>
                      <FundCustodians fundingSourceId={selectedFund.id} />
                      {overBalance && (
                        <p className="text-[11px] text-red-600">
                          This is more than the fund has available. It can still be submitted, but it will be flagged for the approver.
                        </p>
                      )}
                      {skipsApproval && (
                        <p className="text-[11px] text-emerald-700">
                          Below this fund&apos;s {formatCurrency(selectedFund.approvalThreshold)} threshold — goes straight to the custodian without approval.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* §4: only people holding Requesting Access appear here. Hidden
                    entirely until access is configured, when the requester is
                    always the signed-in user. */}
                {requesters.length > 0 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Requested By</label>
                    <select value={requestedById} onChange={(e) => setRequestedById(e.target.value)}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">{user?.name ? `${user.name} (me)` : 'Me'}</option>
                      {requesters.filter((r) => r.id !== user?.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Expense Type *</label>
                    <select value={expenseType} onChange={(e) => setExpenseType(e.target.value)}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required>
                      <option value="">Select type…</option>
                      {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">What kind of transaction (distinct from cost centre / category).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet *</label>
                    <select value={outletId} onChange={(e) => setOutletId(e.target.value)} disabled={!isAdmin}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500" required>
                      <option value="">Select outlet…</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">{isAdmin ? 'Defaults to the requester’s outlet; editable.' : 'Your assigned outlet (Admin can change).'}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Request Type *</label>
                  <select value={requestTypeId} onChange={(e) => { setRequestTypeId(e.target.value); setCategoryId('') }}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required>
                    <option value="">Select type…</option>
                    {requestTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {requestTypes.length === 0 && <p className="text-[11px] text-amber-600 mt-1">No request types configured yet — ask an admin to set one up in Expense Settings.</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Category *</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required disabled={!requestTypeId}>
                    <option value="">Select category…</option>
                    {availableCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose *</label>
                  <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} placeholder="What is this for?" required />
                </div>

                {requestTypeId && <ExpenseDynamicFields requestTypeId={requestTypeId} values={fieldValues} onChange={setFieldValues} />}

                <div className="border-2 border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">📋 Breakdown <span className="font-normal text-gray-400">(optional)</span></span>
                    <button type="button" onClick={addItem} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">➕ Add item</button>
                  </div>
                  {lineItems.length === 0 && <p className="text-xs text-gray-400">Leave empty and enter a total below, or add items to itemize.</p>}
                  {lineItems.map((r, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                      <input value={r.detail} onChange={(e) => updItem(i, { detail: e.target.value })} placeholder="Detail"
                        className="col-span-5 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                      <input type="number" min="1" value={r.unit} onChange={(e) => updItem(i, { unit: e.target.value })} placeholder="1"
                        className="col-span-2 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                      <MoneyInput value={r.unitCost} onChange={(v) => updItem(i, { unitCost: v })} placeholder="0"
                        className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                      <span className="col-span-1 text-xs font-semibold text-gray-700 text-right">{formatCurrency(itemRowAmount(r))}</span>
                      <button type="button" onClick={() => rmItem(i)} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount *</label>
                  {hasItems ? (
                    <div className="w-full px-3 py-2.5 border-2 border-indigo-200 bg-indigo-50 rounded-xl text-lg font-bold text-indigo-800">
                      {formatCurrency(itemsTotal)}<span className="ml-2 text-xs font-normal text-indigo-500">auto from items</span>
                    </div>
                  ) : (
                    <MoneyInput value={amount} onChange={setAmount} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
                  )}
                </div>

                <Button type="submit" size="lg" disabled={submitting} className="w-full">
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}

/** §3: "selecting a funding source auto-assigns the relevant custodian" — shown
 *  so the requester knows who will actually pay this before submitting, and so a
 *  fund with nobody assigned is obvious rather than silently unpayable. */
function FundCustodians({ fundingSourceId }: { fundingSourceId: string }) {
  const { request } = useApi()
  const [names, setNames] = useState<string[] | null>(null)

  useEffect(() => {
    let cancelled = false
    request(`/api/expense/funding-sources/${fundingSourceId}/custodians`)
      .then((rows: { user: { name: string } | null }[]) => {
        if (!cancelled) setNames(rows.map((r) => r.user?.name).filter((n): n is string => !!n))
      })
      .catch(() => { if (!cancelled) setNames([]) })
    return () => { cancelled = true }
  }, [request, fundingSourceId])

  if (names === null) return null
  if (!names.length) {
    return <p className="text-[11px] text-amber-600">No custodian assigned to this fund yet — an admin needs to assign one before it can be paid.</p>
  }
  return <p className="text-[11px] text-gray-500">Paid by: <span className="text-gray-700">{names.join(', ')}</span></p>
}
