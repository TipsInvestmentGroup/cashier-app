'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { CashReconForm } from '@/components/recon/CashReconForm'
import { DigitalReconForm } from '@/components/recon/DigitalReconForm'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { useCompanyConfig } from '@/contexts/CompanyConfigContext'
import { resolveBusinessDate } from '@/lib/business-date'
import { formatCurrency, formatDateTime, roundMoney } from '@/lib/utils'
import { BillSelector, BillLite } from '@/components/BillSelector'
import { MoneyInput } from '@/components/MoneyInput'
import { channelAmountsFor, digitalTotal, sumChannelAmounts } from '@/lib/collection-channels-shared'
import { findBestPersonMatch } from '@/lib/nameMatch'
import { EXCESS_REASONS, UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'
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
interface CollectionExcessRow {
  id: string; amount: number; reason: string; staffId?: string | null; staffName?: string | null; personId?: string | null; personName?: string | null; paidAmount: number
}
interface Collection {
  id: string; date: string; cash: number; crdb: number; stanbic: number; mpesa: number; total: number
  staffName?: string; systemSales?: number; creditSales?: number; paymentsReceived?: number; discount?: number; discountReason?: string
  notes: string; outletId?: string; outlet: { id?: string; name: string }; cashier: { name: string }; cancellations?: Cancellation[]
  channels?: { channelCode: string; amount: number }[]; excessItems?: CollectionExcessRow[]
}
interface ExcessItem { key: string; id?: string; amount: string; reason: string; staffId: string; personId: string; paidAmount: number }
interface Product { id: string; code: string; name: string; sellingPrice: number; isActive: boolean; categoryId?: string | null }
interface SignedBill { id: string; personName: string; amount: number; billType: string; status: string; seq?: number; date?: string }
// signed-bill type → paid-bill category label
const BILLTYPE_TO_CATEGORY: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', STAFF_LOSS: 'Staff Loss', TIPS: 'Sponsors & Partners' }
// Cash the staff must physically hand over = System Sales − digital channels
const cashRequired = (c: { systemSales?: number } & Parameters<typeof digitalTotal>[0]) => (c.systemSales || 0) - digitalTotal(c)
// Staff Loss = System Sales − Collection − Signed Bills − Paid Bills − Discount − Approved cancellations
// (matches lib/staff-loss.ts's authoritative recompute — the same figure the excess/loss ledger settles on)
const rowLoss = (c: { systemSales?: number; total: number; creditSales?: number; paymentsReceived?: number; discount?: number; cancellations?: Cancellation[] }) => {
  const approvedCancel = (c.cancellations || []).filter((x) => x.status === 'APPROVED').reduce((s, x) => s + (x.amount || 0), 0)
  return (c.systemSales || 0) - c.total - (c.creditSales || 0) - (c.paymentsReceived || 0) - (c.discount || 0) - approvedCancel
}
interface Outlet { id: string; name: string }
interface Person { id: string; name: string; type: string }

interface NamedCode { code: string; label: string; isActive: boolean }
interface CancelReason extends NamedCode { appliesToAll: boolean; categoryIds: string[]; productIds: string[] }

export default function CollectionsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const { config: companyConfig } = useCompanyConfig()
  const confirm = useConfirm()
  // The business day a fresh entry defaults to — before the cutover hour, that's
  // still yesterday's shift, not the raw calendar date.
  const businessToday = format(resolveBusinessDate(new Date(), companyConfig.businessDayCutoverHour), 'yyyy-MM-dd')
  const isBeforeCutover = businessToday !== format(new Date(), 'yyyy-MM-dd')
  const [collections, setCollections] = useState<Collection[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [staff, setStaff] = useState<Person[]>([])
  const [personNames, setPersonNames] = useState<string[]>([])
  const [signedRows, setSignedRows] = useState<{ billType: string; name: string; amount: string; personId?: string; confirmedNew?: boolean }[]>([])
  const [paidRows, setPaidRows] = useState<{ category: string; payerName: string; amount: string; paymentMethod: string; signedBillId: string; linkQuery: string; selectedBillIds: string[] }[]>([])
  const [signedBillsList, setSignedBillsList] = useState<SignedBill[]>([])
  const [linkOpenIdx, setLinkOpenIdx] = useState<number | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [cancelRows, setCancelRows] = useState<{ reason: string; productId: string; productName: string; sellingPrice: number; quantity: string }[]>([])
  const [excessItems, setExcessItems] = useState<ExcessItem[]>([])
  const excessKeyRef = useRef(0)
  const newExcessItem = (amount = ''): ExcessItem => ({ key: `new-${excessKeyRef.current++}`, amount, reason: '', staffId: '', personId: '', paidAmount: 0 })
  const [staffPickList, setStaffPickList] = useState<{ id: string; name: string }[]>([])
  const [allPersons, setAllPersons] = useState<Person[]>([])
  const [categories, setCategories] = useState<NamedCode[]>([])
  const [channels, setChannels] = useState<NamedCode[]>([])
  const [cancelReasons, setCancelReasons] = useState<CancelReason[]>([])
  const CANCEL_REASONS = cancelReasons.filter((r) => r.isActive).map((r) => r.label)
  // Reasons available for a given cancellation row's picked product — reasons that
  // apply to all products, plus any scoped to that product's category or itself.
  const reasonsForProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    return cancelReasons
      .filter((r) => r.isActive)
      .filter((r) => r.appliesToAll || !productId || (product && (r.categoryIds.includes(product.categoryId || '') || r.productIds.includes(productId))))
      .map((r) => r.label)
  }
  const PAID_CATEGORIES = categories.filter((c) => c.isActive).map((c) => c.label)
  const SIGNED_TYPE_OPTS = categories.filter((c) => c.isActive)
  const METHOD_OPTS = channels.filter((c) => c.isActive)
  // Digital collection boxes: any active Payment Channel except Cash — this is what
  // makes Daily Collections' amount boxes dynamic (Setup > Payment Channels drives it).
  const DIGITAL_CHANNELS = channels.filter((c) => c.isActive && c.code !== 'CASH')
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
  const [closeWizard, setCloseWizard] = useState(false) // guided close-day flow
  const [wizardStep, setWizardStep] = useState(0)
  const [dayStatus, setDayStatus] = useState({ cashDone: false, digitalDone: false, templateDone: false })
  const [statusLoading, setStatusLoading] = useState(false)

  const [form, setForm] = useState({
    cash: '', channelAmounts: {} as Record<string, string>, notes: '', staffName: '', systemSales: '',
    discount: '', discountReason: '',
    outletId: user?.outlet?.id || '', date: businessToday,
  })
  const channelAmountsNum = Object.fromEntries(Object.entries(form.channelAmounts).map(([k, v]) => [k, Number(v) || 0]))
  const getAmountBox = (code: string) => code === 'CASH' ? form.cash : (form.channelAmounts[code] || '')
  const setAmountBox = (code: string, v: string) => {
    if (code === 'CASH') setForm((f) => ({ ...f, cash: v }))
    else setForm((f) => ({ ...f, channelAmounts: { ...f.channelAmounts, [code]: v } }))
  }

  const total = (Number(form.cash) || 0) + sumChannelAmounts(channelAmountsNum)

  // Cash required from staff = System Sales − digital channels
  const cashRequiredForm = (Number(form.systemSales) || 0) - sumChannelAmounts(channelAmountsNum)
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
    const [cols, outs, persons, prods, sbs, cats, chs, reasons, closures, staffPick] = await Promise.all([
      request('/api/collections'),
      request('/api/outlets'),
      request('/api/persons'),
      request('/api/products'),
      request('/api/signed-bills?status=UNPAID'),
      request('/api/person-categories'),
      request('/api/payment-channels'),
      request('/api/cancellation-reasons'),
      request('/api/collections/close-day').catch(() => ({ closedDays: [] })),
      request('/api/staff-list').catch(() => []),
    ])
    setCollections(cols)
    setClosedDays(closures?.closedDays || [])
    setOutlets(outs)
    setProducts((prods || []).filter((p: Product) => p.isActive))
    setSignedBillsList((sbs || []).filter((b: SignedBill) => b.status !== 'PAID'))
    setCategories(cats || [])
    setCancelReasons(reasons || [])
    setChannels(chs || [])
    setStaffPickList(staffPick || [])
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

  // Intelligent customer-name matching for a Signed Bill row: exact match links
  // silently; a similar (near-duplicate) name asks the cashier to confirm before
  // reusing the existing Person; no match at all is auto-created on save.
  const resolveSignedName = async (i: number) => {
    const row = signedRows[i]
    const name = row.name.trim()
    if (!name) return
    const candidates = allPersons.filter((p) => p.type === row.billType)
    const result = findBestPersonMatch(name, candidates)
    if (result.kind === 'exact') {
      setSignedRows((rows) => rows.map((r, idx) => idx === i ? { ...r, personId: result.match.id, confirmedNew: false } : r))
      return
    }
    if (result.kind === 'similar') {
      const same = await confirm({
        title: 'Possible existing customer',
        message: `A similar name "${result.match.name}" already exists. Is "${name}" the same person?`,
        confirmLabel: 'Yes, same person', cancelLabel: 'No, new person',
      })
      setSignedRows((rows) => rows.map((r, idx) => {
        if (idx !== i || r.name.trim() !== name) return r
        return same ? { ...r, personId: result.match.id, confirmedNew: false } : { ...r, personId: undefined, confirmedNew: true }
      }))
      return
    }
    setSignedRows((rows) => rows.map((r, idx) => idx === i ? { ...r, personId: undefined, confirmedNew: true } : r))
  }

  const activeExcessItems = excessItems.filter((it) => (Number(it.amount) || 0) > 0)
  const excessItemsTotal = activeExcessItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const excessRemaining = roundMoney(Math.abs(lossPreview) - excessItemsTotal)

  const addExcessItem = () => setExcessItems((items) => [...items, newExcessItem(items.length === 0 ? String(Math.abs(lossPreview)) : '')])
  const updateExcessItem = (key: string, patch: Partial<ExcessItem>) =>
    setExcessItems((items) => items.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const removeExcessItem = (key: string) => {
    const it = excessItems.find((i) => i.key === key)
    if (it && it.paidAmount > 0) return toast.error('This excess item has recorded payments and cannot be removed — settle it from Excess Recon first.')
    setExcessItems((items) => items.filter((i) => i.key !== key))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.staffName) return toast.error('Please select a staff member before saving the collection.')
    if (total === 0) return toast.error('Enter at least one amount')
    if (!reconciled) return toast.error('Record signed bills & payments, or tick "No other bills" to confirm none.')
    if (lossPreview < 0) {
      if (activeExcessItems.length === 0) return toast.error('Select a reason for the excess amount collected')
      for (const it of activeExcessItems) {
        if (!it.reason) return toast.error('Select a reason for each excess amount')
        if (it.reason === 'STAFF_TIP' && !it.staffId) return toast.error('Select the staff name for the excess amount')
        if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) return toast.error('Select the customer name for the excess amount')
      }
      if (!editingId && excessRemaining !== 0) return toast.error(`Excess reasons must add up to ${formatCurrency(Math.abs(lossPreview))} (${excessRemaining > 0 ? formatCurrency(excessRemaining) + ' left to allocate' : 'over by ' + formatCurrency(-excessRemaining)})`)
    }
    setSubmitting(true)
    try {
      const signedBills = signedRows.filter((r) => r.name && Number(r.amount) > 0).map((r) => ({ billType: r.billType, name: r.name, amount: Number(r.amount), personId: r.personId, confirmedNew: r.confirmedNew }))
      const paidBills = paidRows.filter((r) => r.payerName && Number(r.amount) > 0).map((r) => ({ payerName: r.payerName, amount: Number(r.amount), paymentMethod: r.paymentMethod, category: r.category, categoryBillType: labelToCode(r.category), signedBillId: r.signedBillId || undefined, selectedBillIds: r.selectedBillIds }))
      const cancellations = cancelRows.filter((r) => r.productName && Number(r.quantity) > 0).map((r) => ({
        reason: r.reason, productId: r.productId || undefined, productName: r.productName,
        sellingPrice: r.sellingPrice, quantity: Number(r.quantity), amount: r.sellingPrice * (Number(r.quantity) || 0),
      }))
      const excessItemsPayload = activeExcessItems.map((it) => ({
        id: it.id, amount: Number(it.amount) || 0, reason: it.reason,
        ...(it.reason === 'STAFF_TIP' ? { staffId: it.staffId } : {}),
        ...(it.reason === 'CUSTOMER_EXCESS' ? { personId: it.personId } : {}),
      }))
      const payload = JSON.stringify({ ...form, cash: Number(form.cash) || 0, channelAmounts: channelAmountsNum, signedBills, paidBills, cancellations, excessItems: excessItemsPayload })
      const res = editingId
        ? await request(`/api/collections/${editingId}`, { method: 'PUT', body: payload })
        : await request('/api/collections', { method: 'POST', body: payload })
      if (res?.staffLoss) {
        toast.success(`Saved. Staff loss of ${formatCurrency(res.staffLoss.amount)} for ${res.staffLoss.staffName} → Payroll Deductions.`, { duration: 6000 })
      } else if (res?.excess) {
        toast.success(`Saved. Excess of ${formatCurrency(res.excess.amount)} recorded → Excess Recon.`, { duration: 6000 })
      } else {
        toast.success(editingId ? 'Collection updated!' : 'Collection saved — balanced, no loss.')
      }
      setForm({ cash: '', channelAmounts: {}, notes: '', staffName: '', systemSales: '', discount: '', discountReason: '', outletId: form.outletId, date: businessToday })
      setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false)
      setExcessItems([])
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
    const channelAmounts: Record<string, string> = {}
    for (const [code, amt] of Object.entries(channelAmountsFor(c))) channelAmounts[code] = amt ? String(amt) : ''
    setForm({
      cash: c.cash ? String(c.cash) : '',
      channelAmounts,
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
    setExcessItems((c.excessItems || []).map((it) => ({
      key: it.id, id: it.id, amount: String(it.amount), reason: it.reason, staffId: it.staffId || '', personId: it.personId || '',
      paidAmount: it.paidAmount || 0,
    })))
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const newCollection = () => {
    setEditingId(null)
    setForm({ cash: '', channelAmounts: {}, notes: '', staffName: '', systemSales: '', discount: '', discountReason: '', outletId: form.outletId, date: businessToday })
    setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false)
    setExcessItems([])
    setShowForm((s) => !s)
  }

  const deleteCollection = async (c: Collection) => {
    if (!(await confirm({ title: 'Delete collection', message: `Delete this collection${c.staffName ? ` for ${c.staffName}` : ''}? Any auto staff-loss linked to it will also be removed.`, danger: true, confirmLabel: 'Delete' }))) return
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
    (acc, c) => {
      const amounts = channelAmountsFor(c)
      const channelTotals = { ...acc.channels }
      for (const [code, amt] of Object.entries(amounts)) channelTotals[code] = (channelTotals[code] || 0) + amt
      return {
        cash: acc.cash + c.cash,
        total: acc.total + c.total,
        systemSales: acc.systemSales + (c.systemSales || 0),
        creditSales: acc.creditSales + (c.creditSales || 0),
        paymentsReceived: acc.paymentsReceived + (c.paymentsReceived || 0),
        discount: acc.discount + (c.discount || 0),
        channels: channelTotals,
      }
    },
    { cash: 0, total: 0, systemSales: 0, creditSales: 0, paymentsReceived: 0, discount: 0, channels: {} as Record<string, number> }
  )
  const totalDigital = Object.values(totals.channels).reduce((s, v) => s + v, 0)
  // Discount + cancellations, per row (rejected cancellations don't count)
  const rowDiscountAndCancel = (c: Collection) =>
    (c.discount || 0) + (c.cancellations || []).filter((x) => x.status !== 'REJECTED').reduce((s, x) => s + (x.amount || 0), 0)
  // Net loss across the period (full formula, matching rowLoss): System − Collection − Signed − Paid − Discount − Approved cancellations
  const variance = filtered.reduce((s, c) => s + rowLoss(c), 0)
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
  const targetCloseDate = range === 'custom' && customFrom === customTo
    ? parseISO(customFrom)
    : resolveBusinessDate(new Date(), companyConfig.businessDayCutoverHour)
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

  // Open the guided close-day wizard (Cash requests → Cash recon → Digital recon → confirm)
  const openCloseWizard = () => {
    if (targetOutletIds.length === 0) { toast.error('No collections found for this day to close.'); return }
    setWizardStep(0); setCloseWizard(true)
  }

  // Live readiness — is Cash Recon + Digital Recon done for the target day?
  const loadDayStatus = async () => {
    if (targetOutletIds.length === 0) { setDayStatus({ cashDone: false, digitalDone: false, templateDone: false }); return }
    setStatusLoading(true)
    try {
      const results = await Promise.all(targetOutletIds.map((oid) =>
        request(`/api/collections/day-status?date=${targetDayStr}&outletId=${oid}`).catch(() => null)))
      const ok = results.filter(Boolean) as { cashReconDone: boolean; digitalReconDone: boolean; templateSessionsOpen: boolean }[]
      setDayStatus({
        cashDone: ok.length > 0 && ok.every((r) => r.cashReconDone),
        digitalDone: ok.length > 0 && ok.every((r) => r.digitalReconDone),
        templateDone: ok.length > 0 && ok.every((r) => !r.templateSessionsOpen),
      })
    } finally { setStatusLoading(false) }
  }

  // Refresh status when the wizard opens and whenever the cashier returns to this tab.
  useEffect(() => {
    if (!closeWizard) return
    loadDayStatus()
    const onFocus = () => loadDayStatus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [closeWizard]) // eslint-disable-line react-hooks/exhaustive-deps

  const closeDay = async () => {
    const label = format(targetCloseDate, 'dd MMM yyyy')
    if (targetOutletIds.length === 0) { toast.error('No collections found for this day to close.'); return }
    if (!dayStatus.cashDone || !dayStatus.digitalDone || !dayStatus.templateDone) { toast.error('Complete Cash and Digital reconciliation, and any open Collection Template sessions, first.'); return }
    setClosingDay(true)
    try {
      for (const outletId of targetOutletIds) {
        await request('/api/collections/close-day', { method: 'POST', body: JSON.stringify({ date: targetDayStr, outletId }) })
      }
      toast.success(`Day closed — ${label} is now locked.`)
      setWizardStep(5) // → end-of-day reports step
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not close the day')
    } finally { setClosingDay(false) }
  }

  const reopenDay = async () => {
    const label = format(targetCloseDate, 'dd MMM yyyy')
    const ids = targetOutletIds.length ? targetOutletIds : (user?.outlet?.id ? [user.outlet.id] : [])
    if (ids.length === 0) { toast.error('No outlet to reopen for this day.'); return }
    if (!(await confirm({ title: 'Reopen day', message: `Reopen ${label}? Cashiers will be able to edit this day's collections again.`, confirmLabel: 'Reopen' }))) return
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
  const reqCash = (c: Collection) => cashRequired(c)

  const exportCsv = () => {
    if (!filtered.length) return toast.error('Nothing to export')
    const headers = ['Date', 'Outlet', 'Staff', 'Cash', ...DIGITAL_CHANNELS.map((ch) => ch.label), 'Total', 'System', 'Cash Req', 'Variance', 'By']
    const dataRows = filtered.map((c) => {
      const v = rowLoss(c)
      const amounts = channelAmountsFor(c)
      return [formatDateTime(c.date), c.outlet.name, c.staffName || '', c.cash, ...DIGITAL_CHANNELS.map((ch) => amounts[ch.code] || 0), c.total, c.systemSales || 0, reqCash(c), v, c.cashier.name]
    })
    dataRows.push(['TOTAL', '', '', totals.cash, ...DIGITAL_CHANNELS.map((ch) => totals.channels[ch.code] || 0), totals.total, totals.systemSales, totals.systemSales - totalDigital, variance, ''])
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
        head: [['Date', 'Outlet', 'Staff', 'Cash', ...DIGITAL_CHANNELS.map((ch) => ch.label), 'Total', 'System', 'Cash Req', 'Variance', 'By']],
        body: filtered.map((c) => {
          const v = rowLoss(c)
          const amounts = channelAmountsFor(c)
          return [formatDateTime(c.date), c.outlet.name, c.staffName || '-', n(c.cash), ...DIGITAL_CHANNELS.map((ch) => n(amounts[ch.code] || 0)), n(c.total), n(c.systemSales || 0), n(reqCash(c)), `${v > 0 ? '-' : v < 0 ? '+' : ''}${n(Math.abs(v))}`, c.cashier.name]
        }),
        foot: [['TOTAL', '', '', n(totals.cash), ...DIGITAL_CHANNELS.map((ch) => n(totals.channels[ch.code] || 0)), n(totals.total), n(totals.systemSales), n(totals.systemSales - totalDigital), n(Math.abs(variance)), '']],
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
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Collections</h1>
            <p className="text-gray-500 text-sm">Record cash, bank & M-PESA collections</p>
          </div>
          {canAdd && (
            <Button onClick={newCollection} size="lg" disabled={isCashier && isDayClosed(new Date())}
              title={isCashier && isDayClosed(new Date()) ? 'Today is closed — ask a supervisor to reopen it' : ''}>
              <span className="text-lg">+</span> New Collection
            </Button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">{editingId ? 'Edit Collection' : 'Record Daily Collection'}</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Business Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  {!editingId && isBeforeCutover && form.date === businessToday && (
                    <p className="text-xs text-amber-600 mt-1">
                      Auto-set to {format(parseISO(businessToday), 'dd MMM')} — entered before the {String(companyConfig.businessDayCutoverHour).padStart(2, '0')}:00 business-day cutover. Change it above if this belongs to a different day.
                    </p>
                  )}
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
                  <label className="block text-sm font-semibold text-gray-700 mb-1">👤 Staff (collected from) <span className="text-red-500">*</span></label>
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
                {[{ code: 'CASH', label: '💵 Cash' }, ...DIGITAL_CHANNELS.map((ch) => ({ code: ch.code, label: `🏦 ${ch.label}` }))].map(({ code, label }) => (
                  <div key={code}>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
                    <MoneyInput placeholder="0"
                      value={getAmountBox(code)}
                      onChange={(v) => setAmountBox(code, v)}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-medium" />
                  </div>
                ))}
              </div>
              {DIGITAL_CHANNELS.length === 0 && (
                <p className="text-xs text-amber-600 -mt-2">No digital payment channels configured — add one under Setup &gt; Payment Channels.</p>
              )}

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
                      : 'System Sales − digital channels'}
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
                {cancelRows.length === 0 && <p className="text-xs text-gray-400">Record cancelled punches: {CANCEL_REASONS.join(' / ') || 'add reasons under Setup > Cancellation Reasons'}.</p>}
                {cancelRows.length > 0 && (
                  <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-semibold text-gray-400 mb-1">
                    <span className="col-span-3">Reason</span><span className="col-span-4">Product</span><span className="col-span-2">Qty</span><span className="col-span-2">Amount</span><span className="col-span-1"></span>
                  </div>
                )}
                {cancelRows.map((r, i) => {
                  const amt = r.sellingPrice * (Number(r.quantity) || 0)
                  const reasonOptions = reasonsForProduct(r.productId)
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                      <select value={r.reason} onChange={(e) => { const n = [...cancelRows]; n[i] = { ...r, reason: e.target.value }; setCancelRows(n) }}
                        className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                        {reasonOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <select value={r.productId} onChange={(e) => {
                        const p = products.find((x) => x.id === e.target.value)
                        const nextReasons = reasonsForProduct(e.target.value)
                        const nextReason = nextReasons.includes(r.reason) ? r.reason : (nextReasons[0] || '')
                        const n = [...cancelRows]; n[i] = { ...r, productId: e.target.value, productName: p?.name || '', sellingPrice: p?.sellingPrice || 0, reason: nextReason }; setCancelRows(n)
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
                        <select value={r.billType} onChange={(e) => { const n = [...signedRows]; n[i] = { ...r, billType: e.target.value, personId: undefined, confirmedNew: false }; setSignedRows(n) }}
                          className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                          {SIGNED_TYPE_OPTS.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                        </select>
                        <input list={`persons-${r.billType}`} placeholder="Name" value={r.name}
                          onChange={(e) => { const n = [...signedRows]; n[i] = { ...r, name: e.target.value, personId: undefined, confirmedNew: false }; setSignedRows(n) }}
                          onBlur={() => resolveSignedName(i)}
                          className={`col-span-5 px-2 py-2 border-2 rounded-lg text-sm ${r.personId ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200'}`} />
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
                          <input list={`persons-${labelToCode(r.category)}`} placeholder="Payer" value={r.payerName} onChange={(e) => {
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
                  {/* Per-type person suggestions — a signed bill of type X only lists X persons */}
                  {SIGNED_TYPE_OPTS.map((t) => (
                    <datalist key={t.code} id={`persons-${t.code}`}>
                      {allPersons.filter((p) => p.type === t.code).map((p) => <option key={p.id} value={p.name} />)}
                    </datalist>
                  ))}
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

              {/* Excess reason(s) — split the overage across one or more reasons/people */}
              {(lossPreview < 0 || excessItems.length > 0) && (
                <div className="border-2 border-amber-100 bg-amber-50/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-semibold text-gray-700">Excess Reason(s) {lossPreview < 0 && '*'}</label>
                    {lossPreview < 0 && (
                      <span className={`text-xs font-bold ${excessRemaining === 0 ? 'text-green-700' : 'text-amber-800'}`}>
                        {excessRemaining === 0 ? `Allocated: ${formatCurrency(excessItemsTotal)}` : `Remaining to allocate: ${formatCurrency(excessRemaining)}`}
                      </span>
                    )}
                  </div>
                  {excessItems.map((it) => {
                    const locked = it.paidAmount > 0
                    const unassigned = it.reason === UNASSIGNED_EXCESS_REASON
                    return (
                      <div key={it.key} className="bg-white border-2 border-gray-100 rounded-xl p-2.5 space-y-2">
                        {locked && <p className="text-xs font-semibold text-indigo-600">🔒 {formatCurrency(it.paidAmount)} already settled — edit/removal locked. Manage payments from Excess Recon.</p>}
                        {unassigned && !locked && <p className="text-xs font-semibold text-amber-700">⚠️ Auto-detected excess — assign a reason below.</p>}
                        <div className="flex items-center gap-2">
                          <MoneyInput value={it.amount} onChange={(v) => updateExcessItem(it.key, { amount: v })} disabled={locked}
                            className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none font-bold disabled:bg-gray-50 disabled:text-gray-500" placeholder="0" />
                          <button type="button" onClick={() => removeExcessItem(it.key)} title="Remove" disabled={locked}
                            className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-40 disabled:hover:bg-red-50">✕</button>
                        </div>
                        {Number(it.amount) > 0 && (
                          <>
                            <select value={unassigned ? '' : it.reason} onChange={(e) => updateExcessItem(it.key, { reason: e.target.value, staffId: '', personId: '' })} disabled={locked}
                              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                              <option value="">Select a reason…</option>
                              {EXCESS_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                            {it.reason === 'STAFF_TIP' && (
                              <select value={it.staffId} onChange={(e) => updateExcessItem(it.key, { staffId: e.target.value })} disabled={locked}
                                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                                <option value="">Select staff…</option>
                                {staffPickList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                            )}
                            {it.reason === 'CUSTOMER_EXCESS' && (
                              <select value={it.personId} onChange={(e) => updateExcessItem(it.key, { personId: e.target.value })} disabled={locked}
                                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                                <option value="">Select customer…</option>
                                {allPersons.filter((p) => p.type === 'CUSTOMER').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                  <button type="button" onClick={addExcessItem}
                    className="w-full py-2 border-2 border-dashed border-amber-300 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-50">
                    + Add Excess Reason
                  </button>
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

              <div className="flex gap-3 sticky bottom-0 -mx-6 px-6 pt-3 pb-1 bg-white border-t border-gray-100 z-10">
                <Button type="submit" size="lg" disabled={submitting || !reconciled} className="flex-1">
                  {submitting ? 'Saving...' : editingId ? 'Update Collection' : 'Save Collection'}
                </Button>
                <Button type="button" variant="outline" size="lg" className="px-6"
                  onClick={() => { setShowForm(false); setEditingId(null); setSignedRows([]); setPaidRows([]); setCancelRows([]); setConfirmedZero(false) }}>
                  Cancel
                </Button>
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
            ...DIGITAL_CHANNELS.map((ch, i) => ({
              label: `🏦 ${ch.label}`, value: totals.channels[ch.code] || 0,
              color: ['text-blue-700', 'text-purple-700', 'text-yellow-700', 'text-pink-700', 'text-teal-700'][i % 5],
            })),
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
                  <button onClick={openCloseWizard} disabled={closingDay}
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
                    {DIGITAL_CHANNELS.map((ch) => <th key={ch.code} className="px-5 py-3 font-semibold">{ch.label}</th>)}
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">System</th>
                    <th className="px-5 py-3 font-semibold">Cash Req</th>
                    <th className="px-5 py-3 font-semibold">Variance</th>
                    <th className="px-5 py-3 font-semibold">Discount &amp; Cancel</th>
                    <th className="px-5 py-3 font-semibold">Signed Bills</th>
                    {!isCashier && <th className="px-5 py-3 font-semibold">By</th>}
                    {canAdd && <th className="px-5 py-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => {
                    const sys = c.systemSales || 0
                    const v = rowLoss(c) // + = staff loss, − = overage
                    const amounts = channelAmountsFor(c)
                    return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-700">{formatDateTime(c.date)}</td>
                      {!isCashier && <td className="px-5 py-4 font-medium text-gray-800">{c.outlet.name}</td>}
                      <td className="px-5 py-4 text-gray-700">{c.staffName || '-'}</td>
                      <td className="px-5 py-4 text-green-700">{c.cash > 0 ? formatCurrency(c.cash) : '-'}</td>
                      {DIGITAL_CHANNELS.map((ch) => (
                        <td key={ch.code} className="px-5 py-4 text-blue-700">{(amounts[ch.code] || 0) > 0 ? formatCurrency(amounts[ch.code]) : '-'}</td>
                      ))}
                      <td className="px-5 py-4 font-bold text-gray-900">{formatCurrency(c.total)}</td>
                      <td className="px-5 py-4 text-gray-600">{sys > 0 ? formatCurrency(sys) : '-'}</td>
                      <td className="px-5 py-4 text-amber-700">{sys > 0 ? formatCurrency(cashRequired(c)) : '-'}</td>
                      <td className={`px-5 py-4 font-semibold ${sys === 0 ? 'text-gray-300' : v > 0 ? 'text-red-600' : v < 0 ? 'text-green-600' : 'text-gray-500'}`}>
                        {sys === 0 ? '-' : `${v > 0 ? '▼ ' : v < 0 ? '▲ ' : ''}${formatCurrency(Math.abs(v))}`}
                      </td>
                      <td className="px-5 py-4 text-rose-700">{rowDiscountAndCancel(c) > 0 ? formatCurrency(rowDiscountAndCancel(c)) : '-'}</td>
                      <td className="px-5 py-4 text-indigo-700">{(c.creditSales || 0) > 0 ? formatCurrency(c.creditSales || 0) : '-'}</td>
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
                    <tr><td colSpan={9 + DIGITAL_CHANNELS.length + (isCashier ? 0 : 2) + (canAdd ? 1 : 0)}>
                      <EmptyState icon="🧾" title="No collections in this period" hint="Record a staff collection to get started." />
                    </td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-5 py-4" colSpan={isCashier ? 2 : 3}>TOTAL ({filtered.length})</td>
                      <td className="px-5 py-4 text-green-700">{formatCurrency(totals.cash)}</td>
                      {DIGITAL_CHANNELS.map((ch) => (
                        <td key={ch.code} className="px-5 py-4 text-blue-700">{formatCurrency(totals.channels[ch.code] || 0)}</td>
                      ))}
                      <td className="px-5 py-4 text-indigo-700 text-base">{formatCurrency(totals.total)}</td>
                      <td className="px-5 py-4 text-gray-700">{formatCurrency(totals.systemSales)}</td>
                      <td className="px-5 py-4 text-amber-700">{formatCurrency(totals.systemSales - totalDigital)}</td>
                      <td className={`px-5 py-4 ${variance > 0 ? 'text-red-700' : variance < 0 ? 'text-green-700' : 'text-gray-500'}`}>{formatCurrency(Math.abs(variance))}</td>
                      <td className="px-5 py-4 text-rose-700">{formatCurrency(totals.discount + cancelTotalPeriod)}</td>
                      <td className="px-5 py-4 text-indigo-700">{formatCurrency(totals.creditSales)}</td>
                      {!isCashier && <td className="px-5 py-4"></td>}
                      {canAdd && <td className="px-5 py-4"></td>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        {/* Guided Close-Day wizard */}
        {closeWizard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setCloseWizard(false)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900">🔒 Close the Day — {format(targetCloseDate, 'dd MMM yyyy')}</h3>
                <button onClick={() => setCloseWizard(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
              </div>
              {/* Step tracker */}
              <div className="flex items-center mb-5">
                {['Cash Requests', 'Cash Recon', 'Digital Recon', 'Confirm'].map((label, i) => {
                  const stepIdx = Math.min(wizardStep, 3)
                  const done = i === 1 ? dayStatus.cashDone : i === 2 ? dayStatus.digitalDone : i < stepIdx
                  const current = stepIdx === i
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center relative">
                      {i > 0 && <div className={`absolute top-3.5 right-1/2 w-full h-0.5 ${done || current ? 'bg-indigo-300' : 'bg-gray-200'}`} />}
                      <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${done ? 'bg-green-500 text-white' : current ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>{done ? '✓' : i + 1}</div>
                      <span className={`text-[10px] mt-1 text-center leading-tight ${current ? 'text-indigo-700 font-semibold' : 'text-gray-400'}`}>{label}</span>
                    </div>
                  )
                })}
              </div>

              {wizardStep === 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">Step 1 of 4 · Cash Requests <span className="text-gray-400 font-normal">(optional)</span></p>
                  <p className="text-sm text-gray-500 mb-4">If there were any cash expenses today, record them first. If none, continue.</p>
                  <a href="/petty-cash" target="_blank" rel="noopener noreferrer" className="block text-center w-full py-2.5 mb-2 rounded-xl bg-indigo-50 text-indigo-700 font-semibold text-sm hover:bg-indigo-100">Open Cash Requests ↗</a>
                  <button onClick={() => setWizardStep(1)} className="w-full py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700">Continue to Cash Reconciliation →</button>
                </div>
              )}

              {wizardStep === 1 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">Step 2 of 4 · Cash Reconciliation <span className="text-rose-500 font-normal">(required)</span></p>
                  <p className="text-sm text-gray-500 mb-3">Complete the cash reconciliation below — saving moves you to the next step.</p>
                  <CashReconForm outletId={targetOutletIds[0] || ''} date={targetDayStr} onSaved={() => { loadDayStatus(); setWizardStep(2) }} />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setWizardStep(0)} className="flex-1 py-2 rounded-xl border-2 border-gray-200 text-gray-700 font-medium text-sm">← Back</button>
                    {dayStatus.cashDone && <button onClick={() => setWizardStep(2)} className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium text-sm">Already done — skip →</button>}
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">Step 3 of 4 · Digital Payment Reconciliation <span className="text-rose-500 font-normal">(required)</span></p>
                  <p className="text-sm text-gray-500 mb-3">Reconcile each digital channel below — saving moves you to the confirmation.</p>
                  <DigitalReconForm outletId={targetOutletIds[0] || ''} date={targetDayStr} onSaved={() => { loadDayStatus(); setWizardStep(3) }} />
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setWizardStep(1)} className="flex-1 py-2 rounded-xl border-2 border-gray-200 text-gray-700 font-medium text-sm">← Back</button>
                    {dayStatus.digitalDone && <button onClick={() => setWizardStep(3)} className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-700 font-medium text-sm">Already done — skip →</button>}
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-2">Step 4 of 4 · End-of-Day Closing</p>
                  {/* Readiness checklist */}
                  <div className="space-y-1.5 mb-3">
                    <div className={`flex items-center gap-2 text-sm ${dayStatus.cashDone ? 'text-green-700' : 'text-rose-600'}`}>
                      <span>{dayStatus.cashDone ? '✓' : '✕'}</span> Cash Reconciliation
                    </div>
                    <div className={`flex items-center gap-2 text-sm ${dayStatus.digitalDone ? 'text-green-700' : 'text-rose-600'}`}>
                      <span>{dayStatus.digitalDone ? '✓' : '✕'}</span> Digital Reconciliation
                    </div>
                    <div className={`flex items-center gap-2 text-sm ${dayStatus.templateDone ? 'text-green-700' : 'text-rose-600'}`}>
                      <span>{dayStatus.templateDone ? '✓' : '✕'}</span> Collection Template Sessions
                    </div>
                  </div>
                  <button onClick={loadDayStatus} className="w-full py-2 mb-3 rounded-xl border-2 border-gray-200 text-gray-600 text-xs font-medium">↻ Refresh status</button>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800 text-sm mb-4">
                    Are you sure all <strong>paid bills, signed bills, discounts, cancellations, cash requests</strong> and other transactions have been properly recorded and reconciled? Once closed, this day can&apos;t be edited (a supervisor can reopen it).
                  </div>
                  {!(dayStatus.cashDone && dayStatus.digitalDone && dayStatus.templateDone) && (
                    <p className="text-xs text-rose-600 mb-2">Complete Cash and Digital reconciliation, and any open Collection Template sessions, before you can close the day.</p>
                  )}
                  <div className="flex flex-col gap-2">
                    <button onClick={closeDay} disabled={closingDay || !dayStatus.cashDone || !dayStatus.digitalDone || !dayStatus.templateDone}
                      className="w-full py-3 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                      {closingDay ? 'Closing…' : '✅ Yes — Close the Day'}
                    </button>
                    <button onClick={() => setWizardStep(4)} className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-gray-700 font-medium text-sm">✏️ No — something needs fixing</button>
                    <button onClick={() => setWizardStep(2)} className="w-full py-2 text-gray-400 text-xs">← Back</button>
                  </div>
                </div>
              )}

              {/* No → go fix the relevant section(s), then return to confirm */}
              {wizardStep === 4 && (
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">Complete or correct, then reconfirm</p>
                  <p className="text-sm text-gray-500 mb-3">Open the section that needs work (opens in a new tab), then come back and reconfirm.</p>
                  <div className="grid grid-cols-1 gap-2">
                    <a href="/petty-cash" target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700">💵 Cash Requests ↗</a>
                    <a href="/petty-cash?recon=cash" target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700">💰 Cash Reconciliation ↗</a>
                    <a href="/petty-cash?recon=digital" target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700">📲 Digital Reconciliation ↗</a>
                    <a href="/signed-bills" target="_blank" rel="noopener noreferrer" className="block px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-sm font-medium text-gray-700">📋 Bills &amp; Transactions Review ↗</a>
                  </div>
                  <button onClick={() => { loadDayStatus(); setWizardStep(3) }} className="w-full py-3 mt-3 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700">Back to confirmation →</button>
                </div>
              )}

              {/* Closed → end-of-day reports */}
              {wizardStep === 5 && (
                <div className="text-center">
                  <div className="text-4xl mb-2">✅</div>
                  <p className="font-bold text-gray-900">Day closed &amp; locked</p>
                  <p className="text-sm text-gray-500 mb-4">{format(targetCloseDate, 'EEEE, dd MMM yyyy')} is now locked. Generate the end-of-day report to share with management.</p>
                  <a href="/daily-report" target="_blank" rel="noopener noreferrer" className="block w-full py-3 mb-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700">📄 Generate end-of-day report ↗</a>
                  <button onClick={() => setCloseWizard(false)} className="w-full py-2.5 rounded-xl border-2 border-gray-200 text-gray-700 font-medium text-sm">Done</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
