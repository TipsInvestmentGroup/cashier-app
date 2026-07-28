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

const DIGITAL_TYPE_CODE = 'DIGITAL_EXPENSE_REQUEST'

interface RequestType { id: string; code: string; name: string; allowedCategoryIds: string | null; isActive: boolean }
interface Category { id: string; name: string; isActive: boolean }
interface ExpenseRequest {
  id: string; purpose: string; amount: number; currency: string; status: string; createdAt: string
  requestedById: string; requestType: { id: string; name: string }; category: { id: string; name: string }
  fieldValues?: { fieldKey: string; value: string }[]
}

const STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber' | 'indigo' | 'blue' | 'purple'> = {
  DRAFT: 'gray', PENDING_APPROVAL: 'amber', APPROVED: 'blue', REJECTED: 'red',
  PARTIALLY_PAID: 'indigo', PAID: 'indigo', VERIFIED: 'purple', CLOSED: 'green', CANCELLED: 'gray',
}

export default function DigitalExpensesPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<ExpenseRequest[]>([])
  const [requestType, setRequestType] = useState<RequestType | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [types, cats, users] = await Promise.all([
        request('/api/expense/request-types'), request('/api/expense/categories'), request('/api/users').catch(() => []),
      ])
      const type = (types || []).find((t: RequestType) => t.code === DIGITAL_TYPE_CODE && t.isActive) || null
      setRequestType(type)
      setCategories((cats || []).filter((c: Category) => c.isActive))
      setNames(Object.fromEntries((users || []).map((u: { id: string; name: string }) => [u.id, u.name])))
      if (type) {
        const all: ExpenseRequest[] = await request('/api/expense/requests')
        setItems(all.filter((r) => r.requestType.id === type.id))
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const resetForm = () => { setCategoryId(''); setAmount(''); setFieldValues({}) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!requestType) return toast.error('Digital Expense Request type is not configured — ask an admin to run the expense seed')
    if (!categoryId) return toast.error('Select a category')
    const finalAmount = Number(amount)
    if (!finalAmount || finalAmount <= 0) return toast.error('Amount must be greater than zero')
    const purpose = fieldValues.paymentReason || fieldValues.payeeName || 'Digital expense'

    setSubmitting(true)
    try {
      const created = await request('/api/expense/requests', {
        method: 'POST',
        body: JSON.stringify({ requestTypeId: requestType.id, categoryId, purpose, amount: finalAmount, fieldValues }),
      })
      await request(`/api/expense/requests/${created.id}/submit`, { method: 'POST' })
      toast.success('Digital expense submitted!')
      resetForm(); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error submitting request') }
    finally { setSubmitting(false) }
  }

  const total = items.reduce((s, i) => s + i.amount, 0)

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Digital Expenses</h1>
          <p className="text-gray-500 text-sm">A simple, independent form for expenses paid electronically — fields are admin-configurable in Expense Settings, not hardcoded.</p>
        </div>

        {!loading && !requestType && (
          <EmptyState icon="⚠️" title="Digital Expense Request type not found" hint="Ask an admin to run the expense framework seed, or create a request type coded DIGITAL_EXPENSE_REQUEST in Expense Settings." />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow w-fit">
              <p className="text-indigo-100 text-xs">Total ({items.length})</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Requested By</th>
                        <th className="px-4 py-3 font-semibold">Payee</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {items.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => (window.location.href = `/expense-requests/${i.id}`)}>
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.createdAt)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{i.requestedById === user?.id ? 'You' : (names[i.requestedById] || '—')}</td>
                          <td className="px-4 py-3 text-gray-700">
                            <Link href={`/expense-requests/${i.id}`} className="text-indigo-600 hover:text-indigo-800" onClick={(e) => e.stopPropagation()}>
                              {i.fieldValues?.find((f) => f.fieldKey === 'payeeName')?.value || i.purpose}
                            </Link>
                          </td>
                          <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-3"><Badge tone={STATUS_TONE[i.status] || 'gray'}>{i.status.replace('_', ' ')}</Badge></td>
                        </tr>
                      ))}
                      {items.length === 0 && (
                        <tr><td colSpan={5}><EmptyState icon="💳" title="No digital expenses yet" hint="Submit one with the form on the right." /></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:sticky lg:top-4">
              <h2 className="text-lg font-bold text-gray-800 mb-1">💳 New Digital Expense</h2>
              <p className="text-xs text-gray-400 mb-4">Paid via bank, mobile money, or card.</p>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Category *</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required>
                    <option value="">Select category…</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                {requestType && <ExpenseDynamicFields requestTypeId={requestType.id} values={fieldValues} onChange={setFieldValues} />}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount *</label>
                  <MoneyInput value={amount} onChange={setAmount} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
                </div>

                <Button type="submit" size="lg" disabled={submitting || !requestType} className="w-full">
                  {submitting ? 'Submitting…' : 'Submit'}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
