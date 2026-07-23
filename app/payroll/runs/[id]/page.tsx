'use client'
import { useEffect, useState, useCallback, Fragment, use } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { RUN_STATUS_COLORS } from '../page'

interface Line {
  id: string; componentCode: string; componentName: string; componentType: string
  bucket: string; amount: number; taxable: boolean; pensionable: boolean; sourceRef: string | null
}
interface Payslip {
  id: string; employeeId: string; employeeNumber: string | null; personId: string | null
  gross: number; taxable: number; pensionable: number; totalDeductions: number
  net: number; employerCost: number; status: string; warnings: string | null; lines: Line[]
}
interface Run {
  id: string; periodKey: string; runType: string; status: string; currency: string
  totalGross: number; totalDeductions: number; totalNet: number; totalEmployerCost: number; employeeCount: number
  periodStart: string; periodEnd: string; processingDate: string; paymentDate: string; lockDate: string
  journalEntryId: string | null; notes: string | null
  approvedAt: string | null; lockedAt: string | null; postedAt: string | null; reversedAt: string | null
  payslips: Payslip[]
}

// What the operator can do next, by status. Each maps to a POST { action }.
type ActionDef = { action: string; label: string; style: string; confirm?: string; reason?: boolean }
function actionsFor(status: string): ActionDef[] {
  switch (status) {
    case 'DRAFT': return [{ action: 'recalculate', label: 'Calculate', style: 'indigo' }]
    case 'CALCULATED': return [
      { action: 'recalculate', label: 'Recalculate', style: 'gray' },
      { action: 'submit', label: 'Submit for approval', style: 'indigo' },
    ]
    case 'PENDING_APPROVAL': return [
      { action: 'approve', label: 'Approve', style: 'green', confirm: 'Approve this run? Only an approver role (or admin) can do this.' },
      { action: 'reject', label: 'Reject', style: 'red', reason: true },
    ]
    case 'APPROVED': return [{ action: 'lock', label: 'Lock', style: 'purple', confirm: 'Lock this run? Locking freezes the figures so it can be posted to the ledger.' }]
    case 'LOCKED': return [{ action: 'post', label: 'Post to ledger', style: 'green', confirm: 'Post this run to the general ledger? This writes a balanced journal entry and settles any staff purchases against receivables.' }]
    case 'POSTED':
    case 'PAID': return [{ action: 'reverse', label: 'Reverse', style: 'red', reason: true, confirm: 'Reverse this posted run? This unwinds the journal entry (and any payout) and restores the settled balances.' }]
    default: return []
  }
}
const BTN: Record<string, string> = {
  indigo: 'bg-indigo-600 text-white hover:bg-indigo-700',
  green: 'bg-green-600 text-white hover:bg-green-700',
  red: 'bg-red-600 text-white hover:bg-red-700',
  purple: 'bg-purple-600 text-white hover:bg-purple-700',
  gray: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
}
const BUCKET_LABEL: Record<string, string> = { EARNING: 'Earnings', DEDUCTION: 'Deductions', EMPLOYER: 'Employer contributions' }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-5 ${className}`}>{children}</div>
}

export default function PayRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { request } = useApi()
  const confirm = useConfirm()
  const [run, setRun] = useState<Run | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [openSlip, setOpenSlip] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Payslips carry only employeeId; resolve display names from the roster so
      // the table reads as people, not ids (the run API stays name-agnostic).
      const [d, emp] = await Promise.all([
        request(`/api/payroll/runs/${id}`),
        request('/api/payroll/employees').catch(() => null),
      ])
      setRun(d.run)
      if (emp?.employees) setNames(Object.fromEntries(emp.employees.map((e: { id: string; name: string }) => [e.id, e.name])))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load run') }
    finally { setLoading(false) }
  }, [request, id])
  useEffect(() => { load() }, [load])

  const runAction = async (a: ActionDef) => {
    let reason: string | undefined
    if (a.reason) {
      const r = window.prompt(`Reason for "${a.label}" (optional):`) ?? ''
      reason = r.trim() || undefined
    }
    if (a.confirm) {
      const ok = await confirm({ title: a.label, message: a.confirm, confirmLabel: a.label })
      if (!ok) return
    }
    setBusy(a.action)
    try {
      await request(`/api/payroll/runs/${id}`, { method: 'POST', body: JSON.stringify({ action: a.action, reason }) })
      toast.success(`${a.label} done`)
      load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : `${a.label} failed`) }
    finally { setBusy(null) }
  }

  const parseWarnings = (raw: string | null): string[] => {
    if (!raw) return []
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <Link href="/payroll/runs" className="text-sm text-indigo-600 hover:text-indigo-800">← All pay runs</Link>

        {loading ? <div className="py-16 text-center text-gray-400">Loading…</div> : !run ? (
          <div className="py-16 text-center text-gray-400">Run not found.</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-gray-900">Pay Run · {run.periodKey}</h1>
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-full ${RUN_STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-500'}`}>{run.status.replace('_', ' ')}</span>
                </div>
                <p className="text-gray-500 text-sm mt-1">
                  {run.runType.toLowerCase()} · {format(new Date(run.periodStart), 'dd MMM')}–{format(new Date(run.periodEnd), 'dd MMM yyyy')} · pay date {run.paymentDate ? format(new Date(run.paymentDate), 'dd MMM yyyy') : '—'}
                  {run.journalEntryId && <> · <Link href="/finance/ledger" className="text-indigo-600 hover:text-indigo-800">journal posted</Link></>}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {actionsFor(run.status).map((a) => (
                  <button key={a.action} onClick={() => runAction(a)} disabled={!!busy}
                    className={`px-4 py-2.5 text-sm font-semibold rounded-xl transition disabled:opacity-40 ${BTN[a.style]}`}>
                    {busy === a.action ? 'Working…' : a.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                <p className="text-xs opacity-80">Net pay</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(run.totalNet)}</p>
                <p className="text-[11px] opacity-70 mt-1">{run.employeeCount} payslip{run.employeeCount === 1 ? '' : 's'}</p>
              </div>
              {[
                ['Gross', run.totalGross], ['Deductions', run.totalDeductions],
                ['Employer cost', run.totalEmployerCost], ['Total cost', run.totalGross + run.totalEmployerCost],
              ].map(([label, val]) => (
                <div key={label as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <p className="text-xs text-gray-500">{label}</p>
                  <p className="text-xl font-bold mt-1 text-gray-800">{formatCurrency(val as number)}</p>
                </div>
              ))}
            </div>

            {/* Payslips */}
            <Card className="!p-0 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">Payslips</h2>
                <span className="text-xs text-gray-400">click a row to see the breakdown</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50"><tr className="text-left text-xs text-gray-400">
                    <th className="px-4 py-2.5">Employee</th><th className="px-2">Warnings</th>
                    <th className="px-2 text-right">Gross</th><th className="px-2 text-right">Deductions</th>
                    <th className="px-2 text-right">Net</th><th className="px-2 text-right">Employer</th><th className="px-4"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {run.payslips.map((s) => {
                      const warns = parseWarnings(s.warnings)
                      const open = openSlip === s.id
                      return (
                        <Fragment key={s.id}>
                          <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpenSlip(open ? null : s.id)}>
                            <td className="px-4 py-3 font-medium text-gray-800">
                              {names[s.employeeId] || s.employeeNumber || s.employeeId.slice(0, 8)}
                              {s.employeeNumber && names[s.employeeId] && <span className="ml-2 text-[11px] text-gray-400">#{s.employeeNumber}</span>}
                              {s.personId && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded">credit-linked</span>}
                            </td>
                            <td className="px-2">{warns.length > 0 && <span className="text-[11px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded-full" title={warns.join('\n')}>⚠ {warns.length}</span>}</td>
                            <td className="px-2 text-right text-gray-700">{formatCurrency(s.gross)}</td>
                            <td className="px-2 text-right text-gray-600">{formatCurrency(s.totalDeductions)}</td>
                            <td className="px-2 text-right font-semibold text-gray-900">{formatCurrency(s.net)}</td>
                            <td className="px-2 text-right text-gray-500">{formatCurrency(s.employerCost)}</td>
                            <td className="px-4 text-right text-indigo-600">{open ? '▾' : '▸'}</td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/60"><td colSpan={7} className="px-4 py-3">
                              <PayslipBreakdown slip={s} warnings={warns} />
                            </td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                    {!run.payslips.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No payslips — recalculate the run (are any employees assigned to this scope with pay components?).</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}

function PayslipBreakdown({ slip, warnings }: { slip: Payslip; warnings: string[] }) {
  const buckets: string[] = ['EARNING', 'DEDUCTION', 'EMPLOYER']
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {buckets.map((b) => {
        const lines = slip.lines.filter((l) => l.bucket === b)
        return (
          <div key={b} className="bg-white rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-semibold text-gray-500 mb-2">{BUCKET_LABEL[b]}</p>
            {lines.length ? (
              <table className="w-full text-xs">
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-1 text-gray-700">{l.componentName}{l.sourceRef && <span className="block text-[10px] text-gray-400">{l.sourceRef}</span>}</td>
                      <td className="py-1 text-right font-medium text-gray-800 tabular-nums">{formatCurrency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-xs text-gray-300">—</p>}
          </div>
        )
      })}
      {warnings.length > 0 && (
        <div className="md:col-span-3 bg-amber-50 border border-amber-100 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-700 mb-1">Warnings</p>
          <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
