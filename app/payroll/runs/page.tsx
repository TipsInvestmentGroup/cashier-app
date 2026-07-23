'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

interface Run {
  id: string; periodKey: string; runType: string; status: string
  currency: string; totalGross: number; totalDeductions: number; totalNet: number
  totalEmployerCost: number; employeeCount: number
  periodStart: string; periodEnd: string; paymentDate: string; createdAt: string
  payGroupId: string | null; outletId: string | null
}
interface Lookup { id: string; name: string }

// The run lifecycle, in order. Colours mirror the status semantics used across
// the finance module (draft/neutral → in-flight amber → done green → undone gray).
export const RUN_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  CALCULATED: 'bg-blue-50 text-blue-700',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-indigo-50 text-indigo-700',
  LOCKED: 'bg-purple-50 text-purple-700',
  POSTED: 'bg-green-50 text-green-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  REVERSED: 'bg-red-50 text-red-600',
}
const RUN_TYPES = ['REGULAR', 'SUPPLEMENTARY', 'BONUS', 'CORRECTION'] as const
const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}

export default function PayRunsPage() {
  const { request } = useApi()
  const router = useRouter()
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, d] = await Promise.all([
        request('/api/payroll/config').catch(() => null),
        request('/api/payroll/runs'),
      ])
      setEnabled(cfg ? !!cfg.enabled : null)
      setRuns(d.runs || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pay Runs</h1>
            <p className="text-gray-500 text-sm">Create, calculate, approve and post payroll for a period. Each run builds a payslip per employee from their pay-group components, then posts one balanced journal entry to the ledger. <Link href="/payroll/settings" className="text-indigo-600 hover:text-indigo-800 font-medium">Settings</Link> · <Link href="/payroll/employees" className="text-indigo-600 hover:text-indigo-800 font-medium">Employees</Link></p>
          </div>
          {enabled && (
            <button onClick={() => setCreating(true)} className="shrink-0 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New pay run</button>
          )}
        </div>

        {enabled === false && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            The payroll module is <span className="font-semibold">disabled</span>, so no pay runs can be created. Turn it on in <Link href="/payroll/settings" className="underline font-medium">Payroll Settings</Link> first. Existing runs (if any) are still shown below.
          </div>
        )}

        {creating && <CreateRun onCancel={() => setCreating(false)} onCreated={(id) => router.push(`/payroll/runs/${id}`)} />}

        <Card>
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Period</th><th className="pr-3">Type</th><th className="pr-3">Status</th>
                  <th className="pr-3 text-right">Staff</th><th className="pr-3 text-right">Gross</th>
                  <th className="pr-3 text-right">Deductions</th><th className="pr-3 text-right">Net</th>
                  <th className="pr-3 text-right">Employer cost</th><th className="pr-3">Pay date</th><th></th>
                </tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/payroll/runs/${r.id}`)}>
                      <td className="py-2.5 pr-3 font-medium text-gray-800">{r.periodKey}</td>
                      <td className="pr-3 text-gray-500">{r.runType.toLowerCase()}</td>
                      <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${RUN_STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-500'}`}>{r.status.replace('_', ' ')}</span></td>
                      <td className="pr-3 text-right text-gray-600">{r.employeeCount}</td>
                      <td className="pr-3 text-right text-gray-700">{formatCurrency(r.totalGross)}</td>
                      <td className="pr-3 text-right text-gray-600">{formatCurrency(r.totalDeductions)}</td>
                      <td className="pr-3 text-right font-semibold text-gray-900">{formatCurrency(r.totalNet)}</td>
                      <td className="pr-3 text-right text-gray-500">{formatCurrency(r.totalEmployerCost)}</td>
                      <td className="pr-3 text-gray-500">{r.paymentDate ? format(new Date(r.paymentDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-right text-indigo-600 pr-1">›</td>
                    </tr>
                  ))}
                  {!runs.length && <tr><td colSpan={10} className="py-12 text-center text-gray-400">No pay runs yet.{enabled ? ' Create one to get started.' : ''}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

function CreateRun({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const { request } = useApi()
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [runType, setRunType] = useState<(typeof RUN_TYPES)[number]>('REGULAR')
  const [payGroupId, setPayGroupId] = useState('')
  const [outletId, setOutletId] = useState('')
  const [payGroups, setPayGroups] = useState<Lookup[]>([])
  const [outlets, setOutlets] = useState<Lookup[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Lazy-load the optional scope lookups only when the form is open.
    request('/api/payroll/employees').then((d) => setPayGroups((d.payGroups || []).filter((g: { status: string }) => g.status === 'ACTIVE'))).catch(() => {})
    request('/api/outlets').then((d) => setOutlets(Array.isArray(d) ? d : d.outlets || [])).catch(() => {})
  }, [request])

  const create = async () => {
    setSaving(true)
    try {
      const res = await request('/api/payroll/runs', {
        method: 'POST',
        body: JSON.stringify({ date, runType, payGroupId: payGroupId || undefined, outletId: outletId || undefined }),
      })
      toast.success('Run created and calculated')
      onCreated(res.run.id)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not create run') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-2xl p-5">
      <h3 className="font-semibold text-gray-800 mb-1">New pay run</h3>
      <p className="text-xs text-gray-400 mb-3">The pay period is derived automatically from the business calendar for the date you pick. Scope is optional — leave blank to run the whole company.</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="block"><span className="text-xs text-gray-500">Period date</span>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="block"><span className="text-xs text-gray-500">Run type</span>
          <select className={inputCls} value={runType} onChange={(e) => setRunType(e.target.value as (typeof RUN_TYPES)[number])}>
            {RUN_TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Pay group (optional)</span>
          <select className={inputCls} value={payGroupId} onChange={(e) => setPayGroupId(e.target.value)}>
            <option value="">All pay groups</option>
            {payGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Outlet (optional)</span>
          <select className={inputCls} value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">Company-wide</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select></label>
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={create} disabled={saving} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Creating…' : 'Create & calculate'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  )
}
