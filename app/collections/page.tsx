'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { BillSelector, BillLite } from '@/components/BillSelector'
import { MoneyInput } from '@/components/MoneyInput'
import toast from 'react-hot-toast'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'

type RangeKey = 'today' | 'week' | 'month' | 'custom'
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

interface Cancellation {
  id: string; reason: string; productId?: string | null; productName: string
  sellingPrice: number; quantity: number; amount: number; status?: string
}
interface Collection {
  id: string; date: string; cash: number; crdb: number; stanbic: number; mpesa: number; total: number
  staffName?: string; systemSales?: number; creditSales?: number; paymentsReceived?: number; discount?: number; discountReason?: string
  notes: string; outletId?: string; outlet: { id?: string; name: string }; cashier: { name: string }; cancellations?: Cancellation[]
}
interface Product { id: string; code: string; name: string; sellingPrice: number; isActive: boolean }
interface SignedBill { id: string; personName: string; amount: number; billType: string; status: string; seq?: number; date?: string }
// signed-bill type → paid-bill category label
const BILLTYPE_TO_CATEGORY: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', STAFF_LOSS: 'Staff Loss', TIPS: 'Sponsors & Partners' }
// Cash the staff must physically hand over = System Sales − digital channels
const cashRequired = (c: { systemSales?: number; crdb: number; stanbic: number; mpesa: number }) =>
  (c.systemSales || 0) - c.crdb - c.stanbic - c.mpesa
const CANCEL_REASONS = ['Double Punch', 'Out of Stock', 'Wrong Punch']
// Staff Loss = System Sales − Collection − Signed Bills (credit sales) − Paid Bills
const rowLoss = (c: { systemSales?: number; total: number; creditSales?: number; paymentsReceived?: number }) =>
  (c.systemSales || 0) - c.total - (c.creditSales || 0) - (c.paymentsReceived || 0)
interface Outlet { id: string; name: string }
interface Person { id: string; name: string; type: string }

interface NamedCode { code: string; label: string; isActive: boolean }

export default function CollectionsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [collections, setCollections] = useState<Collection[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  const [personNames, setPersonNames] = useState<string[]>([])
  const [signedRows, setSignedRows] = useState<{ billType: string; name: string; amount: string }[]>([])
  const [paidRows, setPaidRows] = useState<{ category: string; payerName: string; amount: string; paymentMethod: string; signedBillId: string; linkQuery: string; selectedBillIds: string[] }[]>([])
  const [signedBillsList, setSignedBillsList] = useState<SignedBill[]>([])
  const [linkOpenIdx, setLinkOpenIdx] = useState<number | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [cancelRows, setCancelRows] = useState<{ reason: string; productId: string; productName: string; sellingPrice: number; quantity: string }[]>([])
  const [allPersons, setAllPersons] = useState<Person[]>([])
  const [categories, setCategories] = useState<NamedCode[]>([])
  const [channels, setChannels] = useState<NamedCode[]>([])
  const PAID_CATEGORIES = categories.filter((c) => c.isActive).map((c) => c.label)
  const SIGNED_TYPE_OPTS = categories.filter((c) => c.isActive)
  const METHOD_OPTS = channels.filter((c) => c.isActive)
  const labelToCode = (label: string) => categories.find((c) => c.label === label)?.code || label
  const codeToLabelCat = (code: string) => categories.find((c) => c.code === code)?.label || BILLTYPE_TO_CATEGORY[code] || code
  const [confirmedZero, setConfirmedZero] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [closedDays, setClosedDays] = useState<string[]>([]) // start-of-day ISO strings
  const [closingDay, setClosingDay] = useState(false)

  const [form, setForm] = useState({
    cash: '', crdb: '', stanbic: '', mpesa: '', notes: '', staffName: '', systemSales: '',
    discount: '', discountReason: '',
    outletId: user?.outlet?.id || '', date: format(new Date(), 'yyyy-MM-dd'),
  })

  const total = (Number(form.cash) || 0) + (Number(form.crdb) || 0) +
    (Number(form.stanbic) || 0) + (Number(form.mpesa) || 0)

  // Cash required from staff = System Sales − (CRDB + Stanbic + M-PESA)
  const cashRequiredForm = (Number(form.systemSales) || 0) - (Number(form.crdb) || 0) - (Number(form.stanbic) || 0) - (Number(form.mpesa) || 0)
  const cancelTotalForm = cancelRows.reduce((s, r) => s + (r.sellingPrice * (Number(r.quantity) || 0)), 0)

  // Reconciliation: Staff Loss = System − Collection − Signed Bills − Paid Bills (Staff Loss only) − Discount
  const signedTotalForm = signedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const paidTotalForm = paidRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const paidStaffLossForm = paidRows.reduce((s, r) => s + (r.category === 'Staff Loss' ? (Number(r.amount) || 0) : 0), 0)
  const discountForm = Number(form.discount) || 0
  const lossPreview = (Number(form.systemSales) || 0) - total - signedTotalForm - paidStaffLossForm - discountForm
  const hasSigned = signedRows.some((r) => r.name && Number(r.amount) > 0)
  const hasPaid = paidRows.some((r) => r.payerName && Number(r.amount) > 0)
  // Save gate: for a new collection the cashier must record signed/paid bills OR confirm there are none.
  const reconciled = !!editingId || hasSigned || hasPaid || confirmedZero

  const load = useCallback(async () => {
    setLoading(true)
    const [cols, outs, persons, prods, sbs, cats, chs, closures] = await Promise.all([
      request('/api/collections'),
      request('/api/outlets'),
      request('/api/persons'),
      request('/api/products'),
      request('/api/signed-bills?status=UNPAID'),
      request('/api/person-categories'),
      request('/api/payment-channels'),
      request('/api/collections/close-day').catch(() => ({ closedDays: [] })),
    ])
    setCollections(cols)
    setClosedDays(closures?.closedDays || [])
    setOutlets(outs)
    setProducts((prods || []).filter((p: Product) => p.isActive))
    setSignedBillsList((sbs || []).filter((b: SignedBill) => b.status !== 'PAID'))
    setCategories(cats || [])
    setChannels(chs || [])
    const all: Person[] = persons || []
    setAllPersons(all)
    setStaff(all.filter((p) => p.type === 'STAFF_LOSS').sort((a, b) => a.name.localeCompare(b.name)))
    setPersonNames(all.map((p) => p.name).sort((a, b) => a.localeCompare(b)))
    if (outs.length && !form.outletId) setForm((f) => ({ ...f, outletId: outs[0].id }))
    setLoading(false)
  }, [request])

  useEffect(() => { load() }, [load])

  // Searchable signed-bill linker for a paid row
  const billLabel = (b: SignedBill) => `${b.date ? format(parseISO(b.date), 'dd MMM yyyy') : ''} · #${b.seq ?? '?'} — ${b.personName} — ${formatCurrency(b.amount)} [${b.billType.replace('_', ' ')}]`
  const selectBillForRow = (i: number, b: SignedBill | null) => {
    const n = [...paidRows]
    const r = n[i]
    if (!b) { n[i] = { ...r, signedBillId: '', linkQuery: '', selectedBillIds: [] }; setPaidRows(n); setLinkOpenIdx(null); return }
    n[i] = {
      ...r, signedBillId: b.id, linkQuery: billLabel(b), selectedBillIds: [b.id],
      payerName: r.payerName || b.personName,
      amount: r.amount || String(b.amount),
      category: codeToLabelCat(b.billType),
    }
    setPaidRows(n); setLinkOpenIdx(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (total === 0) return toast.error('Enter at least one amount')
    if (!reconciled) return toast.error('Record signed bills & payments, or tick "No other bills" to confirm none.')
    setSubmitting(true)
    try {
      const signedBills = signedRows.filter((r) => r.name && Number(r.amount) > 0).map((r) => ({ billType: r.billType, name: r.name, amount: Number(r.amount) }))
      const paidBills = paidRows.filter((r) => r.payerName && Number(r.amount) > 0).map((r) => ({ payerName: r.payerName, amount: Number(r.amount), paymentMethod: r.paymentMethod, category: r.category, categoryBillType: labelToCode(r.category), signedBillId: r.signedBillId || undefined, selectedBillIds: r.selectedBillIds }))
      const cancellations = cancelRows.filter((r) => r.productName && Number(r.quantity) > 0).map((r) => ({
        reason: r.reason, productId: r.productId || undefined, productName: r.productName,
        sellingPrice: r.sellingPrice, quantity: Number(r.quantity), amount: r.sellingPrice * (Number(r.quantity) || 0),
      }))
      const payload = JSON.stringify({ ...form, cash: Number(form.cash) || 0, crdb: Number(form.crdb) || 0, stanbic: Number(form.stanbic) || 0, mpesa: Number(form.mpesa) || 0, signedBills, paidBills, cancellations })
      const res = editingId
        ? await request(`/api/collections/${editingId}`, { method: 'PUT', body: payload })
        : await request('/api/collections', { method: 'POST', body: payload })
      if (res?.staffLoss) {
        toast.success(`Saved. Staff loss of ${formatCurrency(res.staffLoss.amount)} for ${res.staffLoss.staffName} → Payroll Deductions.`, { duration: 6000 })
      } else {
        toast.success(editingId ? 'Collection updated!' : 'Collection saved — balanced, no loss.')
      }
      setForm({ cash: '', crdb: '', stanbic: '', mpesa: '', notes: '', staffName: '', systemSales: '', discount: '', discountReason: '', outletId: form.outletId, date: format(new Date(), 'yyyy-MM-dd') })
      setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false)
      setEditingId(null)
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving')
    } finally {
      setSubmitting(false)
    }
  }

  const canAdd = ['CASHIER', 'ACCOUNTANT', 'ADMIN'].includes(user?.role || '')
  // Cashiers work one outlet and report as themselves — hide the redundant Outlet/By columns on screen.
  const isCashier = user?.role === 'CASHIER'

  const startEdit = (c: Collection & { outletId?: string }) => {
    setEditingId(c.id)
    setForm({
      cash: c.cash ? String(c.cash) : '',
      crdb: c.crdb ? String(c.crdb) : '',
      stanbic: c.stanbic ? String(c.stanbic) : '',
      mpesa: c.mpesa ? String(c.mpesa) : '',
      notes: c.notes || '',
      staffName: c.staffName || '',
      systemSales: c.systemSales ? String(c.systemSales) : '',
      discount: c.discount ? String(c.discount) : '',
      discountReason: c.discountReason || '',
      outletId: c.outletId || outlets.find((o) => o.name === c.outlet.name)?.id || form.outletId,
      date: format(parseISO(c.date), 'yyyy-MM-dd'),
    })
    setSignedRows([]); setPaidRows([])
    setCancelRows((c.cancellations || []).map((cn) => ({
      reason: cn.reason || CANCEL_REASONS[0], productId: cn.productId || '', productName: cn.productName,
      sellingPrice: cn.sellingPrice, quantity: String(cn.quantity),
    })))
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const newCollection = () => {
    setEditingId(null)
    setForm({ cash: '', crdb: '', stanbic: '', mpesa: '', notes: '', staffName: '', systemSales: '', discount: '', discountReason: '', outletId: form.outletId, date: format(new Date(), 'yyyy-MM-dd') })
    setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false)
    setShowForm((s) => !s)
  }

  const deleteCollection = async (c: Collection) => {
    if (!window.confirm(`Delete this collection${c.staffName ? ` for ${c.staffName}` : ''}? Any auto staff-loss linked to it will also be removed.`)) return
    try {
      const res = await request(`/api/collections/${c.id}`, { method: 'DELETE' })
      toast.success(res?.removedStaffLoss ? 'Collection + linked staff loss deleted' : 'Collection deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting')
    }
  }

  // Compute active date interval from the selected range
  const getInterval = (): { start: Date; end: Date } => {
    const now = new Date()
    switch (range) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) }
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) }
      case 'custom':
        return { start: startOfDay(parseISO(customFrom)), end: endOfDay(parseISO(customTo)) }
    }
  }
  const interval = getInterval()
  const filtered = collections.filter((c) => {
    try {
      return isWithinInterval(parseISO(c.date), interval)
    } catch {
      return false
    }
  })

  // Totals across the filtered records
  const totals = filtered.reduce(
    (acc, c) => ({
      cash: acc.cash + c.cash,
      crdb: acc.crdb + c.crdb,
      stanbic: acc.stanbic + c.stanbic,
      mpesa: acc.mpesa + c.mpesa,
      total: acc.total + c.total,
      systemSales: acc.systemSales + (c.systemSales || 0),
      creditSales: acc.creditSales + (c.creditSales || 0),
      paymentsReceived: acc.paymentsReceived + (c.paymentsReceived || 0),
    }),
    { cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0, systemSales: 0, creditSales: 0, paymentsReceived: 0 }
  )
  // Net loss across the period (full formula): System − Collection − Signed − Paid
  const variance = totals.systemSales - totals.total - totals.creditSales - totals.paymentsReceived
  // Split per-row so shortfalls (→ staff loss) and overages are tracked separately
  const { shortfall: totalShortfall, overage: totalOverage } = filtered.reduce(
    (a, c) => {
      if ((c.systemSales || 0) <= 0) return a
      const v = rowLoss(c)
      if (v > 0) a.shortfall += v
      else if (v < 0) a.overage += -v
      return a
    },
    { shortfall: 0, overage: 0 }
  )
  // Cancellations recorded in the period — count everything except rejected,
  // matching the Cashier Daily Report (which includes pending cancellations).
  const cancelTotalPeriod = filtered.reduce((s, c) => s + (c.cancellations || []).filter((x) => x.status !== 'REJECTED').reduce((a, x) => a + (x.amount || 0), 0), 0)

  // ---- Close the Day (lock a day so it can't be edited/deleted) ----
  // Key by calendar date (yyyy-MM-dd). Stored timestamps are UTC-anchored to the
  // form date, so slicing a record's ISO string matches a user-picked local date.
  const dayKey = (d: string | Date) => typeof d === 'string' ? d.slice(0, 10) : format(d, 'yyyy-MM-dd')
  const isDayClosed = (d: string | Date) => closedDays.includes(dayKey(d))
  // The day the button acts on: the chosen single day (custom) or today.
  const targetCloseDate = range === 'custom' && customFrom === customTo ? parseISO(customFrom) : new Date()
  const targetClosed = isDayClosed(targetCloseDate)
  const canReopen = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR'].includes(user?.role || '')

  // Outlets that have records on the target day (so we close the right one even
  // when the logged-in account has no fixed outlet, e.g. an admin / all-outlets).
  const targetDayStr = format(targetCloseDate, 'yyyy-MM-dd')
  const targetOutletIds = (() => {
    const ids = [...new Set(filtered.filter((c) => dayKey(c.date) === targetDayStr).map((c) => c.outletId).filter(Boolean) as string[])]
    if (ids.length === 0 && user?.outlet?.id) ids.push(user.outlet.id)
    return ids
  })()

  const closeDay = async () => {
    const label = format(targetCloseDate, 'dd MMM yyyy')
    if (targetOutletIds.length === 0) { toast.error('No collections found for this day to close.'); return }
    if (!window.confirm(`Close the day for ${label}?\n\nAfter closing, this day's collections can no longer be added, edited or deleted. A supervisor can reopen it if needed.`)) return
    setClosingDay(true)
    try {
      for (const outletId of targetOutletIds) {
        await request('/api/collections/close-day', { method: 'POST', body: JSON.stringify({ date: targetDayStr, outletId }) })
      }
      toast.success(`Day closed — ${label} is now locked.`)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not close the day')
    } finally { setClosingDay(false) }
  }

  const reopenDay = async () => {
    const label = format(targetCloseDate, 'dd MMM yyyy')
    const ids = targetOutletIds.length ? targetOutletIds : (user?.outlet?.id ? [user.outlet.id] : [])
    if (ids.length === 0) { toast.error('No outlet to reopen for this day.'); return }
    if (!window.confirm(`Reopen ${label}? Cashiers will be able to edit this day's collections again.`)) return
    setClosingDay(true)
    try {
      for (const outletId of ids) {
        await request(`/api/collections/close-day?date=${targetDayStr}&outletId=${outletId}`, { method: 'DELETE' })
      }
      toast.success(`Day reopened — ${label}.`)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not reopen the day')
    } finally { setClosingDay(false) }
  }

  // Header summary (cashier view): derive real outlet/reporter from the records,
  // falling back to the logged-in user when the period has no rows yet.
  const headerOutlet = [...new Set(filtered.map((c) => c.outlet?.name).filter(Boolean))].join(', ') || user?.outlet?.name || 'Outlet'
  const headerBy = [...new Set(filtered.map((c) => c.cashier?.name).filter(Boolean))].join(', ') || user?.name || '—'

  // ---- Exports (always include Outlet & By, regardless of on-screen columns) ----
  const rangeLabel = RANGE_OPTIONS.find((r) => r.key === range)?.label || 'Collections'
  const exportName = `tips-collections-${range}-${format(new Date(), 'yyyy-MM-dd')}`
  const reqCash = (c: { systemSales?: number; crdb: number; stanbic: number; mpesa: number }) => cashRequired(c)

  const exportCsv = () => {
    if (!filtered.length) return toast.error('Nothing to export')
    const headers = ['Date', 'Outlet', 'Staff', 'Cash', 'CRDB', 'Stanbic', 'M-PESA', 'Total', 'System', 'Cash Req', 'Variance', 'By']
    const dataRows = filtered.map((c) => {
      const v = rowLoss(c)
      return [formatDateTime(c.date), c.outlet.name, c.staffName || '', c.cash, c.crdb, c.stanbic, c.mpesa, c.total, c.systemSales || 0, reqCash(c), v, c.cashier.name]
    })
    dataRows.push(['TOTAL', '', '', totals.cash, totals.crdb, totals.stanbic, totals.mpesa, totals.total, totals.systemSales, totals.systemSales - totals.crdb - totals.stanbic - totals.mpesa, variance, ''])
    const csv = [headers, ...dataRows]
      .map((r) => r.map((cell) => { const s = String(cell ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(','))
      .join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${exportName}.csv`; a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV downloaded')
  }

  const exportPdf = async () => {
    if (!filtered.length) return toast.error('Nothing to export')
    try {
      const { jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF({ orientation: 'landscape' })
      const W = doc.internal.pageSize.getWidth()
      const n = (x: number) => Number(x || 0).toLocaleString('en-US')
      doc.setFillColor(79, 70, 229); doc.rect(0, 0, W, 24, 'F')
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.text('tips — Daily Collections', 14, 12)
      doc.setFontSize(10); doc.setFont('helvetica', 'normal')
      doc.text(`${rangeLabel} · Generated ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, 19)
      doc.setTextColor(31, 41, 55)
      autoTable(doc, {
        startY: 30,
        head: [['Date', 'Outlet', 'Staff', 'Cash', 'CRDB', 'Stanbic', 'M-PESA', 'Total', 'System', 'Cash Req', 'Variance', 'By']],
        body: filtered.map((c) => {
          const v = rowLoss(c)
          return [formatDateTime(c.date), c.outlet.name, c.staffName || '-', n(c.cash), n(c.crdb), n(c.stanbic), n(c.mpesa), n(c.total), n(c.systemSales || 0), n(reqCash(c)), `${v > 0 ? '-' : v < 0 ? '+' : ''}${n(Math.abs(v))}`, c.cashier.name]
        }),
        foot: [['TOTAL', '', '', n(totals.cash), n(totals.crdb), n(totals.stanbic), n(totals.mpesa), n(totals.total), n(totals.systemSales), n(totals.systemSales - totals.crdb - totals.stanbic - totals.mpesa), n(Math.abs(variance)), '']],
        headStyles: { fillColor: [79, 70, 229] },
        footStyles: { fillColor: [238, 242, 255], textColor: [31, 41, 55], fontStyle: 'bold' },
        styles: { fontSize: 8 },
        margin: { left: 10, right: 10 },
      })
      doc.save(`${exportName}.pdf`)
      toast.success('PDF downloaded')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not build PDF')
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Collections</h1>
            <p className="text-gray-500 text-sm">Record cash, bank & M-PESA collections</p>
          </div>
          {canAdd && (
            <button onClick={newCollection} disabled={isCashier && isDayClosed(new Date())}
              title={isCashier && isDayClosed(new Date()) ? 'Today is closed — ask a supervisor to reopen it' : ''}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow disabled:opacity-50">
              <span className="text-lg">+</span> New Collection
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">{editingId ? 'Edit Collection' : 'Record Daily Collection'}</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                  <select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Staff + System (POS) sales */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">👤 Staff (collected from)</label>
                  <select value={form.staffName} onChange={(e) => {
                    const ns = e.target.value
                    // keep paid-bill payers in sync with the collecting staff
                    setPaidRows((rows) => rows.map((r) => (!r.payerName || r.payerName === form.staffName) ? { ...r, payerName: ns } : r))
                    setForm({ ...form, staffName: ns })
                  }}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                    <option value="">-- Select staff --</option>
                    {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">🧾 System Sales (TZS)</label>
                  <MoneyInput placeholder="0"
                    value={form.systemSales} onChange={(v) => setForm({ ...form, systemSales: v })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-medium" />
                  <p className="text-xs text-gray-400 mt-1">What the POS/system says this staff sold</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'cash', label: '💵 Cash', placeholder: '0' },
                  { key: 'crdb', label: '🏦 CRDB Bank', placeholder: '0' },
                  { key: 'stanbic', label: '🏛️ Stanbic', placeholder: '0' },
                  { key: 'mpesa', label: '📱 M-PESA', placeholder: '0' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
                    <MoneyInput placeholder={placeholder}
                      value={form[key as keyof typeof form] as string}
                      onChange={(v) => setForm({ ...form, [key]: v })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-medium" />
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="bg-indigo-50 rounded-xl p-4 flex items-center justify-between">
                <span className="font-semibold text-indigo-800">Total Collection</span>
                <span className="text-2xl font-bold text-indigo-700">{formatCurrency(total)}</span>
              </div>

              {/* Cash required from staff (auto) — negative means excess cash */}
              <div className={`rounded-xl p-4 flex items-center justify-between ${cashRequiredForm < 0 ? 'bg-green-50' : 'bg-amber-50'}`}>
                <div>
                  <span className={`font-semibold ${cashRequiredForm < 0 ? 'text-green-800' : 'text-amber-800'}`}>
                    {cashRequiredForm < 0 ? '🟢 Excess Cash Collected' : '💵 Cash Collection Required from Staff'}
                  </span>
                  <p className={`text-xs mt-0.5 ${cashRequiredForm < 0 ? 'text-green-600' : 'text-amber-600'}`}>
                    {cashRequiredForm < 0
                      ? 'Cash collected is more than required by this amount'
                      : 'System Sales − (CRDB + Stanbic + M-PESA)'}
                  </p>
                </div>
                <span className={`text-2xl font-bold ${cashRequiredForm < 0 ? 'text-green-700' : 'text-amber-700'}`}>{formatCurrency(Math.abs(cashRequiredForm))}</span>
              </div>

              {/* Cancellations (available on new + edit) */}
              <div className="border-2 border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-700 text-sm">🚫 Cancellations</span>
                  <button type="button" onClick={() => setCancelRows([...cancelRows, { reason: CANCEL_REASONS[0], productId: '', productName: '', sellingPrice: 0, quantity: '' }])}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-rose-50 text-rose-700 hover:bg-rose-100">➕ Add Cancellation</button>
                </div>
                {cancelRows.length === 0 && <p className="text-xs text-gray-400">Record cancelled punches: Double Punch / Out of Stock / Wrong Punch.</p>}
                {cancelRows.length > 0 && (
                  <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-semibold text-gray-400 mb-1">
                    <span className="col-span-3">Reason</span><span className="col-span-4">Product</span><span className="col-span-2">Qty</span><span className="col-span-2">Amount</span><span className="col-span-1"></span>
                  </div>
                )}
                {cancelRows.map((r, i) => {
                  const amt = r.sellingPrice * (Number(r.quantity) || 0)
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                      <select value={r.reason} onChange={(e) => { const n = [...cancelRows]; n[i] = { ...r, reason: e.target.value }; setCancelRows(n) }}
                        className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                        {CANCEL_REASONS.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={r.productId} onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value)
                        const n = [...cancelRows]; n[i] = { ...r, productId: e.target.value, productName: p?.name || '', sellingPrice: p?.sellingPrice || 0 }; setCancelRows(n)
                      }}
                        className="col-span-4 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCurrency(p.sellingPrice)}</option>)}
                      </select>
                      <MoneyInput placeholder="Qty" value={r.quantity} onChange={(v) => { const n = [...cancelRows]; n[i] = { ...r, quantity: v }; setCancelRows(n) }}
                        className="col-span-2 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                      <span className="col-span-2 text-sm font-semibold text-gray-700 text-right pr-1">{formatCurrency(amt)}</span>
                      <button type="button" onClick={() => setCancelRows(cancelRows.filter((_, x) => x !== i))} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                    </div>
                  )
                })}
                {cancelTotalForm > 0 && <p className="text-xs text-gray-500 mt-1">Cancellation total: <strong>{formatCurrency(cancelTotalForm)}</strong></p>}
                {products.length === 0 && <p className="text-xs text-amber-600 mt-1">No products yet — add some under <strong>Products</strong> to select them here.</p>}
              </div>

              {/* Discount — an authorized reduction that lowers the staff loss */}
              <div className="border-2 border-gray-100 rounded-xl p-4">
                <span className="font-semibold text-gray-700 text-sm">🏷️ Discount <span className="font-normal text-gray-400">(authorized — reduces staff loss)</span></span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Discount amount (TZS)</label>
                    <MoneyInput placeholder="0" value={form.discount} onChange={(v) => setForm({ ...form, discount: v })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none font-semibold" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
                    <input type="text" value={form.discountReason} onChange={(e) => setForm({ ...form, discountReason: e.target.value })}
                      placeholder="e.g. Customer promo, manager approval"
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                </div>
                {discountForm > 0 && <p className="text-xs text-gray-500 mt-2">Discount: <strong>{formatCurrency(discountForm)}</strong> — will reduce the staff loss.</p>}
              </div>

              {/* Signed bills + paid bills for this staff (new entries only) */}
              {!editingId && (
                <div className="space-y-4">
                  {/* Signed bills */}
                  <div className="border-2 border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-700 text-sm">🧾 Signed Bills (credit sales by this staff)</span>
                      <button type="button" onClick={() => setSignedRows([...signedRows, { billType: 'ADMIN', name: '', amount: '' }])}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">➕ New Bill</button>
                    </div>
                    {signedRows.length === 0 && <p className="text-xs text-gray-400">Add credit sales this staff served: Admin / Director / Tips / DJ / Customer / Staff Loss.</p>}
                    {signedRows.map((r, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                        <select value={r.billType} onChange={(e) => { const n = [...signedRows]; n[i] = { ...r, billType: e.target.value }; setSignedRows(n) }}
                          className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                          {SIGNED_TYPE_OPTS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                        </select>
                        <input list="personNames" placeholder="Name" value={r.name} onChange={(e) => { const n = [...signedRows]; n[i] = { ...r, name: e.target.value }; setSignedRows(n) }}
                          className="col-span-5 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                        <MoneyInput placeholder="Amount" value={r.amount} onChange={(v) => { const n = [...signedRows]; n[i] = { ...r, amount: v }; setSignedRows(n) }}
                          className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                        <button type="button" onClick={() => setSignedRows(signedRows.filter((_, x) => x !== i))} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                      </div>
                    ))}
                    {signedTotalForm > 0 && <p className="text-xs text-gray-500 mt-1">Signed total: <strong>{formatCurrency(signedTotalForm)}</strong></p>}
                  </div>
                  {/* Paid bills */}
                  <div className="border-2 border-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-700 text-sm">✅ Paid Bills (debt recovered via this staff)</span>
                      <button type="button" onClick={() => setPaidRows([...paidRows, { category: 'Customer', payerName: form.staffName, amount: '', paymentMethod: 'CASH', signedBillId: '', linkQuery: '', selectedBillIds: [] }])}
                        className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-green-50 text-green-700 hover:bg-green-100">➕ Record Payment</button>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">Record payments <strong>this staff received</strong>. Only the <strong>Staff Loss</strong> category reduces this staff&apos;s loss — Customer / Admin / Director payments are saved as normal recoveries.</p>
                    {paidRows.map((r, i) => {
                      const lq = r.linkQuery.trim().toLowerCase()
                      const linkFiltered = signedBillsList.filter((b) => !lq || `${b.personName} ${b.billType} ${b.billType.replace('_', ' ')} ${b.date ? format(parseISO(b.date), 'dd MMM yyyy') : ''}`.toLowerCase().includes(lq))
                      return (
                      <div key={i} className="border border-gray-100 rounded-lg p-2 mb-2 space-y-2">
                        {/* Link to signed bill (optional) */}
                        <div className="relative">
                          <input value={r.linkQuery}
                            onChange={(e) => { const n = [...paidRows]; n[i] = { ...r, linkQuery: e.target.value, ...(e.target.value ? {} : { signedBillId: '' }) }; setPaidRows(n); setLinkOpenIdx(i) }}
                            onFocus={() => setLinkOpenIdx(i)}
                            onBlur={() => setTimeout(() => setLinkOpenIdx((cur) => (cur === i ? null : cur)), 150)}
                            placeholder="🔗 Link to signed bill (optional) — search name, date or category"
                            className={`w-full px-2 py-2 border-2 rounded-lg text-sm ${r.signedBillId ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200'}`} />
                          {linkOpenIdx === i && (
                            <div className="absolute z-30 mt-1 w-full bg-white border-2 border-gray-200 rounded-xl shadow-lg max-h-56 overflow-auto">
                              <button type="button" onClick={() => selectBillForRow(i, null)} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm text-gray-500 border-b border-gray-100">— None (no linked bill) —</button>
                              {linkFiltered.map((b) => (
                                <button type="button" key={b.id} onClick={() => selectBillForRow(i, b)} className="block w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm">
                                  <span className="font-semibold text-gray-800">{b.date ? format(parseISO(b.date), 'dd MMM yyyy') : ''} · #{b.seq ?? '?'}</span>
                                  <span className="text-gray-600"> — {b.personName} — {formatCurrency(b.amount)}</span>
                                  <span className="text-xs text-indigo-600"> [{b.billType.replace('_', ' ')}]</span>
                                </button>
                              ))}
                              {linkFiltered.length === 0 && <div className="px-3 py-3 text-gray-400 text-sm">No matching unpaid bills</div>}
                            </div>
                          )}
                        </div>
                        {/* Category / payer / amount / method */}
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <select value={r.category} onChange={(e) => { const n = [...paidRows]; n[i] = { ...r, category: e.target.value }; setPaidRows(n) }}
                            className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                            {PAID_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <input list="personNames" placeholder="Payer" value={r.payerName} onChange={(e) => {
                            const name = e.target.value
                            const person = allPersons.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
                            const n = [...paidRows]; n[i] = { ...r, payerName: name, ...(person ? { category: codeToLabelCat(person.type) } : {}) }; setPaidRows(n)
                          }}
                            className="col-span-4 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                          <MoneyInput placeholder="Amount" value={r.amount} onChange={(v) => { const n = [...paidRows]; n[i] = { ...r, amount: v }; setPaidRows(n) }}
                            className="col-span-2 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                          <select value={r.paymentMethod} onChange={(e) => { const n = [...paidRows]; n[i] = { ...r, paymentMethod: e.target.value }; setPaidRows(n) }}
                            className="col-span-2 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                            {METHOD_OPTS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
                          </select>
                          <button type="button" onClick={() => setPaidRows(paidRows.filter((_, x) => x !== i))} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                        </div>
                        {/* Multi-select when this payer has >1 outstanding bill in the category */}
                        <BillSelector bills={signedBillsList as BillLite[]} payerName={r.payerName} category={r.category}
                          selectedIds={r.selectedBillIds}
                          onChange={(ids, matching) => {
                            const n = [...paidRows]
                            const sum = matching.filter((b) => ids.includes(b.id)).reduce((s, b) => s + b.amount, 0)
                            n[i] = { ...r, selectedBillIds: ids, amount: sum > 0 ? String(sum) : r.amount }
                            setPaidRows(n)
                          }} />
                      </div>
                      )
                    })}
                    {paidTotalForm > 0 && <p className="text-xs text-gray-500 mt-1">Paid total: <strong>{formatCurrency(paidTotalForm)}</strong></p>}
                  </div>
                  <datalist id="personNames">{personNames.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
              )}

              {/* Live Staff Loss preview (full formula) */}
              {!editingId && (Number(form.systemSales) > 0 || signedTotalForm > 0 || paidTotalForm > 0) && (
                <div className={`rounded-xl p-4 ${lossPreview > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${lossPreview > 0 ? 'text-red-800' : 'text-green-800'}`}>
                      {lossPreview > 0 ? '🔻 Staff Loss (→ Payroll Deductions)' : lossPreview < 0 ? '🔺 Overage' : '✅ Balanced'}
                    </span>
                    <span className={`text-2xl font-bold ${lossPreview > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatCurrency(Math.abs(lossPreview))}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    System {formatCurrency(Number(form.systemSales) || 0)} − Collection {formatCurrency(total)} − Signed {formatCurrency(signedTotalForm)} − Paid·Staff-Loss {formatCurrency(paidStaffLossForm)} − Discount {formatCurrency(discountForm)} − Approved Cancellations
                  </p>
                  {cancelTotalForm > 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      Cancellations {formatCurrency(cancelTotalForm)} are pending — they will reduce this staff loss once approved.
                    </p>
                  )}
                </div>
              )}
              {editingId && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">Editing recalculates the staff loss from the figures recorded with this collection. Manage individual signed/paid bills in their own pages.</p>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (Optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                  rows={2} placeholder="Any notes..." />
              </div>

              {/* Save gate: must record bills or confirm none (new collections) */}
              {!editingId && !hasSigned && !hasPaid && (
                <label className="flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800">
                  <input type="checkbox" checked={confirmedZero} onChange={(e) => setConfirmedZero(e.target.checked)} className="w-4 h-4" />
                  No other signed bills or payments for this staff — confirm to enable Save.
                </label>
              )}

              <div className="flex gap-3">
                <button type="submit" disabled={submitting || !reconciled}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : editingId ? 'Update Collection' : 'Save Collection'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Date Range Filter */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-600 mr-1">Filter:</span>
            {RANGE_OPTIONS.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {r.label}
              </button>
            ))}
            {range === 'custom' && (
              <div className="flex items-center gap-2 ml-1">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
            )}
          </div>
        </div>

        {/* Totals Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow lg:col-span-1 col-span-2">
            <p className="text-indigo-100 text-xs font-medium">Total Collection</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totals.total)}</p>
            <p className="text-indigo-200 text-xs mt-1">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          {[
            { label: '💵 Cash', value: totals.cash, color: 'text-green-700' },
            { label: '🏦 CRDB', value: totals.crdb, color: 'text-blue-700' },
            { label: '🏛️ Stanbic', value: totals.stanbic, color: 'text-purple-700' },
            { label: '📱 M-PESA', value: totals.mpesa, color: 'text-yellow-700' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <p className="text-gray-500 text-xs font-medium">{s.label}</p>
              <p className={`text-lg font-bold mt-1 ${s.color}`}>{formatCurrency(s.value)}</p>
            </div>
          ))}
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs font-medium">🧾 System Sales</p>
            <p className="text-lg font-bold mt-1 text-gray-800">{formatCurrency(totals.systemSales)}</p>
          </div>
          <div className={`rounded-2xl p-4 shadow-sm border ${totalShortfall > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
            <p className="text-gray-500 text-xs font-medium">🔻 Shortfalls (→ Staff Loss)</p>
            <p className={`text-lg font-bold mt-1 ${totalShortfall > 0 ? 'text-red-700' : 'text-gray-800'}`}>{formatCurrency(totalShortfall)}</p>
          </div>
          <div className={`rounded-2xl p-4 shadow-sm border ${totalOverage > 0 ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100'}`}>
            <p className="text-gray-500 text-xs font-medium">🔺 Overages (extra collected)</p>
            <p className={`text-lg font-bold mt-1 ${totalOverage > 0 ? 'text-green-700' : 'text-gray-800'}`}>{formatCurrency(totalOverage)}</p>
          </div>
          <div className={`rounded-2xl p-4 shadow-sm border ${cancelTotalPeriod > 0 ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100'}`}>
            <p className="text-gray-500 text-xs font-medium">🚫 Cancellations</p>
            <p className={`text-lg font-bold mt-1 ${cancelTotalPeriod > 0 ? 'text-rose-700' : 'text-gray-800'}`}>{formatCurrency(cancelTotalPeriod)}</p>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold text-gray-800">Collection Records</h2>
              {isCashier && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Outlet: {headerOutlet} · By {headerBy}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-gray-500">
                {rangeLabel} · Total <strong className="text-gray-800">{formatCurrency(totals.total)}</strong>
              </span>
              <button onClick={exportCsv} disabled={!filtered.length}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                ⬇ CSV
              </button>
              <button onClick={exportPdf} disabled={!filtered.length}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
                📄 PDF
              </button>
              {targetClosed ? (
                <span className="inline-flex items-center gap-2">
                  <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-200 text-gray-700">🔒 Day Closed</span>
                  {canReopen && (
                    <button onClick={reopenDay} disabled={closingDay}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                      Reopen
                    </button>
                  )}
                </span>
              ) : (
                canAdd && (
                  <button onClick={closeDay} disabled={closingDay}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 shadow-sm">
                    {closingDay ? 'Closing…' : '🔒 Close the Day'}
                  </button>
                )
              )}
            </div>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-5 py-3 font-semibold">Date</th>
                    {!isCashier && <th className="px-5 py-3 font-semibold">Outlet</th>}
                    <th className="px-5 py-3 font-semibold">Staff</th>
                    <th className="px-5 py-3 font-semibold">Cash</th>
                    <th className="px-5 py-3 font-semibold">CRDB</th>
                    <th className="px-5 py-3 font-semibold">Stanbic</th>
                    <th className="px-5 py-3 font-semibold">M-PESA</th>
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">System</th>
                    <th className="px-5 py-3 font-semibold">Cash Req</th>
                    <th className="px-5 py-3 font-semibold">Variance</th>
                    {!isCashier && <th className="px-5 py-3 font-semibold">By</th>}
                    {canAdd && <th className="px-5 py-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => {
                    const sys = c.systemSales || 0
                    const v = rowLoss(c) // + = staff loss, − = overage
                    return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-700">{formatDateTime(c.date)}</td>
                      {!isCashier && <td className="px-5 py-4 font-medium text-gray-800">{c.outlet.name}</td>}
                      <td className="px-5 py-4 text-gray-700">{c.staffName || '-'}</td>
                      <td className="px-5 py-4 text-green-700">{c.cash > 0 ? formatCurrency(c.cash) : '-'}</td>
                      <td className="px-5 py-4 text-blue-700">{c.crdb > 0 ? formatCurrency(c.crdb) : '-'}</td>
                      <td className="px-5 py-4 text-purple-700">{c.stanbic > 0 ? formatCurrency(c.stanbic) : '-'}</td>
                      <td className="px-5 py-4 text-yellow-700">{c.mpesa > 0 ? formatCurrency(c.mpesa) : '-'}</td>
                      <td className="px-5 py-4 font-bold text-gray-900">{formatCurrency(c.total)}</td>
                      <td className="px-5 py-4 text-gray-600">{sys > 0 ? formatCurrency(sys) : '-'}</td>
                      <td className="px-5 py-4 text-amber-700">{sys > 0 ? formatCurrency(cashRequired(c)) : '-'}</td>
                      <td className={`px-5 py-4 font-semibold ${sys === 0 ? 'text-gray-300' : v > 0 ? 'text-red-600' : v < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                        {sys === 0 ? '-' : `${v > 0 ? '▼ ' : v < 0 ? '▲ ' : ''}${formatCurrency(Math.abs(v))}`}
                      </td>
                      {!isCashier && <td className="px-5 py-4 text-gray-500">{c.cashier.name}</td>}
                      {canAdd && (
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          {isDayClosed(c.date) && isCashier ? (
                            <span className="text-xs text-gray-400">🔒 Closed</span>
                          ) : (
                            <>
                              <button onClick={() => startEdit(c)} title="Edit"
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1">Edit</button>
                              <button onClick={() => deleteCollection(c)} title="Delete"
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={(isCashier ? 10 : 12) + (canAdd ? 1 : 0)} className="text-center py-12 text-gray-400">No collections in this period</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-5 py-4" colSpan={isCashier ? 2 : 3}>TOTAL ({filtered.length})</td>
                      <td className="px-5 py-4 text-green-700">{formatCurrency(totals.cash)}</td>
                      <td className="px-5 py-4 text-blue-700">{formatCurrency(totals.crdb)}</td>
                      <td className="px-5 py-4 text-purple-700">{formatCurrency(totals.stanbic)}</td>
                      <td className="px-5 py-4 text-yellow-700">{formatCurrency(totals.mpesa)}</td>
                      <td className="px-5 py-4 text-indigo-700 text-base">{formatCurrency(totals.total)}</td>
                      <td className="px-5 py-4 text-gray-700">{formatCurrency(totals.systemSales)}</td>
                      <td className="px-5 py-4 text-amber-700">{formatCurrency(totals.systemSales - totals.crdb - totals.stanbic - totals.mpesa)}</td>
                      <td className={`px-5 py-4 ${variance > 0 ? 'text-red-700' : variance < 0 ? 'text-green-700' : 'text-gray-500'}`}>{formatCurrency(Math.abs(variance))}</td>
                      {!isCashier && <td className="px-5 py-4"></td>}
                      {canAdd && <td className="px-5 py-4"></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
