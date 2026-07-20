'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import toast from 'react-hot-toast'

interface EligibleGrn {
  id: string; grnNumber: string; supplierName: string; receivedDate: string
  needsCosting: boolean; itemCount: number; estimatedTotal: number; supplierId: string | null
}
interface Supplier { id: string; name: string }
interface Invoice {
  id: string; invoiceNumber: string; supplierInvoiceRef: string | null; invoiceDate: string; dueDate: string | null
  total: number; amountPaid: number; status: string
  supplier: { id: string; name: string }; grn: { grnNumber: string } | null
}
interface Channel { id: string; label: string; glAccountId: string | null }

const AGING_TONE: Record<string, 'green' | 'amber' | 'red'> = { OPEN: 'amber', PARTIALLY_PAID: 'amber', PAID: 'green' }

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000))
}

export default function AccountsPayablePage() {
  const { request } = useApi()
  const [grns, setGrns] = useState<EligibleGrn[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)

  const [invoicingGrn, setInvoicingGrn] = useState<EligibleGrn | null>(null)
  const [invSupplierId, setInvSupplierId] = useState('')
  const [invRef, setInvRef] = useState('')
  const [invDate, setInvDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [invSubtotal, setInvSubtotal] = useState('')
  const [invVat, setInvVat] = useState('')

  const [payingSupplier, setPayingSupplier] = useState<Supplier | null>(null)
  const [payChannelId, setPayChannelId] = useState('')
  const [payAllocations, setPayAllocations] = useState<Record<string, string>>({})
  const [payReference, setPayReference] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, inv, sup, ch] = await Promise.all([
        request('/api/finance/eligible-grns'),
        request('/api/finance/supplier-invoices'),
        request('/api/inventory/suppliers'),
        request('/api/payment-channels'),
      ])
      setGrns(g || []); setInvoices(inv || []); setSuppliers(sup?.suppliers || []); setChannels(ch || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const openInvoiceModal = (grn: EligibleGrn) => {
    setInvoicingGrn(grn); setInvSupplierId(grn.supplierId || '')
    setInvRef(''); setInvDate(new Date().toISOString().slice(0, 10))
    setInvSubtotal(grn.estimatedTotal ? String(grn.estimatedTotal) : ''); setInvVat('')
  }

  const submitInvoice = async () => {
    if (!invoicingGrn || !invSupplierId || !invDate) return toast.error('Select a supplier and date')
    const subtotal = Number(invSubtotal) || 0
    const vatAmount = Number(invVat) || 0
    const total = subtotal + vatAmount
    if (!(total > 0)) return toast.error('Enter the invoice amount')
    try {
      await request('/api/finance/supplier-invoices', {
        method: 'POST',
        body: JSON.stringify({ grnId: invoicingGrn.id, supplierId: invSupplierId, supplierInvoiceRef: invRef || null, invoiceDate: invDate, subtotal, vatAmount, total }),
      })
      toast.success('Supplier invoice raised'); setInvoicingGrn(null); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not raise invoice') }
  }

  const supplierOpenInvoices = (supplierId: string) => invoices.filter((i) => i.supplier.id === supplierId && i.status !== 'PAID' && i.status !== 'CANCELLED')

  const openPayModal = (supplier: Supplier) => {
    setPayingSupplier(supplier); setPayChannelId(''); setPayReference(''); setPayAllocations({})
  }

  const payTotal = Object.values(payAllocations).reduce((s, v) => s + (Number(v) || 0), 0)

  const submitPayment = async () => {
    if (!payingSupplier || !payChannelId) return toast.error('Select a payment channel')
    const allocations = Object.entries(payAllocations).filter(([, v]) => Number(v) > 0).map(([supplierInvoiceId, amount]) => ({ supplierInvoiceId, amount: Number(amount) }))
    if (!allocations.length) return toast.error('Enter at least one payment amount')
    try {
      await request('/api/finance/supplier-payments', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: payingSupplier.id, paymentChannelId: payChannelId, amount: payTotal,
          paymentDate: new Date().toISOString(), reference: payReference || null, allocations,
        }),
      })
      toast.success('Payment recorded'); setPayingSupplier(null); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not record payment') }
  }

  const supplierIdsWithOpen = Array.from(new Set(invoices.filter((i) => i.status !== 'PAID' && i.status !== 'CANCELLED').map((i) => i.supplier.id)))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts Payable</h1>
          <p className="text-gray-500 text-sm">GRNs waiting for a supplier invoice, open balances, and supplier payments</p>
        </div>

        <Card>
          <CardHeader title="GRNs awaiting a supplier invoice" subtitle="Raising an invoice formalizes the accrual posted when the GRN was received" />
          {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : grns.length === 0 ? (
            <EmptyState icon="✅" title="Nothing pending" hint="Every received GRN has a supplier invoice" />
          ) : (
            <div className="divide-y divide-gray-50">
              {grns.map((g) => (
                <div key={g.id} className="flex items-center gap-3 py-2.5">
                  <span className="font-mono text-xs text-gray-400 w-28">{g.grnNumber}</span>
                  <span className="flex-1 text-sm text-gray-800">{g.supplierName}</span>
                  <span className="text-xs text-gray-400">{formatDate(g.receivedDate)}</span>
                  {g.needsCosting && <Badge tone="amber">Needs costing</Badge>}
                  <button onClick={() => openInvoiceModal(g)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700">Raise Invoice</button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Supplier invoices" subtitle="Open balances by supplier — pay partially or in full" />
          {invoices.length === 0 ? <EmptyState icon="🧾" title="No supplier invoices yet" /> : (
            <div className="divide-y divide-gray-50">
              {invoices.map((inv) => {
                const outstanding = inv.total - inv.amountPaid
                const overdue = daysOverdue(inv.dueDate)
                return (
                  <div key={inv.id} className="flex items-center gap-3 py-2.5">
                    <span className="font-mono text-xs text-gray-400 w-24">{inv.invoiceNumber}</span>
                    <span className="flex-1 text-sm text-gray-800">{inv.supplier.name}</span>
                    <span className="text-xs text-gray-400 w-24">{inv.grn?.grnNumber || '—'}</span>
                    <span className="text-sm font-medium text-gray-700 w-24 text-right">{formatCurrency(outstanding)}</span>
                    {inv.status !== 'PAID' && overdue > 0 && <Badge tone="red">{overdue}d overdue</Badge>}
                    <Badge tone={AGING_TONE[inv.status] || 'gray'}>{inv.status.replace('_', ' ')}</Badge>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Pay a supplier" />
          {supplierIdsWithOpen.length === 0 ? <EmptyState icon="💳" title="No open balances" /> : (
            <div className="flex flex-wrap gap-2">
              {supplierIdsWithOpen.map((id) => {
                const s = suppliers.find((x) => x.id === id) || invoices.find((i) => i.supplier.id === id)?.supplier
                if (!s) return null
                return (
                  <button key={id} onClick={() => openPayModal(s)} className="px-3 py-2 bg-gray-50 border border-gray-200 text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-100">
                    {s.name}
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {invoicingGrn && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md space-y-3">
            <h2 className="font-semibold text-gray-800">Raise Invoice — GRN {invoicingGrn.grnNumber}</h2>
            <select value={invSupplierId} onChange={(e) => setInvSupplierId(e.target.value)} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Select supplier…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={invRef} onChange={(e) => setInvRef(e.target.value)} placeholder="Supplier's invoice number"
              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)}
              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <div className="flex gap-2">
              <input type="number" value={invSubtotal} onChange={(e) => setInvSubtotal(e.target.value)} placeholder="Subtotal"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <input type="number" value={invVat} onChange={(e) => setInvVat(e.target.value)} placeholder="VAT"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <p className="text-xs text-gray-400">Total: {formatCurrency((Number(invSubtotal) || 0) + (Number(invVat) || 0))}</p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setInvoicingGrn(null)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={submitInvoice} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Raise Invoice</button>
            </div>
          </div>
        </div>
      )}

      {payingSupplier && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md space-y-3">
            <h2 className="font-semibold text-gray-800">Pay {payingSupplier.name}</h2>
            <select value={payChannelId} onChange={(e) => setPayChannelId(e.target.value)} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Payment channel…</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.label}{!c.glAccountId ? ' (no GL account mapped)' : ''}</option>)}
            </select>
            <input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="Reference (optional)"
              className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {supplierOpenInvoices(payingSupplier.id).map((inv) => {
                const outstanding = inv.total - inv.amountPaid
                return (
                  <div key={inv.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 text-sm text-gray-700">{inv.invoiceNumber} <span className="text-gray-400">({formatCurrency(outstanding)} due)</span></span>
                    <input type="number" placeholder="0" value={payAllocations[inv.id] || ''}
                      onChange={(e) => setPayAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))}
                      className="w-28 px-2 py-1.5 border-2 border-gray-200 rounded-lg text-sm text-right focus:border-indigo-500 focus:outline-none" />
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400">Total to pay: {formatCurrency(payTotal)}</p>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setPayingSupplier(null)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={submitPayment} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Record Payment</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
