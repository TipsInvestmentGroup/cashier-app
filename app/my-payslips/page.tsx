'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

interface Line {
  id: string; componentName: string; componentType: string
  bucket: string; amount: number; sourceRef: string | null
}
interface Payslip {
  id: string; employeeNumber: string | null; currency: string; status: string
  gross: number; taxable: number; pensionable: number
  totalDeductions: number; net: number; employerCost: number
  warnings: string | null; createdAt: string
  lines: Line[]
  run: { periodKey: string; paymentDate: string | null }
}

const parseWarnings = (raw: string | null): string[] => {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
}
const periodLabel = (key: string) => {
  // periodKey is "YYYY-MM"; render it as a friendly month.
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return format(new Date(y, m - 1, 1), 'MMMM yyyy')
}

export default function MyPayslipsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [payslips, setPayslips] = useState<Payslip[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await request('/api/payroll/my-payslips')
      const list: Payslip[] = d.payslips || []
      setPayslips(list)
      if (list.length) setOpenId(list[0].id) // open the latest by default
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load payslips') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-5 print:max-w-none">
        <div className="print:hidden">
          <h1 className="text-2xl font-bold text-gray-900">My Payslips</h1>
          <p className="text-gray-500 text-sm">Your finalized payslips, most recent first. Only pay runs that have been approved and locked appear here.</p>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : payslips.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
            <div className="text-4xl mb-3">🧾</div>
            <p className="font-semibold text-gray-800">No payslips yet</p>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">Once a payroll run covering you has been approved and locked, your payslip will show up here — with the full breakdown of your earnings and deductions.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {payslips.map((s) => {
              const open = openId === s.id
              const warns = parseWarnings(s.warnings)
              const earnings = s.lines.filter((l) => l.bucket === 'EARNING')
              const deductions = s.lines.filter((l) => l.bucket === 'DEDUCTION')
              const employer = s.lines.filter((l) => l.bucket === 'EMPLOYER')
              return (
                <div key={s.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
                  {/* Summary row */}
                  <button onClick={() => setOpenId(open ? null : s.id)}
                    className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-gray-50 transition print:hover:bg-transparent">
                    <div>
                      <p className="font-semibold text-gray-900">{periodLabel(s.run.periodKey)}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Paid {s.run.paymentDate ? format(new Date(s.run.paymentDate), 'dd MMM yyyy') : '—'}
                        {s.employeeNumber && <> · #{s.employeeNumber}</>}
                        <span className="ml-2 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-semibold">{s.status}</span>
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Net pay</p>
                      <p className="text-xl font-bold text-gray-900">{formatCurrency(s.net)}</p>
                    </div>
                  </button>

                  {open && (
                    <div className="border-t border-gray-100 p-5 space-y-4">
                      {/* Top-line figures */}
                      <div className="grid grid-cols-3 gap-3">
                        {[['Gross', s.gross, 'text-gray-800'], ['Deductions', s.totalDeductions, 'text-red-600'], ['Net pay', s.net, 'text-green-700']].map(([label, val, cls]) => (
                          <div key={label as string} className="bg-gray-50 rounded-xl p-3 text-center">
                            <p className="text-[11px] text-gray-500">{label}</p>
                            <p className={`text-lg font-bold mt-0.5 ${cls}`}>{formatCurrency(val as number)}</p>
                          </div>
                        ))}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <LineList title="Earnings" lines={earnings} total={s.gross} totalLabel="Gross pay" accent="text-gray-900" />
                        <LineList title="Deductions" lines={deductions} total={s.totalDeductions} totalLabel="Total deductions" accent="text-red-600" />
                      </div>

                      <div className="bg-indigo-50/60 rounded-xl p-4 flex items-center justify-between">
                        <span className="font-semibold text-indigo-900">Take-home (net) pay</span>
                        <span className="text-xl font-bold text-indigo-900">{formatCurrency(s.net)}</span>
                      </div>

                      {employer.length > 0 && (
                        <div>
                          <LineList title="Employer contributions" lines={employer} note="Paid by the company on your behalf — not deducted from your pay." muted />
                        </div>
                      )}

                      {warns.length > 0 && (
                        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 print:hidden">
                          <p className="text-xs font-semibold text-amber-700 mb-1">Notes</p>
                          <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5">{warns.map((w, i) => <li key={i}>{w}</li>)}</ul>
                        </div>
                      )}

                      <div className="flex justify-end print:hidden">
                        <button onClick={() => window.print()} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">🖨 Print / Save PDF</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {user && payslips.length > 0 && (
          <p className="text-[11px] text-gray-400 text-center print:mt-6">Payslips for {user.name}. Amounts in {payslips[0]?.currency || 'TZS'}.</p>
        )}
      </div>
    </AppShell>
  )
}

function LineList({ title, lines, total, totalLabel, accent = 'text-gray-800', note, muted = false }: {
  title: string; lines: Line[]; total?: number; totalLabel?: string; accent?: string; note?: string; muted?: boolean
}) {
  return (
    <div className={`rounded-xl border border-gray-100 p-4 ${muted ? 'bg-gray-50/60' : ''}`}>
      <p className="text-xs font-semibold text-gray-500 mb-2">{title}</p>
      {lines.length === 0 ? <p className="text-xs text-gray-300">—</p> : (
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-50 last:border-0">
                <td className="py-1.5 text-gray-700">{l.componentName}{l.sourceRef && <span className="block text-[10px] text-gray-400">{l.sourceRef}</span>}</td>
                <td className="py-1.5 text-right font-medium text-gray-800 tabular-nums">{formatCurrency(l.amount)}</td>
              </tr>
            ))}
            {total !== undefined && (
              <tr className="border-t-2 border-gray-200">
                <td className="pt-2 text-xs font-semibold text-gray-500">{totalLabel}</td>
                <td className={`pt-2 text-right font-bold tabular-nums ${accent}`}>{formatCurrency(total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {note && <p className="text-[11px] text-gray-400 mt-2">{note}</p>}
    </div>
  )
}
