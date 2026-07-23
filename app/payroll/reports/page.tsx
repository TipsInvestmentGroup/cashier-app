'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface RunOpt { id: string; periodKey: string; status: string; runType: string; totalNet: number }
type Tab = 'register' | 'statutory' | 'variance'

const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white'
const BUCKET_LABEL: Record<string, string> = { EARNING: 'Earnings', DEDUCTION: 'Deductions', EMPLOYER: 'Employer contributions' }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 ${className}`}>{children}</div>
}
function downloadCsv(name: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
const runLabel = (r: RunOpt) => `${r.periodKey} · ${r.runType.toLowerCase()} · ${r.status.replace('_', ' ')}`

export default function PayrollReportsPage() {
  const { request } = useApi()
  const [tab, setTab] = useState<Tab>('register')
  const [runs, setRuns] = useState<RunOpt[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, emp] = await Promise.all([
        request('/api/payroll/runs'),
        request('/api/payroll/employees').catch(() => null),
      ])
      setRuns(r.runs || [])
      if (emp?.employees) setNames(Object.fromEntries(emp.employees.map((e: { id: string; name: string }) => [e.id, e.name])))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const nameFor = (id: string, num: string | null) => names[id] || num || id.slice(0, 8)

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payroll Reports</h1>
          <p className="text-gray-500 text-sm">Register, statutory remittance, and period-over-period variance — read straight from the posted run totals. <Link href="/payroll/runs" className="text-indigo-600 hover:text-indigo-800 font-medium">Pay Runs</Link></p>
        </div>

        <div className="flex gap-2">
          {([['register', 'Register'], ['statutory', 'Statutory'], ['variance', 'Variance']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === k ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{label}</button>
          ))}
        </div>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div>
          : runs.length === 0 ? (
            <Card className="p-10 text-center">
              <p className="font-semibold text-gray-800">No pay runs yet</p>
              <p className="text-sm text-gray-500 mt-1">Reports draw on calculated pay runs. Create one from <Link href="/payroll/runs" className="text-indigo-600 hover:text-indigo-800">Pay Runs</Link> first.</p>
            </Card>
          ) : (
            <>
              {tab === 'register' && <RegisterReport runs={runs} nameFor={nameFor} />}
              {tab === 'statutory' && <StatutoryReport runs={runs} />}
              {tab === 'variance' && <VarianceReport runs={runs} />}
            </>
          )}
      </div>
    </AppShell>
  )
}

function RunPicker({ runs, value, onChange, label = 'Pay run' }: { runs: RunOpt[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-semibold text-gray-600">{label}:</span>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
      </select>
    </label>
  )
}

// ─── Register ────────────────────────────────────────────────────────────────
interface RegisterData {
  run: { periodKey: string; status: string; currency: string }
  employees: { employeeId: string; employeeNumber: string | null; gross: number; taxable: number; totalDeductions: number; net: number; employerCost: number; status: string }[]
  components: { code: string; name: string; bucket: string; total: number; count: number }[]
  totals: { gross: number; deductions: number; net: number; employerCost: number; employeeCount: number; totalCost: number }
}
function RegisterReport({ runs, nameFor }: { runs: RunOpt[]; nameFor: (id: string, num: string | null) => string }) {
  const { request } = useApi()
  const [runId, setRunId] = useState(runs[0]?.id || '')
  const [data, setData] = useState<RegisterData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id) { setData(null); return }
    setLoading(true)
    try { setData(await request(`/api/payroll/runs/${id}/report?type=register`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load report'); setData(null) }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load(runId) }, [runId, load])

  const exportCsv = () => {
    if (!data) return
    const rows: (string | number)[][] = [['Employee', 'Number', 'Gross', 'Taxable', 'Deductions', 'Net', 'Employer']]
    data.employees.forEach((e) => rows.push([nameFor(e.employeeId, e.employeeNumber), e.employeeNumber || '', e.gross, e.taxable, e.totalDeductions, e.net, e.employerCost]))
    rows.push(['TOTAL', '', data.totals.gross, '', data.totals.deductions, data.totals.net, data.totals.employerCost])
    downloadCsv(`payroll-register-${data.run.periodKey}.csv`, rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <RunPicker runs={runs} value={runId} onChange={setRunId} />
        {data && <button onClick={exportCsv} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">⬇ Export CSV</button>}
      </div>

      {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : !data ? (
        <Card className="p-8 text-center text-gray-400">Select a pay run.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[['Gross', data.totals.gross], ['Deductions', data.totals.deductions], ['Net', data.totals.net], ['Employer', data.totals.employerCost], ['Total cost', data.totals.totalCost]].map(([l, v]) => (
              <div key={l as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
                <p className="text-[11px] text-gray-500">{l}</p>
                <p className="text-lg font-bold text-gray-800">{formatCurrency(v as number)}</p>
              </div>
            ))}
          </div>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100"><h2 className="font-semibold text-gray-800 text-sm">By employee ({data.totals.employeeCount})</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr className="text-left text-xs text-gray-400">
                  <th className="px-4 py-2">Employee</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">Taxable</th>
                  <th className="px-2 text-right">Deductions</th><th className="px-2 text-right">Net</th><th className="px-4 text-right">Employer</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.employees.map((e) => (
                    <tr key={e.employeeId}>
                      <td className="px-4 py-2 font-medium text-gray-800">{nameFor(e.employeeId, e.employeeNumber)}</td>
                      <td className="px-2 text-right text-gray-700">{formatCurrency(e.gross)}</td>
                      <td className="px-2 text-right text-gray-500">{formatCurrency(e.taxable)}</td>
                      <td className="px-2 text-right text-gray-600">{formatCurrency(e.totalDeductions)}</td>
                      <td className="px-2 text-right font-semibold text-gray-900">{formatCurrency(e.net)}</td>
                      <td className="px-4 text-right text-gray-500">{formatCurrency(e.employerCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100"><h2 className="font-semibold text-gray-800 text-sm">By component</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr className="text-left text-xs text-gray-400">
                  <th className="px-4 py-2">Component</th><th className="px-2">Bucket</th><th className="px-2 text-right">Employees</th><th className="px-4 text-right">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.components.map((c) => (
                    <tr key={c.code}>
                      <td className="px-4 py-2 font-medium text-gray-800">{c.name}<span className="block text-[11px] text-gray-400">{c.code}</span></td>
                      <td className="px-2 text-gray-500">{BUCKET_LABEL[c.bucket] || c.bucket}</td>
                      <td className="px-2 text-right text-gray-500">{c.count}</td>
                      <td className="px-4 text-right font-semibold text-gray-800">{formatCurrency(c.total)}</td>
                    </tr>
                  ))}
                  {!data.components.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No component lines.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Statutory ───────────────────────────────────────────────────────────────
interface StatutoryData {
  run: { periodKey: string }
  items: { code: string; name: string; type: string; total: number; count: number }[]
  total: number
}
function StatutoryReport({ runs }: { runs: RunOpt[] }) {
  const { request } = useApi()
  const [runId, setRunId] = useState(runs[0]?.id || '')
  const [data, setData] = useState<StatutoryData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (id: string) => {
    if (!id) { setData(null); return }
    setLoading(true)
    try { setData(await request(`/api/payroll/runs/${id}/report?type=statutory`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load report'); setData(null) }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load(runId) }, [runId, load])

  const exportCsv = () => {
    if (!data) return
    const rows: (string | number)[][] = [['Item', 'Code', 'Type', 'Employees', 'Amount to remit']]
    data.items.forEach((i) => rows.push([i.name, i.code, i.type, i.count, i.total]))
    rows.push(['TOTAL', '', '', '', data.total])
    downloadCsv(`payroll-statutory-${data.run.periodKey}.csv`, rows)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <RunPicker runs={runs} value={runId} onChange={setRunId} />
        {data && <button onClick={exportCsv} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">⬇ Export CSV</button>}
      </div>
      {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : !data ? (
        <Card className="p-8 text-center text-gray-400">Select a pay run.</Card>
      ) : (
        <>
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-5 shadow max-w-xs">
            <p className="text-sm opacity-80">Total to remit</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(data.total)}</p>
          </div>
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-gray-100"><h2 className="font-semibold text-gray-800 text-sm">Statutory & employer remittances</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50"><tr className="text-left text-xs text-gray-400">
                  <th className="px-4 py-2">Item</th><th className="px-2">Type</th><th className="px-2 text-right">Employees</th><th className="px-4 text-right">Amount</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {data.items.map((i) => (
                    <tr key={i.code}>
                      <td className="px-4 py-2 font-medium text-gray-800">{i.name}<span className="block text-[11px] text-gray-400">{i.code}</span></td>
                      <td className="px-2 text-gray-500">{i.type === 'EMPLOYER_CONTRIBUTION' ? 'employer' : 'statutory'}</td>
                      <td className="px-2 text-right text-gray-500">{i.count}</td>
                      <td className="px-4 text-right font-semibold text-gray-800">{formatCurrency(i.total)}</td>
                    </tr>
                  ))}
                  {!data.items.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No statutory or employer components in this run.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Variance ────────────────────────────────────────────────────────────────
interface Delta { from: number; to: number; change: number; pct: number | null }
interface VarianceData {
  from: { periodKey: string }; to: { periodKey: string }
  gross: Delta; deductions: Delta; net: Delta; employerCost: Delta; headcount: Delta
}
function VarianceReport({ runs }: { runs: RunOpt[] }) {
  const { request } = useApi()
  const [a, setA] = useState(runs[1]?.id || '')
  const [b, setB] = useState(runs[0]?.id || '')
  const [data, setData] = useState<VarianceData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (x: string, y: string) => {
    if (!x || !y) { setData(null); return }
    setLoading(true)
    try { setData(await request(`/api/payroll/reports/variance?a=${x}&b=${y}`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load variance'); setData(null) }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load(a, b) }, [a, b, load])

  const rows: [string, keyof Omit<VarianceData, 'from' | 'to'>, boolean][] = [
    ['Gross', 'gross', true], ['Deductions', 'deductions', true], ['Net pay', 'net', true],
    ['Employer cost', 'employerCost', true], ['Headcount', 'headcount', false],
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <RunPicker runs={runs} value={a} onChange={setA} label="From" />
        <RunPicker runs={runs} value={b} onChange={setB} label="To" />
      </div>
      {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : !data ? (
        <Card className="p-8 text-center text-gray-400">Select two pay runs to compare.</Card>
      ) : a === b ? (
        <Card className="p-8 text-center text-gray-400">Pick two different runs.</Card>
      ) : (
        <>
          <p className="text-sm text-gray-500">Change from <span className="font-semibold text-gray-700">{data.from.periodKey}</span> to <span className="font-semibold text-gray-700">{data.to.periodKey}</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map(([label, key, money]) => {
              const d = data[key]
              const up = d.change > 0, down = d.change < 0
              const color = down ? 'text-green-700' : up ? 'text-red-600' : 'text-gray-500'
              const fmt = (n: number) => money ? formatCurrency(n) : String(n)
              return (
                <Card key={key} className="p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-lg font-bold text-gray-900">{fmt(d.to)}</span>
                    <span className="text-xs text-gray-400">from {fmt(d.from)}</span>
                  </div>
                  <p className={`text-sm font-semibold mt-1 ${color}`}>
                    {up ? '▲' : down ? '▼' : '='} {fmt(Math.abs(d.change))}{d.pct !== null && <span className="text-xs font-normal"> ({d.pct > 0 ? '+' : ''}{d.pct}%)</span>}
                  </p>
                </Card>
              )
            })}
          </div>
          <p className="text-[11px] text-gray-400">Deductions/cost increases show red, decreases green — a heuristic; interpret in context.</p>
        </>
      )}
    </div>
  )
}
