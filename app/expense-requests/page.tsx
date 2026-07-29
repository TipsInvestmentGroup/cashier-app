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
import toast from 'react-hot-toast'

interface RequestType { id: string; name: string; allowedCategoryIds: string | null; isActive: boolean }
interface Category { id: string; name: string; isActive: boolean }
interface ExpenseItem { id?: string; detail: string; unit: number; unitCost: number; amount: number }
interface ExpenseRequest {
  id: string; purpose: string; amount: number; currency: string; status: string; createdAt: string
  requestedById: string; requestType: { id: string; name: string }; category: { id: string; name: string }
  items: ExpenseItem[]; _count?: { paymentAllocations: number }
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
      const [its, types, cats, users] = await Promise.all([
        request('/api/expense/requests'), request('/api/expense/request-types'), request('/api/expense/categories'),
        request('/api/users').catch(() => []),
      ])
      setItems(its || [])
      setRequestTypes((types || []).filter((t: RequestType) => t.isActive))
      setCategories((cats || []).filter((c: Category) => c.isActive))
      setNames(Object.fromEntries((users || []).map((u: { id: string; name: string }) => [u.id, u.name])))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const selectedType = requestTypes.find((t) => t.id === requestTypeId)
  const allowedCategoryIds = selectedType ? parseIdList(selectedType.allowedCategoryIds) : null
  const availableCategories = allowedCategoryIds ? categories.filter((c) => allowedCategoryIds.includes(c.id)) : categories

  const addItem = () => setLineItems([...lineItems, { detail: '', unit: '1', unitCost: '' }])
  const updItem = (i: number, patch: Partial<{ detail: string; unit: string; unitCost: string }>) => setLineItems(lineItems.map((r, x) => (x === i ? { ...r, ...patch } : r)))
  const rmItem = (i: number) => setLineItems(lineItems.filter((_, x) => x !== i))

  const resetForm = () => { setRequestTypeId(''); setCategoryId(''); setPurpose(''); setAmount(''); setLineItems([]); setFieldValues({}) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requestTypeId) return toast.error('Select a request type')
    if (!categoryId) return toast.error('Select a category')
    if (!purpose.trim()) return toast.error('Purpose is required')
    const cleanItems = lineItems.filter((r) => r.detail.trim() || Number(r.unitCost) > 0)
      .map((r) => ({ detail: r.detail.trim() || 'Item', unit: Number(r.unit) || 1, unitCost: Number(r.unitCost) || 0, amount: itemRowAmount(r) }))
    const finalAmount = cleanItems.length ? itemsTotal : Number(amount)
    if (!finalAmount || finalAmount <= 0) return toast.error('Amount must be > 0 (enter an amount or add items)')

    setSubmitting(true)
    try {
      const created = await request('/api/expense/requests', { method: 'POST', body: JSON.stringify({ requestTypeId, categoryId, purpose, amount: finalAmount, items: cleanItems, fieldValues }) })
      await request(`/api/expense/requests/${created.id}/submit`, { method: 'POST' })
      toast.success('Request submitted!')
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
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Requested By</th>
                        <th className="px-4 py-3 font-semibold">Type / Category</th>
                        <th className="px-4 py-3 font-semibold">Purpose</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => (window.location.href = `/expense-requests/${i.id}`)}>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{i.requestedById === user?.id ? 'You' : (names[i.requestedById] || '—')}</td>
                          <td className="px-4 py-3 text-gray-500">{i.requestType.name}<span className="block text-[11px] text-gray-400">{i.category.name}</span></td>
                          <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={i.purpose}>
                            <Link href={`/expense-requests/${i.id}`} className="text-indigo-600 hover:text-indigo-800" onClick={(e) => e.stopPropagation()}>{i.purpose}</Link>
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-3"><Badge tone={STATUS_TONE[i.status] || 'gray'}>{i.status.replace('_', ' ')}</Badge></td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={6}><EmptyState icon="🧾" title="No expense requests" hint="Submit one with the form on the right." /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: New Expense Request form */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:sticky lg:top-4">
              <h2 className="text-lg font-bold text-gray-800 mb-1">🧾 New Expense Request</h2>
              <p className="text-xs text-gray-400 mb-4">Choose a request type — its allowed categories, approval, and budget rules all follow from that.</p>
              <form onSubmit={submit} className="space-y-3">
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
