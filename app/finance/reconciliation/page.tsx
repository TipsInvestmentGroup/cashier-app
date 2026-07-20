'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileSpreadsheet } from 'lucide-react'
import toast from 'react-hot-toast'

interface CompanyAccount { id: string; accountName: string }
interface ReconItem { id: string; source: string; transactionDate: string; description: string | null; amount: number; matchStatus: string }
interface Reconciliation {
  id: string; periodStart: string; periodEnd: string; statementBalance: number; glBalance: number; status: string
  companyPaymentAccount: CompanyAccount; items: ReconItem[]
}
interface ExceptionRow { id: string; type: string; severity: string; message: string; link: string }

const MATCH_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = { MATCHED: 'green', UNMATCHED: 'amber', MISSING: 'red', DUPLICATE: 'red' }
const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'gray'> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'gray' }

export default function ReconciliationPage() {
  const { request } = useApi()
  const [accounts, setAccounts] = useState<CompanyAccount[]>([])
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([])
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [accountId, setAccountId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [statementBalance, setStatementBalance] = useState('')
  const [lines, setLines] = useState<{ date: string; description: string; amount: string }[]>([{ date: '', description: '', amount: '' }])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [acc, recs, exc] = await Promise.all([
        request('/api/finance/company-accounts'), request('/api/finance/reconciliations'), request('/api/finance/exceptions'),
      ])
      setAccounts(acc || []); setReconciliations(recs || []); setExceptions(exc || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const addLine = () => setLines((prev) => [...prev, { date: '', description: '', amount: '' }])
  const updateLine = (i: number, field: 'date' | 'description' | 'amount', value: string) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i))

  /** Bank/mobile-money statement import — same client-side xlsx parsing
   *  convention as components/SystemSalesUploadModal.tsx and
   *  components/UploadSalesModal.tsx: read entirely in the browser, never
   *  send the raw file to the server, and only populate the (already
   *  editable) statement lines below — nothing is submitted until the user
   *  reviews them and clicks "Create & Match", same as every other import
   *  in this app. Accepts either a single Amount column (+ = in, − = out)
   *  or separate Debit/Credit columns (amount = credit − debit). */
  const onFile = async (file: File) => {
    setParsing(true); setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

      const DATE_KEYS = ['date']
      const DESC_KEYS = ['description', 'narrative', 'details', 'particulars', 'memo']
      const AMOUNT_KEYS = ['amount', 'value']
      const DEBIT_KEYS = ['debit', 'withdrawal', 'money out', 'paid out']
      const CREDIT_KEYS = ['credit', 'deposit', 'money in', 'paid in']
      const row = (i: number) => (aoa[i] || []).map((c) => String(c).toLowerCase().trim())

      let hi = -1
      for (let i = 0; i < Math.min(aoa.length, 8); i++) {
        const r = row(i)
        const hasDate = r.some((h) => DATE_KEYS.some((k) => h.includes(k)))
        const hasAmount = r.some((h) => AMOUNT_KEYS.some((k) => h.includes(k))) || r.some((h) => DEBIT_KEYS.some((k) => h.includes(k))) || r.some((h) => CREDIT_KEYS.some((k) => h.includes(k)))
        if (hasDate && hasAmount) { hi = i; break }
      }
      if (hi < 0) { toast.error('Could not find a header row with a Date column and an Amount (or Debit/Credit) column.'); setFileName(''); return }

      const headers = row(hi)
      const di = headers.findIndex((h) => DATE_KEYS.some((k) => h.includes(k)))
      const desci = headers.findIndex((h) => DESC_KEYS.some((k) => h.includes(k)))
      const ai = headers.findIndex((h) => AMOUNT_KEYS.some((k) => h.includes(k)))
      const debiti = headers.findIndex((h) => DEBIT_KEYS.some((k) => h.includes(k)))
      const crediti = headers.findIndex((h) => CREDIT_KEYS.some((k) => h.includes(k)))
      if (di < 0 || (ai < 0 && debiti < 0 && crediti < 0)) { toast.error('Could not find the Date and Amount/Debit/Credit columns.'); setFileName(''); return }

      const parseNum = (v: unknown) => Number(String(v ?? '').replace(/[, ]/g, '')) || 0
      const parseDate = (v: unknown) => {
        if (v instanceof Date) return v
        const d = new Date(String(v))
        return Number.isNaN(d.getTime()) ? null : d
      }

      const parsed: { date: string; description: string; amount: string }[] = []
      for (const r of aoa.slice(hi + 1)) {
        const date = parseDate(r[di])
        if (!date) continue
        const amount = ai >= 0 ? parseNum(r[ai]) : parseNum(r[crediti]) - parseNum(r[debiti])
        if (!amount) continue
        parsed.push({ date: date.toISOString().slice(0, 10), description: desci >= 0 ? String(r[desci] ?? '') : '', amount: String(amount) })
      }
      if (!parsed.length) { toast.error('No valid rows found (need a date and a non-zero amount).'); setFileName(''); return }
      setLines(parsed)
      toast.success(`Parsed ${parsed.length} statement lines`)
    } catch {
      toast.error('Could not read the file. Use .xlsx or .csv.'); setFileName('')
    } finally { setParsing(false) }
  }

  const createReconciliation = async () => {
    if (!accountId || !periodStart || !periodEnd || !statementBalance) return toast.error('Account, period, and the statement closing balance are required')
    const statementLines = lines.filter((l) => l.date && l.amount).map((l) => ({ transactionDate: l.date, description: l.description, amount: Number(l.amount) }))
    try {
      await request('/api/finance/reconciliations', {
        method: 'POST',
        body: JSON.stringify({ companyPaymentAccountId: accountId, periodStart, periodEnd, statementBalance: Number(statementBalance), statementLines }),
      })
      toast.success('Reconciliation created and auto-matched'); setStatementBalance(''); setLines([{ date: '', description: '', amount: '' }]); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not create the reconciliation') }
  }

  const submit = async (id: string) => {
    try { await request(`/api/finance/reconciliations/${id}/submit`, { method: 'POST' }); toast.success('Submitted for approval'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not submit') }
  }
  const approve = async (id: string) => {
    try { await request(`/api/finance/reconciliations/${id}/approve`, { method: 'POST' }); toast.success('Approved'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not approve') }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation</h1>
          <p className="text-gray-500 text-sm">Match a bank/mobile-money statement against the ledger, and review data-quality exceptions</p>
        </div>

        <Card>
          <CardHeader title="Exception report" subtitle="Data-quality issues detected automatically — not exhaustive, see what's checked in lib/finance-exceptions.ts" />
          {exceptions.length === 0 ? <EmptyState icon="✅" title="No exceptions found" /> : (
            <div className="divide-y divide-gray-50">
              {exceptions.map((e) => (
                <div key={e.id} className="flex items-center gap-3 py-2 text-sm">
                  <Badge tone={SEVERITY_TONE[e.severity] || 'gray'}>{e.severity}</Badge>
                  <span className="flex-1 text-gray-700">{e.message}</span>
                  <a href={e.link} className="text-xs text-indigo-600 hover:underline">View</a>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Start a reconciliation" subtitle="Enter the statement's closing balance and its transaction lines — matching runs automatically" />
          <div className="flex flex-wrap gap-2 mb-3">
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">Account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountName}</option>)}
            </select>
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="number" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="Statement closing balance"
              className="w-52 px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl p-4 mb-3 cursor-pointer hover:border-indigo-300 transition">
            <FileSpreadsheet className="w-6 h-6 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-600 font-medium flex-1">{fileName || 'Import a statement file (.xlsx or .csv) — needs a Date column and an Amount (or Debit/Credit) column'}</span>
            {parsing && <span className="text-xs text-gray-400">Reading…</span>}
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
          </label>
          <p className="text-xs text-gray-400 mb-2">Statement lines — imported rows land here too, still editable before you match:</p>
          <div className="space-y-2 mb-3">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input type="date" value={l.date} onChange={(e) => updateLine(i, 'date', e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                <input value={l.description} onChange={(e) => updateLine(i, 'description', e.target.value)} placeholder="Description"
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                <input type="number" value={l.amount} onChange={(e) => updateLine(i, 'amount', e.target.value)} placeholder="Amount (+ in / − out)"
                  className="w-40 px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                <button onClick={() => removeLine(i)} className="px-2 text-gray-400 hover:text-red-600">✕</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={addLine} className="px-3 py-2 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">+ Add Line</button>
            <button onClick={createReconciliation} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Create &amp; Match</button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Reconciliations" />
          {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : reconciliations.length === 0 ? (
            <EmptyState icon="🏦" title="No reconciliations yet" />
          ) : (
            <div className="divide-y divide-gray-50">
              {reconciliations.map((r) => {
                const difference = formatCurrency(r.statementBalance - r.glBalance)
                return (
                  <div key={r.id} className="py-2.5">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <span className="flex-1 text-sm font-medium text-gray-800">{r.companyPaymentAccount.accountName}</span>
                      <span className="text-xs text-gray-400">{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</span>
                      <span className="text-xs text-gray-500">Diff: {difference}</span>
                      <Badge tone={r.status === 'APPROVED' ? 'green' : r.status === 'PENDING_APPROVAL' ? 'amber' : 'gray'}>{r.status.replace('_', ' ')}</Badge>
                      {r.status === 'DRAFT' && <button onClick={(ev) => { ev.stopPropagation(); submit(r.id) }} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Submit</button>}
                      {r.status === 'PENDING_APPROVAL' && <button onClick={(ev) => { ev.stopPropagation(); approve(r.id) }} className="px-2.5 py-1 bg-green-50 text-green-700 text-xs font-semibold rounded-lg hover:bg-green-100">Approve</button>}
                    </div>
                    {expanded === r.id && (
                      <div className="mt-2 ml-4 bg-gray-50 rounded-xl p-3 space-y-1">
                        {r.items.map((it) => (
                          <div key={it.id} className="flex items-center gap-2 text-xs">
                            <Badge tone="gray">{it.source}</Badge>
                            <span className="w-24 text-gray-500">{formatDate(it.transactionDate)}</span>
                            <span className="flex-1 text-gray-600">{it.description || '—'}</span>
                            <span className="w-24 text-right text-gray-800">{formatCurrency(it.amount)}</span>
                            <Badge tone={MATCH_TONE[it.matchStatus] || 'gray'}>{it.matchStatus}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
