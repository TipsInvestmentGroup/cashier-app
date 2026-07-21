'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { PeriodSettings } from '@/components/BusinessCalendar/PeriodSettings'
import { useApi } from '@/hooks/useApi'
import {
  DEFAULT_BUSINESS_CALENDAR,
  BUSINESS_HOUR_TEMPLATES,
  normalizeBusinessCalendarFields,
  type BusinessCalendarFields,
} from '@/lib/business-calendar-shared'
import toast from 'react-hot-toast'

type Scope = 'GLOBAL' | 'COMPANY' | 'OUTLET'
interface ConfigRow extends BusinessCalendarFields { id: string; scope: Scope; scopeId: string | null }
interface Outlet { id: string; name: string }
interface Company { id: string; name: string }
interface AuditRow { id: string; scope: Scope; scopeId: string | null; field: string; previousValue: string | null; newValue: string | null; reason: string | null; userName: string | null; createdAt: string }
interface Snapshot {
  config: BusinessCalendarFields
  businessDate: string
  week: { weekStart: string; weekEnd: string; weekNumber: number }
  financialYear: { fyStart: string; fyEnd: string; label: string }
  activeShift: { name: string } | null
  isOpen: boolean
  nextBusinessDayStart: string
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function BusinessCalendarPage() {
  const { request } = useApi()
  const [rows, setRows] = useState<ConfigRow[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [editScope, setEditScope] = useState<Scope>('GLOBAL')
  const [editScopeId, setEditScopeId] = useState<string>('')
  const [form, setForm] = useState<BusinessCalendarFields>(DEFAULT_BUSINESS_CALENDAR)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, o, c, a, s] = await Promise.all([
        request('/api/business-calendar'),
        request('/api/outlets'),
        request('/api/companies'),
        request('/api/business-calendar/audit').catch(() => []),
        request('/api/business-calendar/snapshot').catch(() => null),
      ])
      setRows(cfg || []); setOutlets(o || []); setCompanies(c || []); setAudit(a || []); setSnapshot(s)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load Business Calendar settings')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  // Load the selected scope's existing config into the form whenever selection changes.
  useEffect(() => {
    const existing = rows.find((r) => r.scope === editScope && (editScope === 'GLOBAL' || r.scopeId === editScopeId))
    setForm(existing ? normalizeBusinessCalendarFields(existing) : DEFAULT_BUSINESS_CALENDAR)
  }, [editScope, editScopeId, rows])

  const global = rows.find((r) => r.scope === 'GLOBAL')
  const outletRows = rows.filter((r) => r.scope === 'OUTLET')
  const companyRows = rows.filter((r) => r.scope === 'COMPANY')

  const applyTemplate = (key: string) => {
    const tpl = BUSINESS_HOUR_TEMPLATES[key]
    if (!tpl) return
    setForm((f) => normalizeBusinessCalendarFields({ ...f, templateName: key, ...tpl.fields }))
  }

  const save = async () => {
    if (editScope !== 'GLOBAL' && !editScopeId) return toast.error('Choose a company or outlet first')
    setSaving(true)
    try {
      await request('/api/business-calendar', {
        method: 'PUT',
        body: JSON.stringify({ scope: editScope, scopeId: editScope === 'GLOBAL' ? null : editScopeId, ...form, reason: reason || undefined }),
      })
      toast.success('Business calendar saved')
      setReason('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const removeOverride = async (id: string) => {
    try { await request(`/api/business-calendar?id=${id}`, { method: 'DELETE' }); toast.success('Removed'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not remove') }
  }

  const inputCls = 'w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white'
  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )

  if (loading) return <AppShell><SetupTabs /><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Calendar</h1>
          <p className="text-gray-500 text-sm">
            The single source of truth for &quot;business date&quot; vs. calendar date across the whole system — Collections, Bill References, Reports and more all resolve time through this engine.
            Priority when several apply: Outlet &gt; Company &gt; Global Default.
          </p>
        </div>

        {snapshot && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">📅 Live Business Calendar</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Business Date" value={new Date(snapshot.businessDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} />
              <Stat label="Business Week" value={`#${snapshot.week.weekNumber}`} />
              <Stat label="Financial Year" value={snapshot.financialYear.label} />
              <Stat label="Time Zone" value={snapshot.config.timeZone} />
              <Stat label="Current Shift" value={snapshot.activeShift?.name || '—'} />
              <Stat label="Status" value={snapshot.isOpen ? 'Open' : 'Closed'} color={snapshot.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'} />
              <Stat label="Next Business Day" value={new Date(snapshot.nextBusinessDayStart).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} />
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">Edit Calendar</h2>

          <div className="flex flex-wrap gap-2">
            {(['GLOBAL', 'COMPANY', 'OUTLET'] as Scope[]).map((s) => (
              <button key={s} onClick={() => { setEditScope(s); setEditScopeId('') }}
                className={`px-3 py-2 rounded-xl text-sm font-semibold transition ${editScope === s ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {s === 'GLOBAL' ? 'Global Default' : s === 'COMPANY' ? 'By Company' : 'By Outlet'}
              </button>
            ))}
          </div>

          {editScope !== 'GLOBAL' && (
            <select value={editScopeId} onChange={(e) => setEditScopeId(e.target.value)} className={inputCls}>
              <option value="">Select {editScope === 'COMPANY' ? 'a company' : 'an outlet'}…</option>
              {(editScope === 'COMPANY' ? companies : outlets).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}

          <Field label="Business Hour Template" hint="Pick a starting point — every field below stays fully editable after.">
            <select value={form.templateName} onChange={(e) => applyTemplate(e.target.value)} className={inputCls}>
              {Object.entries(BUSINESS_HOUR_TEMPLATES).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Business Day Start" hint="A moment before this time belongs to the previous business date">
              <input type="time" value={form.businessDayStartTime} onChange={(e) => setForm((f) => ({ ...f, businessDayStartTime: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Business Day End" hint="Informational — end of the trading window">
              <input type="time" value={form.businessDayEndTime} onChange={(e) => setForm((f) => ({ ...f, businessDayEndTime: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Time Zone" hint="IANA zone name, e.g. Africa/Dar_es_Salaam">
              <input value={form.timeZone} onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Week Starts On">
              <select value={form.weekStartDay} onChange={(e) => setForm((f) => ({ ...f, weekStartDay: Number(e.target.value) }))} className={inputCls}>
                {WEEKDAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label="Financial Year Start Month">
              <select value={form.fyStartMonth} onChange={(e) => setForm((f) => ({ ...f, fyStartMonth: Number(e.target.value) }))} className={inputCls}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{new Date(2024, m - 1, 1).toLocaleString('en-US', { month: 'long' })}</option>
                ))}
              </select>
            </Field>
            <Field label="Financial Year Start Day">
              <input type="number" min={1} max={31} value={form.fyStartDay} onChange={(e) => setForm((f) => ({ ...f, fyStartDay: Number(e.target.value) }))} className={inputCls} />
            </Field>
          </div>

          <Field label="Reason for this change" hint="Optional — recorded in the audit trail below">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Aligned Outlet X with new opening hours" className={inputCls} />
          </Field>

          <button onClick={save} disabled={saving} className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
            {saving ? 'Saving…' : `Save ${editScope === 'GLOBAL' ? 'Global Default' : editScope === 'COMPANY' ? 'Company Override' : 'Outlet Override'}`}
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-3">Configured Overrides</h2>
          <ScopeList title="By Company" rows={companyRows} nameFor={(id) => companies.find((c) => c.id === id)?.name || id} onRemove={removeOverride} />
          <ScopeList title="By Outlet" rows={outletRows} nameFor={(id) => outlets.find((o) => o.id === id)?.name || id} onRemove={removeOverride} />
          {!global && <p className="text-xs text-gray-400">No Global Default saved yet — the engine falls back to today&apos;s exact 05:00 cutover behavior.</p>}
        </div>

        <PeriodSettings outlets={outlets} companies={companies} />

        {audit.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">🕘 Audit Trail</h2>
            <div className="divide-y divide-gray-50 text-sm">
              {audit.map((a) => (
                <div key={a.id} className="py-2 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-gray-800">{a.scope}{a.scopeId ? `:${a.scopeId.slice(0, 8)}` : ''}</span>
                  <span className="text-gray-500">{a.field}: <span className="text-gray-400">{a.previousValue}</span> → <span className="text-gray-800">{a.newValue}</span></span>
                  {a.reason && <span className="text-gray-400">({a.reason})</span>}
                  <span className="text-gray-400 text-xs ml-auto">{a.userName || 'system'} · {new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={`rounded-xl p-3 ${color || 'bg-gray-50'}`}>
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="text-sm font-bold text-gray-900">{value}</div>
    </div>
  )
}

function ScopeList({ title, rows, nameFor, onRemove }: { title: string; rows: ConfigRow[]; nameFor: (id: string) => string; onRemove: (id: string) => void }) {
  if (!rows.length) return null
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-gray-500 mb-1">{title}</p>
      <div className="divide-y divide-gray-50">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="text-sm font-medium text-gray-800">{nameFor(r.scopeId!)}</span>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-semibold rounded-full">{r.businessDayStartTime}–{r.businessDayEndTime}</span>
              <button onClick={() => onRemove(r.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
