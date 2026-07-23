'use client'
import { useEffect, useState, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Lookup { id: string; code: string; name: string; status?: string }
interface Formula { id: string; code: string; name: string; expression: string }
interface Component {
  id: string; code: string; name: string; description: string | null; status: string
  componentType: string; bucket: string; calcMethod: string
  parameters: Record<string, unknown> | null
  taxable: boolean; pensionable: boolean; proratable: boolean; priority: number
  glMappingKey: string | null; minLimit: number | null; maxLimit: number | null
  formulaId: string | null; formulaCode: string | null
  payGroupIds: string[]; employeeAssignmentCount: number
}

const COMPONENT_TYPES = [
  { value: 'EARNING', label: 'Earning', bucket: 'EARNING' },
  { value: 'ALLOWANCE', label: 'Allowance', bucket: 'EARNING' },
  { value: 'BENEFIT', label: 'Benefit', bucket: 'EARNING' },
  { value: 'DEDUCTION', label: 'Deduction', bucket: 'DEDUCTION' },
  { value: 'STATUTORY', label: 'Statutory', bucket: 'DEDUCTION' },
  { value: 'EMPLOYER_CONTRIBUTION', label: 'Employer contribution', bucket: 'EMPLOYER' },
]
const CALC_METHODS = [
  { value: 'FIXED', label: 'Fixed amount' },
  { value: 'PERCENTAGE', label: 'Percentage of a base' },
  { value: 'RATE_QTY', label: 'Rate × quantity' },
  { value: 'TABLE', label: 'Progressive bands' },
  { value: 'FORMULA', label: 'Formula' },
  { value: 'SOURCED', label: 'Sourced (external)' },
]
const SOURCES = ['CREDIT_BALANCE', 'STATUTORY', 'MANUAL', 'LOAN_SCHEDULE', 'ADVANCE']
const COMMON_VARS = ['base', 'gross', 'taxable', 'pensionable', 'net', 'overtimeHours', 'daysWorked', 'unpaidDays']
const BUCKETS: { key: string; label: string }[] = [
  { key: 'EARNING', label: 'Earnings' }, { key: 'DEDUCTION', label: 'Deductions' }, { key: 'EMPLOYER', label: 'Employer contributions' },
]
const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5 cursor-pointer">
      <span className="text-sm text-gray-700">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={`shrink-0 w-11 h-6 rounded-full transition relative ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

// Human-readable one-liner describing how a component computes.
function calcSummary(c: Component): string {
  const p = c.parameters || {}
  switch (c.calcMethod) {
    case 'FIXED': return `Fixed ${formatCurrency(Number(p.amount) || 0)}`
    case 'PERCENTAGE': return `${p.percent ?? 0}% of ${p.of ?? 'base'}`
    case 'RATE_QTY': return `${formatCurrency(Number(p.rate) || 0)} × ${p.qtyVar ?? '?'}`
    case 'TABLE': return `Progressive bands on ${p.var ?? 'taxable'}`
    case 'FORMULA': return `Formula: ${c.formulaCode ?? '—'}`
    case 'SOURCED': return `Sourced: ${p.source ?? '?'}`
    default: return c.calcMethod
  }
}

export default function PayComponentsPage() {
  const { request } = useApi()
  const [components, setComponents] = useState<Component[]>([])
  const [payGroups, setPayGroups] = useState<Lookup[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await request('/api/payroll/components')
      setComponents(d.components || []); setPayGroups(d.payGroups || []); setFormulas(d.formulas || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const deactivate = async (c: Component) => {
    if (!confirm(`Deactivate "${c.name}"? Historical payslips keep it; no new runs will use it.`)) return
    try { await request(`/api/payroll/components/${c.id}`, { method: 'DELETE' }); toast.success('Deactivated'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not deactivate') }
  }

  const activeGroups = payGroups.filter((g) => g.status === 'ACTIVE')
  const groupName = (id: string) => payGroups.find((g) => g.id === id)?.name || '—'

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-5xl space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pay Components</h1>
            <p className="text-gray-500 text-sm">The building blocks of a payslip — every earning, deduction and employer contribution, how it&apos;s calculated, and which pay groups get it. This is the configuration pay runs read. <Link href="/payroll/settings" className="text-indigo-600 hover:text-indigo-800 font-medium">Settings</Link></p>
          </div>
          <button onClick={() => { setCreating(true); setEditing(null) }} className="shrink-0 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New component</button>
        </div>

        {creating && (
          <ComponentEditor mode="create" payGroups={activeGroups} formulas={formulas}
            onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />
        )}

        {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
          BUCKETS.map((b) => {
            const items = components.filter((c) => c.bucket === b.key)
            if (!items.length) return null
            return (
              <div key={b.key}>
                <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">{b.label}</h2>
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                        <th className="py-2 pr-3">Component</th><th className="pr-3">Calculation</th><th className="pr-3">Flags</th>
                        <th className="pr-3">Pay groups</th><th className="pr-3">Status</th><th></th>
                      </tr></thead>
                      <tbody>
                        {items.map((c) => (
                          <Fragment key={c.id}>
                            <tr className="border-b border-gray-50 align-top">
                              <td className="py-2 pr-3"><span className="font-medium text-gray-800">{c.name}</span><span className="block text-[11px] text-gray-400">{c.code}</span></td>
                              <td className="pr-3 text-gray-600">{calcSummary(c)}</td>
                              <td className="pr-3 text-[11px] text-gray-500">
                                {c.taxable && <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">taxable</span>}
                                {c.pensionable && <span className="inline-block mr-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">pensionable</span>}
                                {c.proratable && <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">prorated</span>}
                              </td>
                              <td className="pr-3 text-gray-500 text-xs">
                                {c.payGroupIds.length ? c.payGroupIds.map(groupName).join(', ') : <span className="text-gray-300">none</span>}
                                {c.employeeAssignmentCount > 0 && <span className="block text-[10px] text-indigo-500">+{c.employeeAssignmentCount} employee</span>}
                              </td>
                              <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${c.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.status}</span></td>
                              <td className="text-right whitespace-nowrap">
                                <button onClick={() => { setEditing(editing === c.id ? null : c.id); setCreating(false) }} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">{editing === c.id ? 'Close' : 'Edit'}</button>
                                {c.status === 'ACTIVE' && <button onClick={() => deactivate(c)} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>}
                              </td>
                            </tr>
                            {editing === c.id && (
                              <tr><td colSpan={6} className="pb-4 pt-1">
                                <ComponentEditor mode="edit" component={c} payGroups={activeGroups} formulas={formulas}
                                  onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
                              </td></tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )
          })
        )}
        {!loading && components.length === 0 && (
          <Card><p className="text-center text-gray-400 py-8">No pay components yet. Create one, or seed the payroll framework for a starter set.</p></Card>
        )}
      </div>
    </AppShell>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────
interface Band { from: number; ratePct: number }

function ComponentEditor({ mode, component, payGroups, formulas, onCancel, onSaved }: {
  mode: 'create' | 'edit'; component?: Component; payGroups: Lookup[]; formulas: Formula[]
  onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = mode === 'edit'
  const [saving, setSaving] = useState(false)
  const p = component?.parameters || {}

  const [f, setF] = useState({
    code: component?.code || '', name: component?.name || '', description: component?.description || '',
    componentType: component?.componentType || 'EARNING', calcMethod: component?.calcMethod || 'FIXED',
    taxable: component?.taxable ?? false, pensionable: component?.pensionable ?? false, proratable: component?.proratable ?? false,
    priority: component?.priority ?? 0, glMappingKey: component?.glMappingKey || '',
    minLimit: component?.minLimit ?? '', maxLimit: component?.maxLimit ?? '',
    formulaId: component?.formulaId || (formulas[0]?.id ?? ''),
  })
  // Calc-method parameters, one piece of state per shape.
  const [amount, setAmount] = useState<number>(Number(p.amount) || 0)
  const [percent, setPercent] = useState<number>(Number(p.percent) || 0)
  const [ofVar, setOfVar] = useState<string>(String(p.of || 'base'))
  const [rate, setRate] = useState<number>(Number(p.rate) || 0)
  const [qtyVar, setQtyVar] = useState<string>(String(p.qtyVar || 'overtimeHours'))
  const [tableVar, setTableVar] = useState<string>(String(p.var || 'taxable'))
  const [bands, setBands] = useState<Band[]>(
    Array.isArray(p.bands) ? (p.bands as [number, number][]).map(([from, r]) => ({ from, ratePct: r * 100 })) : [{ from: 0, ratePct: 0 }]
  )
  const [source, setSource] = useState<string>(String(p.source || 'CREDIT_BALANCE'))
  const [statutoryCode, setStatutoryCode] = useState<string>(String(p.statutoryCode || ''))
  const [payGroupIds, setPayGroupIds] = useState<string[]>(component?.payGroupIds || [])

  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const toggleGroup = (id: string) => setPayGroupIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])

  const buildParams = (): Record<string, unknown> => {
    switch (f.calcMethod) {
      case 'FIXED': return { amount: Number(amount) }
      case 'PERCENTAGE': return { percent: Number(percent), of: ofVar }
      case 'RATE_QTY': return { rate: Number(rate), qtyVar }
      case 'TABLE': return { var: tableVar, bands: bands.map((b) => [Number(b.from), Number(b.ratePct) / 100]) }
      case 'SOURCED': return source === 'STATUTORY' ? { source, statutoryCode: statutoryCode || undefined } : { source }
      default: return {}
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        code: f.code, name: f.name, description: f.description, componentType: f.componentType, calcMethod: f.calcMethod,
        parameters: buildParams(), formulaId: f.calcMethod === 'FORMULA' ? f.formulaId : null,
        taxable: f.taxable, pensionable: f.pensionable, proratable: f.proratable, priority: Number(f.priority),
        glMappingKey: f.glMappingKey || null,
        minLimit: f.minLimit === '' ? null : Number(f.minLimit), maxLimit: f.maxLimit === '' ? null : Number(f.maxLimit),
        payGroupIds,
      }
      if (isEdit) await request(`/api/payroll/components/${component!.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
      else await request('/api/payroll/components', { method: 'POST', body: JSON.stringify(payload) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-2xl p-5">
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${component!.name}` : 'New pay component'}</h3>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Name</span>
          <input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Code {isEdit && '(fixed)'}</span>
          <input className={inputCls} value={f.code} disabled={isEdit} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. TRANSPORT_ALLOW" /></label>
        <label className="block"><span className="text-xs text-gray-500">Type</span>
          <select className={inputCls} value={f.componentType} onChange={(e) => set({ componentType: e.target.value })}>
            {COMPONENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></label>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">How it&apos;s calculated</span>
          <select className={inputCls} value={f.calcMethod} onChange={(e) => set({ calcMethod: e.target.value })}>
            {CALC_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Priority (calc order)</span>
          <input type="number" className={inputCls} value={f.priority} onChange={(e) => set({ priority: Number(e.target.value) })} /></label>
        <label className="block"><span className="text-xs text-gray-500">GL mapping key (optional)</span>
          <input className={inputCls} value={f.glMappingKey} onChange={(e) => set({ glMappingKey: e.target.value })} placeholder="e.g. SALARY_EXPENSE" /></label>
      </div>

      {/* Calc-method-specific parameters */}
      <datalist id="var-hints">{COMMON_VARS.map((v) => <option key={v} value={v} />)}</datalist>
      <div className="bg-white rounded-xl border border-gray-100 p-3 mb-3">
        <p className="text-xs font-semibold text-gray-500 mb-2">Parameters</p>
        {f.calcMethod === 'FIXED' && (
          <label className="block max-w-xs"><span className="text-xs text-gray-500">Amount</span>
            <input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
        )}
        {f.calcMethod === 'PERCENTAGE' && (
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            <label className="block"><span className="text-xs text-gray-500">Percent (%)</span>
              <input type="number" className={inputCls} value={percent} onChange={(e) => setPercent(Number(e.target.value))} /></label>
            <label className="block"><span className="text-xs text-gray-500">Of variable</span>
              <input list="var-hints" className={inputCls} value={ofVar} onChange={(e) => setOfVar(e.target.value)} /></label>
          </div>
        )}
        {f.calcMethod === 'RATE_QTY' && (
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            <label className="block"><span className="text-xs text-gray-500">Rate (per unit)</span>
              <input type="number" className={inputCls} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>
            <label className="block"><span className="text-xs text-gray-500">Quantity variable</span>
              <input list="var-hints" className={inputCls} value={qtyVar} onChange={(e) => setQtyVar(e.target.value)} /></label>
          </div>
        )}
        {f.calcMethod === 'TABLE' && (
          <div>
            <label className="block max-w-xs mb-2"><span className="text-xs text-gray-500">Applied to variable</span>
              <input list="var-hints" className={inputCls} value={tableVar} onChange={(e) => setTableVar(e.target.value)} /></label>
            <p className="text-xs text-gray-500 mb-1">Progressive bands — the marginal rate applied above each threshold.</p>
            <div className="space-y-2">
              {bands.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">from</span>
                  <input type="number" className={inputCls + ' max-w-[140px]'} value={b.from} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, from: Number(e.target.value) } : x))} />
                  <input type="number" className={inputCls + ' max-w-[90px]'} value={b.ratePct} onChange={(e) => setBands(bands.map((x, j) => j === i ? { ...x, ratePct: Number(e.target.value) } : x))} />
                  <span className="text-xs text-gray-400">%</span>
                  <button type="button" onClick={() => setBands(bands.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                </div>
              ))}
              <button type="button" onClick={() => setBands([...bands, { from: 0, ratePct: 0 }])} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add band</button>
            </div>
          </div>
        )}
        {f.calcMethod === 'FORMULA' && (
          formulas.length ? (
            <label className="block max-w-md"><span className="text-xs text-gray-500">Formula</span>
              <select className={inputCls} value={f.formulaId} onChange={(e) => set({ formulaId: e.target.value })}>
                {formulas.map((fm) => <option key={fm.id} value={fm.id}>{fm.name} — {fm.expression}</option>)}
              </select></label>
          ) : <p className="text-xs text-amber-600">No formulas exist yet. Seed the framework or add a formula before using this method.</p>
        )}
        {f.calcMethod === 'SOURCED' && (
          <div className="grid sm:grid-cols-2 gap-3 max-w-md">
            <label className="block"><span className="text-xs text-gray-500">Source</span>
              <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
              </select></label>
            {source === 'STATUTORY' && (
              <label className="block"><span className="text-xs text-gray-500">Statutory code</span>
                <input className={inputCls} value={statutoryCode} onChange={(e) => setStatutoryCode(e.target.value)} placeholder="e.g. PAYE" /></label>
            )}
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3 items-end">
        <div className="bg-white rounded-xl border border-gray-100 px-3 py-1.5 sm:col-span-2">
          <Toggle label="Taxable" checked={f.taxable} onChange={(v) => set({ taxable: v })} />
          <Toggle label="Pensionable" checked={f.pensionable} onChange={(v) => set({ pensionable: v })} />
          <Toggle label="Prorated by days worked" checked={f.proratable} onChange={(v) => set({ proratable: v })} />
        </div>
        <label className="block"><span className="text-xs text-gray-500">Min limit (optional)</span>
          <input type="number" className={inputCls} value={f.minLimit} onChange={(e) => set({ minLimit: e.target.value as unknown as number })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Max limit (optional)</span>
          <input type="number" className={inputCls} value={f.maxLimit} onChange={(e) => set({ maxLimit: e.target.value as unknown as number })} /></label>
      </div>

      {/* Pay-group assignment */}
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Assign to pay groups</span>
        {payGroups.length ? (
          <div className="flex flex-wrap gap-2">
            {payGroups.map((g) => (
              <button key={g.id} type="button" onClick={() => toggleGroup(g.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${payGroupIds.includes(g.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>{g.name}</button>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No active pay groups.</p>}
      </div>

      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !f.name || !f.code} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  )
}
