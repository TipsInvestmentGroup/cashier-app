'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { SalesAnalytics } from '@/components/SalesAnalytics'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { format, parse, isValid } from 'date-fns'
import { FileSpreadsheet, CheckCircle2, AlertTriangle, Users, Package, Trash2, Eye, ArrowLeft, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Types (mirror lib/sales-import.ts) ──────────────────────────────────────
type IssueCode = 'UNKNOWN_STAFF' | 'UNKNOWN_PRODUCT' | 'LOW_CONFIDENCE_STAFF' | 'LOW_CONFIDENCE_PRODUCT' | 'PRICE_MISMATCH' | 'MISSING_VALUE' | 'MISSING_STAFF' | 'DUPLICATE'
interface RawLine { date?: string; staffRaw: string; productRaw: string; qty: number; amount: number }
interface ResolvedLine {
  date: string; rawStaffName: string; staffName: string; staffMatched: boolean; staffSuggestion: { name: string; score: number } | null
  rawProductName: string; productId: string | null; productName: string; productMatched: boolean; productSuggestion: { id: string; name: string; score: number } | null
  categoryId: string | null; categoryName: string | null; qty: number; amount: number
  unitPriceUploaded: number | null; unitPriceMaster: number | null; priceMismatch: boolean; issues: IssueCode[]
}
interface Outlet { id: string; name: string }
interface Person { id: string; name: string }
interface Product { id: string; name: string; sellingPrice: number; categoryId: string | null; productCategory?: { label: string } | null }
interface ImportRow { id: string; fileName: string; status: string; rowCount: number; totalQty: number; totalAmount: number; unmatchedStaff: number; unmatchedProducts: number; priceExceptions?: number; createdByName?: string; createdAt: string; approvedByName?: string; rejectedReason?: string; outlet?: { name: string }; periodFrom?: string; periodTo?: string; _count?: { lines: number } }

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const UPLOADERS = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

const STATUS_STYLE: Record<string, string> = {
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 border-amber-200',
  IMPORTED: 'bg-green-50 text-green-700 border-green-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  APPROVED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
}
const statusLabel = (s: string) => s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export default function SalesImportPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()
  const canApprove = MGMT.includes(user?.role || '')
  const canUpload = UPLOADERS.includes(user?.role || '')

  const [tab, setTab] = useState<'new' | 'history' | 'analytics'>('new')

  // Master + config
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [events, setEvents] = useState<Outlet[]>([])
  const [groups, setGroups] = useState<Outlet[]>([])
  const [priceLists, setPriceLists] = useState<{ id: string; name: string; isDefault?: boolean }[]>([])
  const [eventId, setEventId] = useState('')
  const [customerGroupId, setCustomerGroupId] = useState('')
  const [defaultDate, setDefaultDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [persons, setPersons] = useState<Person[]>([])
  const [products, setProducts] = useState<Product[]>([])

  // New-import working state
  const [fileName, setFileName] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [period, setPeriod] = useState<{ from?: string; to?: string }>({})
  const [rawLines, setRawLines] = useState<RawLine[]>([])
  const [lines, setLines] = useState<ResolvedLine[]>([])
  const [parsing, setParsing] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // History
  const [history, setHistory] = useState<ImportRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [detail, setDetail] = useState<{ import: ImportRow; lines: ResolvedLineDetail[] } | null>(null)

  useEffect(() => {
    request('/api/outlets').then((o: Outlet[]) => { setOutlets(o || []); if (o?.[0]) setOutletId((cur) => cur || o[0].id) }).catch(() => {})
    request('/api/persons').then((p: Person[]) => setPersons(p || [])).catch(() => {})
    request('/api/products').then((p: Product[]) => setProducts((p || []).filter((x) => x))).catch(() => {})
    request('/api/events').then((e: { rows?: Outlet[] } | Outlet[]) => setEvents(Array.isArray(e) ? e : (e.rows || []))).catch(() => {})
    request('/api/customer-groups').then((g: { rows: Outlet[] }) => setGroups(g.rows || [])).catch(() => {})
    request('/api/price-lists').then((r: { rows: { id: string; name: string; isDefault?: boolean }[] }) => setPriceLists(r.rows || [])).catch(() => {})
  }, [request])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try { const r = await request('/api/sales-imports'); setHistory(r.rows || []) }
    catch { setHistory([]) }
    finally { setHistoryLoading(false) }
  }, [request])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab, loadHistory])

  const runPreview = useCallback(async (raw: RawLine[], dd: string) => {
    setPreviewing(true)
    try {
      const r = await request('/api/sales-imports/preview', { method: 'POST', body: JSON.stringify({ outletId, eventId, customerGroupId, defaultDate: dd, rows: raw }) })
      setLines(r.lines || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Preview failed') }
    finally { setPreviewing(false) }
  }, [request, outletId, eventId, customerGroupId])

  // ── Client-side item-level parse ──
  const onFile = useCallback(async (file: File) => {
    setParsing(true); setFileName(file.name); setLines([]); setRawLines([])
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (wb.SheetNames[0]) setSourceLabel(wb.SheetNames[0])

      const cell = (r: number, c: number) => String(aoa[r]?.[c] ?? '').trim()
      const rowLower = (i: number) => (aoa[i] || []).map((c) => String(c).toLowerCase().trim())

      // Period from a "FROM dd-Mon-yyyy to dd-Mon-yyyy" title row, if present.
      let parsedTo = ''
      for (let i = 0; i < Math.min(aoa.length, 4); i++) {
        const m = cell(i, 0).match(/from\s+(\d{1,2}-\w{3}-\d{4})\s+to\s+(\d{1,2}-\w{3}-\d{4})/i)
        if (m) {
          const from = parse(m[1], 'd-MMM-yyyy', new Date()); const to = parse(m[2], 'd-MMM-yyyy', new Date())
          setPeriod({ from: isValid(from) ? format(from, 'yyyy-MM-dd') : undefined, to: isValid(to) ? format(to, 'yyyy-MM-dd') : undefined })
          if (isValid(to)) parsedTo = format(to, 'yyyy-MM-dd')
          if (cell(i, 0)) setSourceLabel(cell(i, 0))
          break
        }
      }
      if (parsedTo) setDefaultDate(parsedTo)

      // Header row: has a staff column AND a value column.
      const STAFF = ['attendant', 'staff', 'waiter', 'server']
      const ITEM = ['item', 'product', 'descr', 'menu']
      const QTY = ['qty', 'quant', 'count']
      const AMT = ['amount', 'sales', 'revenue', 'value', 'total']
      let hi = -1
      for (let i = 0; i < Math.min(aoa.length, 10); i++) {
        const r = rowLower(i)
        const hasStaff = r.some((h) => STAFF.some((k) => h.includes(k)) || h === 'name')
        const hasVal = r.some((h) => [...QTY, ...AMT].some((k) => h.includes(k)))
        if (hasStaff && hasVal) { hi = i; break }
      }
      if (hi < 0) { toast.error('Could not find a header row (needs a Staff/Attendant column and a Qty/Amount column).'); setParsing(false); return }
      const headers = rowLower(hi)
      const findCol = (keys: string[], exclude: string[] = []) => headers.findIndex((h) => keys.some((k) => h.includes(k)) && !exclude.some((k) => h.includes(k)))
      let si = findCol(STAFF)
      if (si < 0) si = headers.findIndex((h) => h === 'name')
      const ii = findCol(ITEM)
      const qi = findCol(QTY)
      const ai = findCol(AMT, ['qty', 'quant', 'count'])
      const di = headers.findIndex((h) => h.includes('date'))
      if (si < 0 || (qi < 0 && ai < 0)) { toast.error('Could not find the Staff and value columns.'); setParsing(false); return }

      const toISO = (v: unknown) => { if (v instanceof Date) return format(v, 'yyyy-MM-dd'); const d = new Date(String(v)); return isNaN(d.getTime()) ? '' : format(d, 'yyyy-MM-dd') }
      const num = (v: unknown) => Number(String(v ?? '').replace(/[, ]/g, '')) || 0

      let lastStaff = ''
      const out: RawLine[] = []
      for (const r of aoa.slice(hi + 1)) {
        const rawStaff = String(r[si] ?? '').trim()
        if (rawStaff) lastStaff = rawStaff
        const staffRaw = rawStaff || lastStaff
        const productRaw = ii >= 0 ? String(r[ii] ?? '').trim() : ''
        if (productRaw.toLowerCase() === 'total') continue // per-staff subtotal row
        const qty = qi >= 0 ? num(r[qi]) : 0
        const amount = ai >= 0 ? num(r[ai]) : 0
        if (qty <= 0 && amount <= 0) continue // attendant header / blank rows
        const date = di >= 0 && r[di] ? toISO(r[di]) : undefined
        out.push({ date, staffRaw, productRaw, qty, amount })
      }
      if (!out.length) { toast.error('No sales lines found in the file.'); setParsing(false); return }
      setRawLines(out)
      await runPreview(out, parsedTo || defaultDate)
    } catch {
      toast.error('Could not read the file. Use .xlsx, .xlsb or .csv.')
    } finally { setParsing(false) }
  }, [defaultDate, runPreview])

  // Re-run preview if the user changes the default date after parsing.
  const repreview = () => { if (rawLines.length) runPreview(rawLines, defaultDate) }
  // Re-resolve expected prices whenever the sales context changes.
  useEffect(() => { if (rawLines.length) runPreview(rawLines, defaultDate) }, [eventId, customerGroupId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Resolution helpers (mutate the working set client-side) ──
  const recomputeIssues = (l: ResolvedLine): IssueCode[] => {
    const issues: IssueCode[] = []
    if (!l.rawStaffName) issues.push('MISSING_STAFF')
    else if (!l.staffMatched) issues.push('UNKNOWN_STAFF')
    if (l.rawProductName && !l.productMatched) issues.push('UNKNOWN_PRODUCT')
    if (l.priceMismatch) issues.push('PRICE_MISMATCH')
    if (l.qty <= 0 && l.amount <= 0) issues.push('MISSING_VALUE')
    if (l.issues.includes('DUPLICATE')) issues.push('DUPLICATE')
    if (l.issues.includes('LOW_CONFIDENCE_STAFF') && l.staffMatched) issues.push('LOW_CONFIDENCE_STAFF')
    if (l.issues.includes('LOW_CONFIDENCE_PRODUCT') && l.productMatched) issues.push('LOW_CONFIDENCE_PRODUCT')
    return issues
  }
  const applyStaff = (rawStaffName: string, canonical: string) => setLines((ls) => ls.map((l) => {
    if (l.rawStaffName !== rawStaffName) return l
    const nl = { ...l, staffName: canonical, staffMatched: true }; return { ...nl, issues: recomputeIssues(nl) }
  }))
  const applyProduct = (rawProductName: string, p: Product) => setLines((ls) => ls.map((l) => {
    if (l.rawProductName !== rawProductName) return l
    const master = p.sellingPrice
    const up = l.qty > 0 ? Math.round((l.amount / l.qty) * 100) / 100 : null
    const priceMismatch = !!(up && master > 0 && Math.abs(up - master) / master > 0.01)
    const nl = { ...l, productId: p.id, productName: p.name, productMatched: true, categoryId: p.categoryId, categoryName: p.productCategory?.label || null, unitPriceMaster: master, unitPriceUploaded: up, priceMismatch }
    return { ...nl, issues: recomputeIssues(nl) }
  }))
  const createStaff = async (rawStaffName: string) => {
    try {
      const p = await request('/api/persons', { method: 'POST', body: JSON.stringify({ name: rawStaffName, type: 'STAFF_LOSS' }) })
      setPersons((ps) => [...ps, { id: p.id || rawStaffName, name: rawStaffName }])
      applyStaff(rawStaffName, rawStaffName)
      toast.success(`${rawStaffName} added to staff`)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not create staff (managers only)') }
  }

  // ── Price Exceptions ──
  const [acceptedExc, setAcceptedExc] = useState<Set<string>>(new Set())
  const [savePriceListId, setSavePriceListId] = useState('')
  const acceptException = (productId: string) => { setAcceptedExc((s) => { const n = new Set(s); n.add(productId); return n }); toast.success('Exception accepted — the uploaded price will be kept as the actual selling price.') }
  const savePriceToList = async (productId: string, unitPrice: number) => {
    const listId = savePriceListId || priceLists.find((l) => l.isDefault)?.id || priceLists[0]?.id
    if (!listId) return toast.error('Create a price list first (Pricing → Price Lists).')
    try {
      await request(`/api/price-lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ productId, sellingPrice: unitPrice, reason: 'Set from sales import exception' }) })
      toast.success('Price saved to the list — re-checking…')
      runPreview(rawLines, defaultDate) // exception clears once the uploaded price matches the new active price
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save price (managers only)') }
  }

  // ── Submit / approve ──
  const submit = async (approveNow: boolean) => {
    if (!lines.length) return
    if (!outletId) return toast.error('Select the outlet.')
    const blocking = lines.filter((l) => l.issues.some((i) => i === 'UNKNOWN_STAFF' || i === 'MISSING_STAFF' || i === 'MISSING_VALUE'))
    if (blocking.length) return toast.error(`${blocking.length} row(s) still need an attendant match or a value. Resolve them first.`)
    setSubmitting(true)
    try {
      const created = await request('/api/sales-imports', { method: 'POST', body: JSON.stringify({ outletId, eventId, customerGroupId, fileName, sourceLabel, periodFrom: period.from, periodTo: period.to, lines }) })
      if (approveNow && canApprove) {
        await request(`/api/sales-imports/${created.import.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) })
        toast.success('Imported — dashboards, targets and day-close now see this sales data.')
      } else {
        toast.success('Submitted for approval.')
      }
      resetNew(); setTab('history'); loadHistory()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Submit failed') }
    finally { setSubmitting(false) }
  }
  const resetNew = () => { setFileName(''); setSourceLabel(''); setPeriod({}); setRawLines([]); setLines([]) }

  // ── History actions ──
  const approveImport = async (id: string) => {
    try { const r = await request(`/api/sales-imports/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }) }); toast.success(`Imported — ${r.salesMetricRows} metric row(s) written.`); loadHistory(); setDetail(null) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Approve failed') }
  }
  const rejectImport = async (id: string) => {
    const reason = window.prompt('Reason for rejecting this import?') // simple, matches app's lightweight prompts
    if (reason === null) return
    try { await request(`/api/sales-imports/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'reject', reason }) }); toast.success('Rejected.'); loadHistory(); setDetail(null) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Reject failed') }
  }
  const discardImport = async (id: string) => {
    if (!(await confirm({ title: 'Discard import?', message: 'This removes the batch and its lines. It has not updated the system.', danger: true, confirmLabel: 'Discard' }))) return
    try { await request(`/api/sales-imports/${id}`, { method: 'DELETE' }); toast.success('Discarded.'); loadHistory(); setDetail(null) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Discard failed') }
  }
  const viewImport = async (id: string) => {
    try { const r = await request(`/api/sales-imports/${id}`); setDetail({ import: r.import, lines: r.import.lines || [] }) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not open') }
  }

  // ── Derived summary + unmatched groups ──
  const summary = useMemo(() => {
    const s = { rows: lines.length, staff: new Set<string>(), products: new Set<string>(), unmatchedStaff: 0, unmatchedProducts: 0, priceMismatch: 0, dupes: 0, missing: 0, lowConf: 0, qty: 0, amount: 0 }
    for (const l of lines) {
      if (l.staffName) s.staff.add(l.staffName.toLowerCase())
      if (l.productName) s.products.add(l.productName.toLowerCase())
      s.qty += l.qty; s.amount += l.amount
      if (l.issues.includes('UNKNOWN_STAFF') || l.issues.includes('MISSING_STAFF')) s.unmatchedStaff++
      if (l.issues.includes('UNKNOWN_PRODUCT')) s.unmatchedProducts++
      if (l.issues.includes('PRICE_MISMATCH')) s.priceMismatch++
      if (l.issues.includes('DUPLICATE')) s.dupes++
      if (l.issues.includes('MISSING_VALUE')) s.missing++
      if (l.issues.includes('LOW_CONFIDENCE_STAFF') || l.issues.includes('LOW_CONFIDENCE_PRODUCT')) s.lowConf++
    }
    return s
  }, [lines])

  const unmatchedStaffGroups = useMemo(() => {
    const m = new Map<string, { raw: string; suggestion: { name: string; score: number } | null; count: number }>()
    for (const l of lines) if (l.issues.includes('UNKNOWN_STAFF') || l.issues.includes('MISSING_STAFF')) {
      const cur = m.get(l.rawStaffName) || { raw: l.rawStaffName, suggestion: l.staffSuggestion, count: 0 }; cur.count++; m.set(l.rawStaffName, cur)
    }
    return [...m.values()]
  }, [lines])
  const unmatchedProductGroups = useMemo(() => {
    const m = new Map<string, { raw: string; suggestion: { id: string; name: string; score: number } | null; count: number }>()
    for (const l of lines) if (l.issues.includes('UNKNOWN_PRODUCT')) {
      const cur = m.get(l.rawProductName) || { raw: l.rawProductName, suggestion: l.productSuggestion, count: 0 }; cur.count++; m.set(l.rawProductName, cur)
    }
    return [...m.values()]
  }, [lines])
  // Price Exceptions: matched products whose calculated unit price ≠ the active
  // price for the context (or no price on file). Grouped by product.
  const priceExceptionGroups = useMemo(() => {
    const m = new Map<string, { productId: string; name: string; uploaded: number; expected: number; count: number }>()
    for (const l of lines) if (l.priceMismatch && l.productId && !acceptedExc.has(l.productId)) {
      const cur = m.get(l.productId) || { productId: l.productId, name: l.productName, uploaded: l.unitPriceUploaded || 0, expected: l.unitPriceMaster || 0, count: 0 }
      cur.count++; m.set(l.productId, cur)
    }
    return [...m.values()]
  }, [lines, acceptedExc])

  const blockingCount = summary.unmatchedStaff + summary.missing

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-indigo-600" /> Sales Import Center</h1>
            <p className="text-gray-500 text-sm mt-1">Import any POS sales export — all product categories. Upload → Clean → Validate → Map → Preview → Approve → Import. Only approved data updates the system.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 mt-4 mb-5">
          {(['new', 'history', 'analytics'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {t === 'new' ? 'New Import' : t === 'history' ? 'Import History' : 'Analytics'}
            </button>
          ))}
        </div>

        {tab === 'analytics' && <SalesAnalytics />}

        {tab === 'new' && (
          <div className="space-y-5">
            {!canUpload && <EmptyState icon="🔒" title="No access" hint="You don't have permission to import sales." />}
            {canUpload && (
              <>
                {/* Config */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
                      <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                        {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Sales date {period.to && <span className="text-gray-400">(from file)</span>}</label>
                      <input type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} onBlur={repreview}
                        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                    </div>
                    <div className="flex items-end">
                      <label className="block w-full">
                        <span className="sr-only">Choose file</span>
                        <div className="w-full px-3 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-center cursor-pointer hover:border-indigo-300 transition text-gray-600 font-medium truncate flex items-center justify-center gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-gray-400" /> {fileName || 'Choose Excel/CSV'}
                        </div>
                        <input type="file" accept=".xlsx,.xls,.xlsb,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
                      </label>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Event <span className="text-gray-400">(optional)</span></label>
                      <select value={eventId} onChange={(e) => setEventId(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                        <option value="">None</option>
                        {events.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Customer group <span className="text-gray-400">(optional)</span></label>
                      <select value={customerGroupId} onChange={(e) => setCustomerGroupId(e.target.value)}
                        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                        <option value="">None</option>
                        {groups.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-2">Unit Price is calculated as <strong>Amount ÷ Qty</strong> and checked against the price list for this <strong>outlet / event / customer group / date</strong>. Set the context so the expected price resolves correctly.</p>
                  {sourceLabel && <p className="text-[11px] text-gray-400 mt-1 truncate">Source: {sourceLabel}{period.from && ` · ${period.from} → ${period.to}`}</p>}
                  {(parsing || previewing) && <p className="text-sm text-indigo-500 mt-3 animate-pulse">{parsing ? 'Reading file…' : 'Matching to master data…'}</p>}
                </div>

                {lines.length > 0 && (
                  <>
                    {/* Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                      <Stat label="Lines" value={summary.rows} />
                      <Stat label="Staff" value={summary.staff.size} icon={Users} />
                      <Stat label="Products" value={summary.products.size} icon={Package} />
                      <Stat label="Total qty" value={summary.qty.toLocaleString()} />
                      <Stat label="Total amount" value={formatCurrency(summary.amount)} wide />
                      <Stat label="Needs review" value={blockingCount + summary.unmatchedProducts + summary.priceMismatch} tone={blockingCount ? 'red' : summary.unmatchedProducts + summary.priceMismatch ? 'amber' : 'green'} />
                    </div>

                    {/* Data quality */}
                    <QualityBar summary={summary} />

                    {/* Resolution: unmatched staff */}
                    {unmatchedStaffGroups.length > 0 && (
                      <ResolvePanel title={`Unmatched attendants (${unmatchedStaffGroups.length})`} tone="red" hint="These must be matched or created before importing — otherwise their sales won't line up with collections and targets.">
                        {unmatchedStaffGroups.map((g) => (
                          <div key={g.raw} className="flex items-center justify-between gap-2 flex-wrap py-1.5">
                            <span className="font-medium text-gray-800 text-sm">{g.raw || <em className="text-red-500">(blank)</em>} <span className="text-gray-400 text-xs">×{g.count}</span></span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {g.suggestion && <button onClick={() => applyStaff(g.raw, g.suggestion!.name)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Use “{g.suggestion.name}” ({Math.round(g.suggestion.score * 100)}%)</button>}
                              <select defaultValue="" onChange={(e) => { if (e.target.value) applyStaff(g.raw, e.target.value) }} className="px-2 py-1 rounded-lg text-xs border-2 border-gray-200 focus:border-indigo-500 focus:outline-none bg-white max-w-[160px]">
                                <option value="">Match to…</option>
                                {persons.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                              </select>
                              <button onClick={() => createStaff(g.raw)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100">+ Create</button>
                            </div>
                          </div>
                        ))}
                      </ResolvePanel>
                    )}

                    {/* Resolution: unmatched products (optional) */}
                    {unmatchedProductGroups.length > 0 && (
                      <ResolvePanel title={`Unmatched products (${unmatchedProductGroups.length})`} tone="amber" hint="Optional — matching links each item to the catalogue for product analytics. Unmatched items still import as raw text.">
                        {unmatchedProductGroups.slice(0, 40).map((g) => (
                          <div key={g.raw} className="flex items-center justify-between gap-2 flex-wrap py-1.5">
                            <span className="font-medium text-gray-800 text-sm">{g.raw} <span className="text-gray-400 text-xs">×{g.count}</span></span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {g.suggestion && <button onClick={() => { const p = products.find((x) => x.id === g.suggestion!.id); if (p) applyProduct(g.raw, p) }} className="px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Use “{g.suggestion.name}” ({Math.round(g.suggestion.score * 100)}%)</button>}
                              <select defaultValue="" onChange={(e) => { const p = products.find((x) => x.id === e.target.value); if (p) applyProduct(g.raw, p) }} className="px-2 py-1 rounded-lg text-xs border-2 border-gray-200 focus:border-indigo-500 focus:outline-none bg-white max-w-[180px]">
                                <option value="">Match to…</option>
                                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                          </div>
                        ))}
                        {unmatchedProductGroups.length > 40 && <p className="text-xs text-gray-400 pt-1">+ {unmatchedProductGroups.length - 40} more…</p>}
                      </ResolvePanel>
                    )}

                    {/* Price exceptions — unit price ≠ active price for the context */}
                    {priceExceptionGroups.length > 0 && (
                      <ResolvePanel title={`Price exceptions (${priceExceptionGroups.length})`} tone="amber" hint="The calculated unit price doesn't match an active price for this outlet/event/customer-group/date. Review each — the import is never rejected; unresolved exceptions still import at the uploaded price and are flagged in analytics.">
                        {canApprove && priceLists.length > 0 && (
                          <div className="flex items-center gap-2 py-1.5 text-xs">
                            <span className="text-gray-500">Save new prices into:</span>
                            <select value={savePriceListId} onChange={(e) => setSavePriceListId(e.target.value)} className="px-2 py-1 rounded-lg border-2 border-gray-200 focus:border-indigo-500 focus:outline-none bg-white">
                              <option value="">Default list</option>
                              {priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                        )}
                        {priceExceptionGroups.slice(0, 40).map((g) => (
                          <div key={g.productId} className="flex items-center justify-between gap-2 flex-wrap py-1.5">
                            <span className="text-sm"><span className="font-medium text-gray-800">{g.name}</span> <span className="text-gray-400 text-xs">×{g.count}</span><br /><span className="text-xs text-gray-500">Uploaded <strong className="text-amber-700">{formatCurrency(g.uploaded)}</strong> {g.expected > 0 ? <>vs expected <strong>{formatCurrency(g.expected)}</strong></> : <em className="text-gray-400">(no price on file)</em>}</span></span>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button onClick={() => acceptException(g.productId)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200">Accept price</button>
                              {canApprove && <button onClick={() => savePriceToList(g.productId, g.uploaded)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Save {formatCurrency(g.uploaded)} to price list</button>}
                            </div>
                          </div>
                        ))}
                        {priceExceptionGroups.length > 40 && <p className="text-xs text-gray-400 pt-1">+ {priceExceptionGroups.length - 40} more…</p>}
                      </ResolvePanel>
                    )}

                    {/* Preview table */}
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-800 text-sm">Preview <span className="text-gray-400 font-normal">(first 100 of {lines.length})</span></h3>
                      </div>
                      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left font-semibold">Date</th>
                              <th className="px-3 py-2 text-left font-semibold">Attendant</th>
                              <th className="px-3 py-2 text-left font-semibold">Product</th>
                              <th className="px-3 py-2 text-left font-semibold">Category</th>
                              <th className="px-3 py-2 text-right font-semibold">Qty</th>
                              <th className="px-3 py-2 text-right font-semibold">Amount</th>
                              <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                              <th className="px-3 py-2 text-right font-semibold">Expected</th>
                              <th className="px-3 py-2 text-left font-semibold">Flags</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {lines.slice(0, 100).map((l, i) => (
                              <tr key={i} className="hover:bg-gray-50">
                                <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{l.date}</td>
                                <td className="px-3 py-1.5 font-medium text-gray-800">{l.staffName || <em className="text-red-500">(blank)</em>}{!l.staffMatched && <Dot color="red" />}</td>
                                <td className="px-3 py-1.5 text-gray-700">{l.productName}{l.rawProductName && !l.productMatched && <Dot color="amber" />}</td>
                                <td className="px-3 py-1.5 text-gray-500">{l.categoryName || '—'}</td>
                                <td className="px-3 py-1.5 text-right text-gray-700">{l.qty || ''}</td>
                                <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{l.amount ? formatCurrency(l.amount) : ''}</td>
                                <td className={`px-3 py-1.5 text-right ${l.priceMismatch ? 'text-amber-700 font-semibold' : 'text-gray-700'}`}>{l.unitPriceUploaded != null ? formatCurrency(l.unitPriceUploaded) : ''}</td>
                                <td className="px-3 py-1.5 text-right text-gray-500">{l.unitPriceMaster ? formatCurrency(l.unitPriceMaster) : '—'}</td>
                                <td className="px-3 py-1.5"><Flags issues={l.issues} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between gap-3 flex-wrap sticky bottom-0 bg-gray-50 py-3">
                      <div className="text-sm text-gray-500">
                        {blockingCount > 0 ? <span className="text-red-600 font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> {blockingCount} row(s) block import</span> : <span className="text-green-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Ready to import</span>}
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={resetNew} disabled={submitting}>Clear</Button>
                        <Button variant="outline" onClick={() => submit(false)} disabled={submitting || blockingCount > 0}>Submit for approval</Button>
                        {canApprove && <Button onClick={() => submit(true)} disabled={submitting || blockingCount > 0}>{submitting ? 'Importing…' : 'Approve & Import'}</Button>}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {historyLoading ? <p className="p-6 text-gray-400 text-sm">Loading…</p> : history.length === 0 ? (
              <EmptyState icon="📤" title="No imports yet" hint="Uploaded sales batches appear here with their approval status." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">File</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Outlet</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Lines</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                      <th className="px-4 py-2.5 text-left font-semibold">By</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {history.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5"><div className="font-medium text-gray-800 truncate max-w-[180px]">{r.fileName}</div><div className="text-[11px] text-gray-400">{formatDateTime(r.createdAt)}</div></td>
                        <td className="px-4 py-2.5 text-gray-600">{r.outlet?.name || '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-700">{r._count?.lines ?? r.rowCount}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatCurrency(r.totalAmount)}</td>
                        <td className="px-4 py-2.5"><span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold border ${STATUS_STYLE[r.status] || STATUS_STYLE.DRAFT}`}>{statusLabel(r.status)}</span>{r.unmatchedStaff > 0 && r.status === 'PENDING_APPROVAL' && <span className="ml-1 text-[10px] text-red-500">{r.unmatchedStaff} unmatched</span>}{(r.priceExceptions ?? 0) > 0 && <span className="ml-1 text-[10px] text-amber-600">{r.priceExceptions} price exc</span>}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{r.createdByName}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => viewImport(r.id)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" title="View"><Eye className="w-4 h-4" /></button>
                            {r.status === 'PENDING_APPROVAL' && canApprove && <>
                              <button onClick={() => approveImport(r.id)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100">Approve</button>
                              <button onClick={() => rejectImport(r.id)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Reject</button>
                            </>}
                            {r.status !== 'IMPORTED' && <button onClick={() => discardImport(r.id)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Discard"><Trash2 className="w-4 h-4" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {detail && <DetailModal detail={detail} onClose={() => setDetail(null)} />}
      </div>
    </AppShell>
  )
}

// ─── Small presentational helpers ────────────────────────────────────────────
interface ResolvedLineDetail extends ResolvedLine { id: string }

function Stat({ label, value, icon: Icon, tone, wide }: { label: string; value: string | number; icon?: React.ElementType; tone?: 'red' | 'amber' | 'green'; wide?: boolean }) {
  const toneCls = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-green-600' : 'text-gray-900'
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-3 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <div className="text-[11px] text-gray-500 flex items-center gap-1">{Icon && <Icon className="w-3.5 h-3.5" />}{label}</div>
      <div className={`text-lg font-bold ${toneCls} truncate`}>{value}</div>
    </div>
  )
}

function QualityBar({ summary }: { summary: { unmatchedStaff: number; unmatchedProducts: number; priceMismatch: number; dupes: number; missing: number; lowConf: number } }) {
  const items = [
    { label: 'Unknown staff', n: summary.unmatchedStaff, tone: 'red' },
    { label: 'Missing values', n: summary.missing, tone: 'red' },
    { label: 'Unmatched products', n: summary.unmatchedProducts, tone: 'amber' },
    { label: 'Price exceptions', n: summary.priceMismatch, tone: 'amber' },
    { label: 'Duplicates', n: summary.dupes, tone: 'amber' },
    { label: 'Low-confidence', n: summary.lowConf, tone: 'amber' },
  ].filter((i) => i.n > 0)
  if (!items.length) return <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> All rows clean — matched staff, products and values.</div>
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <span key={i.label} className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${i.tone === 'red' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{i.label}: {i.n}</span>
      ))}
    </div>
  )
}

function ResolvePanel({ title, hint, tone, children }: { title: string; hint: string; tone: 'red' | 'amber'; children: React.ReactNode }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'red' ? 'border-red-200 bg-red-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
      <h3 className={`text-sm font-bold ${tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>{title}</h3>
      <p className="text-xs text-gray-500 mb-2">{hint}</p>
      <div className="divide-y divide-gray-100 bg-white/60 rounded-xl px-3">{children}</div>
    </div>
  )
}

function Dot({ color }: { color: 'red' | 'amber' }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle ${color === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />
}

const ISSUE_LABEL: Record<string, { text: string; cls: string }> = {
  UNKNOWN_STAFF: { text: 'staff?', cls: 'bg-red-100 text-red-700' },
  MISSING_STAFF: { text: 'no staff', cls: 'bg-red-100 text-red-700' },
  MISSING_VALUE: { text: 'no value', cls: 'bg-red-100 text-red-700' },
  UNKNOWN_PRODUCT: { text: 'product?', cls: 'bg-amber-100 text-amber-700' },
  PRICE_MISMATCH: { text: 'price exc', cls: 'bg-amber-100 text-amber-700' },
  DUPLICATE: { text: 'dupe', cls: 'bg-amber-100 text-amber-700' },
  LOW_CONFIDENCE_STAFF: { text: '~staff', cls: 'bg-indigo-100 text-indigo-700' },
  LOW_CONFIDENCE_PRODUCT: { text: '~product', cls: 'bg-indigo-100 text-indigo-700' },
}
function Flags({ issues }: { issues: string[] }) {
  if (!issues.length) return <CheckCircle2 className="w-4 h-4 text-green-500" />
  return <div className="flex flex-wrap gap-1">{issues.map((i) => { const m = ISSUE_LABEL[i]; return m ? <span key={i} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${m.cls}`}>{m.text}</span> : null })}</div>
}

function DetailModal({ detail, onClose }: { detail: { import: ImportRow; lines: ResolvedLineDetail[] }; onClose: () => void }) {
  const imp = detail.import
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600" /> {imp.fileName}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{imp.outlet?.name} · {imp.rowCount} lines · {formatCurrency(imp.totalAmount)} · <span className="font-semibold">{statusLabel(imp.status)}</span>{imp.rejectedReason && ` · ${imp.rejectedReason}`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0">
              <tr><th className="px-3 py-2 text-left font-semibold">Date</th><th className="px-3 py-2 text-left font-semibold">Attendant</th><th className="px-3 py-2 text-left font-semibold">Product</th><th className="px-3 py-2 text-left font-semibold">Category</th><th className="px-3 py-2 text-right font-semibold">Qty</th><th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-3 py-2 text-right font-semibold">Unit</th><th className="px-3 py-2 text-right font-semibold">Expected</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {detail.lines.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">{typeof l.date === 'string' ? l.date.slice(0, 10) : ''}</td>
                  <td className="px-3 py-1.5 font-medium text-gray-800">{l.staffName}</td>
                  <td className="px-3 py-1.5 text-gray-700">{l.productName}</td>
                  <td className="px-3 py-1.5 text-gray-500">{l.categoryName || '—'}</td>
                  <td className="px-3 py-1.5 text-right text-gray-700">{l.qty || ''}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{l.amount ? formatCurrency(l.amount) : ''}</td>
                  <td className={`px-3 py-1.5 text-right ${l.priceMismatch ? 'text-amber-700 font-semibold' : 'text-gray-600'}`}>{l.unitPriceUploaded != null ? formatCurrency(l.unitPriceUploaded) : ''}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{l.unitPriceMaster ? formatCurrency(l.unitPriceMaster) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
