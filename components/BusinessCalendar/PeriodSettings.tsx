'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'
import {
  DEFAULT_BUSINESS_PERIODS,
  PERIOD_PRESETS,
  normalizeBusinessPeriodFields,
  validateBusinessPeriodFields,
  businessPeriodWarnings,
  monthlyPeriodForDate,
  nextMonthlyPeriod,
  generateMonthlyPeriods,
  payrollPeriodForDate,
  creditCycleForDate,
  type BusinessPeriodFields,
} from '@/lib/business-periods-shared'

type Scope = 'GLOBAL' | 'COMPANY' | 'OUTLET'
interface Outlet { id: string; name: string }
interface Company { id: string; name: string }
interface VersionRow extends BusinessPeriodFields {
  id: string
  scope: Scope
  scopeId: string | null
  effectiveDate: string
  presetName: string
  createdByName: string | null
  reason: string | null
}

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

const todayISO = (): string => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

export function PeriodSettings({ outlets, companies }: { outlets: Outlet[]; companies: Company[] }) {
  const { request } = useApi()
  const [versions, setVersions] = useState<VersionRow[]>([])
  const [saving, setSaving] = useState(false)

  const [scope, setScope] = useState<Scope>('GLOBAL')
  const [scopeId, setScopeId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(todayISO())
  const [preset, setPreset] = useState('CUSTOM')
  const [form, setForm] = useState<BusinessPeriodFields>(DEFAULT_BUSINESS_PERIODS)
  const [reason, setReason] = useState('')

  const loadVersions = useCallback(async () => {
    try {
      const rows = await request('/api/business-calendar/periods')
      setVersions(rows || [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load period versions')
    }
  }, [request])

  useEffect(() => { loadVersions() }, [loadVersions])

  // Pre-fill the form with the newest version already saved for the chosen scope.
  useEffect(() => {
    const forScope = versions
      .filter((v) => v.scope === scope && (scope === 'GLOBAL' || v.scopeId === scopeId))
      .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))
    const latest = forScope[0]
    setForm(latest ? normalizeBusinessPeriodFields(latest) : DEFAULT_BUSINESS_PERIODS)
    setPreset(latest ? latest.presetName : 'CUSTOM')
  }, [scope, scopeId, versions])

  const setField = (k: keyof BusinessPeriodFields, v: number) => {
    setForm((f) => ({ ...f, [k]: v }))
    setPreset('CUSTOM')
  }

  const applyPreset = (key: string) => {
    setPreset(key)
    const p = PERIOD_PRESETS[key]
    if (p) setForm((f) => normalizeBusinessPeriodFields({ ...f, ...p.fields }))
  }

  // Live preview computed straight from the form (reflects unsaved edits),
  // as of today — the same math the server resolver will run.
  const preview = useMemo(() => {
    const at = new Date()
    return {
      business: monthlyPeriodForDate(at, form.businessMonthStartDay),
      businessNext: nextMonthlyPeriod(at, form.businessMonthStartDay),
      financial: monthlyPeriodForDate(at, form.financialMonthStartDay),
      payroll: payrollPeriodForDate(at, form),
      credit: creditCycleForDate(at, form),
      upcoming: generateMonthlyPeriods(at, form.businessMonthStartDay, 4),
    }
  }, [form])

  const warnings = businessPeriodWarnings(form)

  const save = async () => {
    if (scope !== 'GLOBAL' && !scopeId) return toast.error('Choose a company or outlet first')
    const problems = validateBusinessPeriodFields(form)
    if (problems.length) return toast.error(problems.join(' '))
    setSaving(true)
    try {
      await request('/api/business-calendar/periods', {
        method: 'PUT',
        body: JSON.stringify({ scope, scopeId: scope === 'GLOBAL' ? null : scopeId, effectiveDate, presetName: preset, ...form, reason: reason || undefined }),
      })
      toast.success('Period version saved')
      setReason('')
      loadVersions()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const removeVersion = async (id: string) => {
    try { await request(`/api/business-calendar/periods?id=${id}`, { method: 'DELETE' }); toast.success('Removed'); loadVersions() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not remove') }
  }

  const nameFor = (row: VersionRow) =>
    row.scope === 'GLOBAL' ? 'Global Default'
      : row.scope === 'COMPANY' ? (companies.find((c) => c.id === row.scopeId)?.name || row.scopeId)
        : (outlets.find((o) => o.id === row.scopeId)?.name || row.scopeId)

  const inputCls = 'w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Operational Periods</h2>
        <p className="text-gray-500 text-sm">
          Configure the monthly cycles every report and process follows — <b>Business Month</b>, <b>Financial Month</b>, <b>Payroll Period</b> and <b>Credit Cycle</b> — each independent.
          Only the start day is stored; end days are derived automatically, so periods can never overlap or leave gaps. Changes are effective-dated: past reports keep the settings that were in force then.
        </p>
      </div>

      {/* Scope + effective date + preset */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(['GLOBAL', 'COMPANY', 'OUTLET'] as Scope[]).map((s) => (
            <button key={s} onClick={() => { setScope(s); setScopeId('') }}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition ${scope === s ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {s === 'GLOBAL' ? 'Global Default' : s === 'COMPANY' ? 'By Company' : 'By Outlet'}
            </button>
          ))}
        </div>

        {scope !== 'GLOBAL' && (
          <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={inputCls}>
            <option value="">Select {scope === 'COMPANY' ? 'a company' : 'an outlet'}…</option>
            {(scope === 'COMPANY' ? companies : outlets).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Preset" hint="A starting point — every field stays editable after.">
            <select value={preset} onChange={(e) => applyPreset(e.target.value)} className={inputCls}>
              {Object.entries(PERIOD_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Effective From" hint="These settings apply to dates on/after this day. Earlier dates keep the previous version.">
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        {warnings.map((w) => (
          <p key={w} className="text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">⚠️ {w}</p>
        ))}
      </div>

      {/* Business Month */}
      <CycleCard title="🗓️ Business Month" subtitle="Operational, sales, inventory & KPI reporting month.">
        <DayField label="Month Start Day" value={form.businessMonthStartDay} onChange={(v) => setField('businessMonthStartDay', v)} />
        <div className="space-y-1.5">
          <PreviewRow label="Current period" value={preview.business.rangeLabel} badge={preview.business.name} />
          <PreviewRow label="Next period" value={preview.businessNext.rangeLabel} badge={preview.businessNext.name} />
        </div>
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-gray-500 mb-1">Auto-generated upcoming months</p>
          <div className="flex flex-wrap gap-1.5">
            {preview.upcoming.map((p) => (
              <span key={p.key} className="px-2 py-1 bg-indigo-50 text-indigo-700 text-[11px] font-medium rounded-lg">{p.name}: {p.rangeLabel}</span>
            ))}
          </div>
        </div>
      </CycleCard>

      {/* Financial Month */}
      <CycleCard title="📊 Financial Month" subtitle="Accounting period — GL, P&L, Balance Sheet & journals.">
        <DayField label="Month Start Day" value={form.financialMonthStartDay} onChange={(v) => setField('financialMonthStartDay', v)} />
        <PreviewRow label="Current period" value={preview.financial.rangeLabel} badge={preview.financial.name} />
      </CycleCard>

      {/* Payroll Period */}
      <CycleCard title="💰 Payroll Period" subtitle="Attendance, overtime, leave, advances, deductions & final pay. Settlement dates fall in the month after the period starts.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DayField label="Period Start Day" value={form.payrollStartDay} onChange={(v) => setField('payrollStartDay', v)} />
          <DayField label="Lock Day" value={form.payrollLockDay} onChange={(v) => setField('payrollLockDay', v)} />
          <DayField label="Processing Day" value={form.payrollProcessingDay} onChange={(v) => setField('payrollProcessingDay', v)} />
          <DayField label="Salary Payment Day" value={form.payrollPaymentDay} onChange={(v) => setField('payrollPaymentDay', v)} />
        </div>
        <div className="space-y-1.5">
          <PreviewRow label="Current period" value={preview.payroll.rangeLabel} badge={preview.payroll.name} />
          <PreviewRow label="Lock date" value={fmtDate(preview.payroll.lockDate)} />
          <PreviewRow label="Processing date" value={fmtDate(preview.payroll.processingDate)} />
          <PreviewRow label="Salary payment" value={fmtDate(preview.payroll.paymentDate)} />
        </div>
      </CycleCard>

      {/* Credit Cycle */}
      <CycleCard title="💳 Credit Cycle" subtitle="Employee/director/customer credit, signed bills, limits & aging.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <DayField label="Cycle Start Day" value={form.creditStartDay} onChange={(v) => setField('creditStartDay', v)} />
          <DayField label="Limit Reset Day" value={form.creditResetDay} onChange={(v) => setField('creditResetDay', v)} />
          <DayField label="Grace Period (days)" value={form.creditGraceDays} onChange={(v) => setField('creditGraceDays', v)} min={0} max={90} />
        </div>
        <div className="space-y-1.5">
          <PreviewRow label="Current cycle" value={preview.credit.rangeLabel} badge={preview.credit.name} />
          <PreviewRow label="Limit resets" value={fmtDate(preview.credit.resetDate)} />
          {form.creditGraceDays > 0 && <PreviewRow label="Grace ends" value={fmtDate(preview.credit.graceEndDate)} />}
        </div>
      </CycleCard>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
        <Field label="Reason for this change" hint="Optional — recorded in the audit trail above.">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Aligned payroll with new HR policy" className={inputCls} />
        </Field>
        <button onClick={save} disabled={saving} className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
          {saving ? 'Saving…' : `Save ${scope === 'GLOBAL' ? 'Global Default' : scope === 'COMPANY' ? 'Company Version' : 'Outlet Version'}`}
        </button>
      </div>

      {/* Version history */}
      {versions.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Version History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-gray-400">
                  <th className="py-2 pr-3">Scope</th>
                  <th className="py-2 pr-3">Effective</th>
                  <th className="py-2 pr-3">Business</th>
                  <th className="py-2 pr-3">Payroll</th>
                  <th className="py-2 pr-3">Credit</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td className="py-2 pr-3 font-medium text-gray-800">{nameFor(v)}</td>
                    <td className="py-2 pr-3 text-gray-600">{fmtDate(v.effectiveDate)}</td>
                    <td className="py-2 pr-3 text-gray-600">day {v.businessMonthStartDay}</td>
                    <td className="py-2 pr-3 text-gray-600">start {v.payrollStartDay} · pay {v.payrollPaymentDay}</td>
                    <td className="py-2 pr-3 text-gray-600">start {v.creditStartDay}{v.creditGraceDays ? ` · +${v.creditGraceDays}d` : ''}</td>
                    <td className="py-2 pr-3 text-right"><button onClick={() => removeVersion(v.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function DayField({ label, value, onChange, min = 1, max = 31 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <input type="number" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white" />
    </Field>
  )
}

function CycleCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <p className="text-[12px] text-gray-400">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function PreviewRow({ label, value, badge }: { label: string; value: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500 w-32 shrink-0">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
      {badge && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[11px] font-semibold rounded-full">{badge}</span>}
    </div>
  )
}
