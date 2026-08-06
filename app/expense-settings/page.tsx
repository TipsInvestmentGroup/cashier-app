'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
// Client-safe: lib/expense-funds.ts has no runtime imports (its only import is
// type-only, so it is erased), and the grant vocabulary lives in
// lib/shared-constants.ts precisely so this page can read it without pulling
// prisma into the bundle — lib/expense-grants.ts re-exports it server-side.
import { FUND_CLASSES, FUND_CLASS_LABELS, fundClassOf, allowsManualAllocation, type FundClass } from '@/lib/expense-funds'
import { EXPENSE_GRANT_FLAGS } from '@/lib/shared-constants'
import toast from 'react-hot-toast'

type OverBudget = 'BLOCK' | 'WARN' | 'APPROVE'
type BudgetValidation = 'NONE' | 'WARN' | 'BLOCK'
const SOURCE_TYPES = ['CASH', 'BANK', 'MOBILE_MONEY', 'CARD', 'CASHIER_DRAWER', 'OTHER'] as const
const APPROVER_ROLE_OPTIONS = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const VERIFICATION_STAGE_OPTIONS = ['RECEIPT_UPLOADED', 'RECEIPT_VERIFIED', 'GOODS_CONFIRMED', 'VALIDATED']
const ATTACHMENT_DOC_TYPE_OPTIONS = ['RECEIPT', 'INVOICE', 'PROOF_OF_PAYMENT', 'SCREENSHOT', 'OTHER']

interface ModuleConfig {
  moduleName: string; enabled: boolean; defaultCurrency: string
  requireReceiptDefault: boolean; allowMixedPayment: boolean; allowOverBudget: OverBudget
  terminology: { module: string; requestType: string; category: string; fundingSource: string; request: string }
}
interface RequestType {
  id: string; code: string; name: string; description: string | null; isActive: boolean
  allowedCategoryIds: string | null; allowedFundingSourceIds: string | null
  budgetValidation: BudgetValidation; approverRoles: string | null; requiredAttachments: string | null
  requiredVerificationStages: string | null
  _count?: { requests: number }
}
interface Category {
  id: string; code: string; name: string; legacyFunctionName: string | null
  budgetAccountId: string | null; budgetAccount?: { id: string; code: string; name: string } | null
  spendingLimit: number; costCenter: string | null; isActive: boolean
  _count?: { requests: number }
}
interface FundingSource {
  id: string; code: string; name: string; sourceType: string
  companyPaymentAccountId: string | null; companyPaymentAccount?: { id: string; accountName: string; bankName: string | null } | null
  outletId: string | null
  openingBalance: number; currentBalance: number; dailyLimit: number; isActive: boolean
  // Computed per fund type by the API (§5) — never a stored field.
  availableBalance: number
  fundClass: FundClass | null; allocationMode: string | null; supportsManualAllocation: boolean
  approvalThreshold: number; escalationHours: number; lowBalanceThreshold: number
  _count?: { payments: number }
}
interface UserOption { id: string; name: string; role: string }
interface OutletOption { id: string; name: string }
interface Account { id: string; code: string; name: string; type: string }
interface CompanyPaymentAccount { id: string; accountName: string; bankName: string | null; paymentChannel: { label: string } }

function parseArr(raw: string | null): string[] { if (!raw) return []; try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] } }

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2 cursor-pointer">
      <span><span className="text-sm font-medium text-gray-800">{label}</span>{hint && <span className="block text-xs text-gray-400">{hint}</span>}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`shrink-0 w-11 h-6 rounded-full transition relative ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}
function ChipToggle({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o])}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${value.includes(o) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
          {o.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  )
}
const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

type Tab = 'module' | 'requestTypes' | 'categories' | 'fundingSources' | 'manageAccess'

export default function ExpenseSettingsPage() {
  const [tab, setTab] = useState<Tab>('module')
  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expense Settings</h1>
          <p className="text-gray-500 text-sm">Configure the expense/disbursement module — request types, categories, and funding sources are admin-defined rows, not code. Runs side-by-side with the existing Petty Cash flow until you opt a request type into it.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {([['module', 'Module'], ['requestTypes', 'Request Types'], ['categories', 'Categories'], ['fundingSources', 'Funding Sources'], ['manageAccess', 'Manage Access']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === k ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'module' && <ModuleTab />}
        {tab === 'requestTypes' && <RequestTypesTab />}
        {tab === 'categories' && <CategoriesTab />}
        {tab === 'fundingSources' && <FundingSourcesTab />}
        {tab === 'manageAccess' && <ManageAccessTab />}
      </div>
    </AppShell>
  )
}

// ─── Module tab ──────────────────────────────────────────────────────────────
function ModuleTab() {
  const { request } = useApi()
  const [cfg, setCfg] = useState<ModuleConfig | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setCfg(await request('/api/expense/config')) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
  }, [request])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try { setCfg(await request('/api/expense/config', { method: 'PUT', body: JSON.stringify(cfg) })); toast.success('Saved') }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  if (!cfg) return <div className="py-10 text-center text-gray-400">Loading…</div>
  const set = (patch: Partial<ModuleConfig>) => setCfg({ ...cfg, ...patch })
  const setTerm = (k: keyof ModuleConfig['terminology'], v: string) => setCfg({ ...cfg, terminology: { ...cfg.terminology, [k]: v } })

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-semibold text-gray-800 mb-3">Identity</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-gray-500">Module name</span>
            <input className={inputCls} value={cfg.moduleName} onChange={(e) => set({ moduleName: e.target.value })} /></label>
          <label className="block"><span className="text-xs text-gray-500">Default currency</span>
            <input className={inputCls} value={cfg.defaultCurrency} onChange={(e) => set({ defaultCurrency: e.target.value })} /></label>
        </div>
        <Toggle label="Module enabled" checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />
      </Card>

      <Card>
        <h2 className="font-semibold text-gray-800 mb-1">Policy</h2>
        <label className="block mb-3"><span className="text-xs text-gray-500">When a request would exceed its category budget</span>
          <select className={inputCls} value={cfg.allowOverBudget} onChange={(e) => set({ allowOverBudget: e.target.value as OverBudget })}>
            <option value="WARN">Warn — allow but flag it</option>
            <option value="BLOCK">Block — refuse the request</option>
            <option value="APPROVE">Require approval</option>
          </select></label>
        <Toggle label="Require a receipt by default" checked={cfg.requireReceiptDefault} onChange={(v) => set({ requireReceiptDefault: v })} />
        <Toggle label="Allow mixed/split payment" hint="One request may be paid from more than one funding source." checked={cfg.allowMixedPayment} onChange={(v) => set({ allowMixedPayment: v })} />
      </Card>

      <Card>
        <h2 className="font-semibold text-gray-800 mb-1">Terminology</h2>
        <p className="text-xs text-gray-400 mb-3">Rename the concepts to match how this business speaks (labels only — no data changes).</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {(['module', 'requestType', 'category', 'fundingSource', 'request'] as const).map((k) => (
            <label key={k} className="block"><span className="text-xs text-gray-500 capitalize">{k}</span>
              <input className={inputCls} value={cfg.terminology[k]} onChange={(e) => setTerm(k, e.target.value)} /></label>
          ))}
        </div>
      </Card>

      <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </div>
  )
}

// ─── Request Types tab ──────────────────────────────────────────────────────
const blankType = { name: '', code: '', budgetValidation: 'WARN' as BudgetValidation, approverRoles: [] as string[], requiredVerificationStages: [] as string[], requiredAttachments: [] as string[], allowedCategoryIds: [] as string[], allowedFundingSourceIds: [] as string[] }

function RequestTypesTab() {
  const { request } = useApi()
  const [types, setTypes] = useState<RequestType[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [sources, setSources] = useState<FundingSource[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, c, s] = await Promise.all([request('/api/expense/request-types'), request('/api/expense/categories'), request('/api/expense/funding-sources')])
      setTypes(t); setCategories(c); setSources(s)
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const deactivate = async (t: RequestType) => {
    if (!confirm(`Deactivate "${t.name}"? Existing requests keep their classification; no new requests can use it.`)) return
    try { await request(`/api/expense/request-types/${t.id}`, { method: 'DELETE' }); toast.success('Deactivated'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not deactivate') }
  }

  if (loading) return <div className="py-10 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New request type</button>
      </div>
      {creating && <TypeEditor initial={blankType} categories={categories} sources={sources} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Request type</th><th className="pr-3">Approvers</th><th className="pr-3">Budget check</th><th className="pr-3">Requests</th><th className="pr-3">Status</th><th></th>
            </tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><span className="font-medium text-gray-800">{t.name}</span><span className="block text-[11px] text-gray-400">{t.code}</span></td>
                  <td className="pr-3 text-gray-600">{parseArr(t.approverRoles).join(', ') || 'none (auto-approve)'}</td>
                  <td className="pr-3 text-gray-600">{t.budgetValidation}</td>
                  <td className="pr-3 text-gray-600">{t._count?.requests ?? 0}</td>
                  <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${t.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{t.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setEditing(editing === t.id ? null : t.id)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">{editing === t.id ? 'Close' : 'Edit'}</button>
                    {t.isActive && <button onClick={() => deactivate(t)} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>}
                  </td>
                </tr>
              ))}
              {!types.length && <tr><td colSpan={6} className="py-6 text-center text-gray-400">No request types yet</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (() => {
        const t = types.find((x) => x.id === editing)!
        return <TypeEditor initial={{
          id: t.id, name: t.name, code: t.code, budgetValidation: t.budgetValidation,
          approverRoles: parseArr(t.approverRoles), requiredVerificationStages: parseArr(t.requiredVerificationStages),
          requiredAttachments: parseArr(t.requiredAttachments), allowedCategoryIds: parseArr(t.allowedCategoryIds), allowedFundingSourceIds: parseArr(t.allowedFundingSourceIds),
        }} categories={categories} sources={sources} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      })()}
    </div>
  )
}

function TypeEditor({ initial, categories, sources, onCancel, onSaved }: {
  initial: { id?: string; name: string; code: string; budgetValidation: BudgetValidation; approverRoles: string[]; requiredVerificationStages: string[]; requiredAttachments: string[]; allowedCategoryIds: string[]; allowedFundingSourceIds: string[] }
  categories: Category[]; sources: FundingSource[]; onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = !!initial.id
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit) await request(`/api/expense/request-types/${initial.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await request('/api/expense/request-types', { method: 'POST', body: JSON.stringify(f) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${initial.name}` : 'New request type'}</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Name</span><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Code {isEdit && '(fixed)'}</span><input className={inputCls} value={f.code} disabled={isEdit} onChange={(e) => set({ code: e.target.value })} placeholder="auto from name" /></label>
      </div>
      <label className="block mb-3 max-w-xs"><span className="text-xs text-gray-500">Budget validation</span>
        <select className={inputCls} value={f.budgetValidation} onChange={(e) => set({ budgetValidation: e.target.value as BudgetValidation })}>
          <option value="NONE">None — don&apos;t check</option><option value="WARN">Warn if over budget</option><option value="BLOCK">Block if over budget</option>
        </select></label>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Approver roles <span className="text-gray-400">(ordered — first must approve before the next; empty = auto-approve)</span></span>
        <ChipToggle options={APPROVER_ROLE_OPTIONS} value={f.approverRoles} onChange={(v) => set({ approverRoles: v })} />
      </div>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Required verification stages <span className="text-gray-400">(before VALIDATED can be recorded)</span></span>
        <ChipToggle options={VERIFICATION_STAGE_OPTIONS} value={f.requiredVerificationStages} onChange={(v) => set({ requiredVerificationStages: v })} />
      </div>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Required attachment types</span>
        <ChipToggle options={ATTACHMENT_DOC_TYPE_OPTIONS} value={f.requiredAttachments} onChange={(v) => set({ requiredAttachments: v })} />
      </div>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Allowed categories <span className="text-gray-400">(empty = all)</span></span>
        <ChipToggle options={categories.map((c) => c.id)} value={f.allowedCategoryIds} onChange={(v) => set({ allowedCategoryIds: v })} />
        {categories.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-1">{categories.map((c) => c.name).join(' · ')}</p>
        )}
      </div>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Allowed funding sources <span className="text-gray-400">(empty = all)</span></span>
        <ChipToggle options={sources.map((s) => s.id)} value={f.allowedFundingSourceIds} onChange={(v) => set({ allowedFundingSourceIds: v })} />
        {sources.length > 0 && (
          <p className="text-[11px] text-gray-400 mt-1">{sources.map((s) => s.name).join(' · ')}</p>
        )}
      </div>
      {isEdit && <CustomFieldsEditor requestTypeId={initial.id!} />}
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !f.name} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}

interface CustomField { id: string; fieldKey: string; label: string; fieldType: string; required: boolean; isSystem: boolean; sortOrder: number }
const FIELD_TYPE_OPTIONS = ['TEXT', 'NUMBER', 'DATE', 'PHONE', 'TEXTAREA', 'SELECT']

/** Admin-managed custom fields for one RequestType — the Digital Expense
 *  Form's "do not hard-code the form fields" requirement. System (seeded)
 *  fields may be relabeled/reordered/required-toggled but not deleted;
 *  admins can add unlimited further fields here with zero code changes. */
function CustomFieldsEditor({ requestTypeId }: { requestTypeId: string }) {
  const { request } = useApi()
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('TEXT')
  const [newRequired, setNewRequired] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setFields(await request(`/api/expense/request-types/${requestTypeId}/fields`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load fields') }
    finally { setLoading(false) }
  }, [request, requestTypeId])
  useEffect(() => { load() }, [load])

  const addField = async () => {
    if (!newLabel.trim()) return toast.error('Label is required')
    setAdding(true)
    try {
      const fieldKey = newLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      await request(`/api/expense/request-types/${requestTypeId}/fields`, {
        method: 'POST', body: JSON.stringify({ fieldKey, label: newLabel.trim(), fieldType: newType, required: newRequired, sortOrder: fields.length }),
      })
      toast.success('Field added'); setNewLabel(''); setNewType('TEXT'); setNewRequired(false); load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not add field') }
    finally { setAdding(false) }
  }

  const toggleRequired = async (f: CustomField) => {
    try { await request(`/api/expense/request-types/${requestTypeId}/fields/${f.id}`, { method: 'PATCH', body: JSON.stringify({ required: !f.required }) }); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not update field') }
  }

  const removeField = async (f: CustomField) => {
    if (!confirm(`Remove "${f.label}"?`)) return
    try { await request(`/api/expense/request-types/${requestTypeId}/fields/${f.id}`, { method: 'DELETE' }); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not remove field') }
  }

  return (
    <div className="mb-3 border-2 border-gray-100 rounded-xl p-3">
      <span className="text-xs text-gray-500 block mb-2">Custom fields <span className="text-gray-400">(shown on the request form for this type — add as many as you need)</span></span>
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : (
        <div className="space-y-2 mb-3">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 font-medium text-gray-700">{f.label}{f.isSystem && <span className="ml-1 text-[10px] text-gray-400">(system)</span>}</span>
              <span className="text-xs text-gray-400 w-20">{f.fieldType}</span>
              <label className="flex items-center gap-1 text-xs text-gray-500">
                <input type="checkbox" checked={f.required} onChange={() => toggleRequired(f)} /> required
              </label>
              {!f.isSystem && <button onClick={() => removeField(f)} className="text-red-500 hover:text-red-700 text-xs">✕</button>}
            </div>
          ))}
          {!fields.length && <p className="text-xs text-gray-400">No custom fields yet</p>}
        </div>
      )}
      <div className="grid grid-cols-12 gap-2 items-center">
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Field label" className="col-span-5 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
        <select value={newType} onChange={(e) => setNewType(e.target.value)} className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm">
          {FIELD_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="col-span-2 flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} /> required
        </label>
        <button type="button" onClick={addField} disabled={adding} className="col-span-2 px-2 py-2 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100 disabled:opacity-40">+ Add</button>
      </div>
    </div>
  )
}

// ─── Categories tab ──────────────────────────────────────────────────────────
const blankCategory = { name: '', code: '', budgetAccountId: '', spendingLimit: 0, costCenter: '' }

function CategoriesTab() {
  const { request } = useApi()
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, a] = await Promise.all([request('/api/expense/categories'), request('/api/finance/accounts').catch(() => [])])
      setCategories(c); setAccounts((a || []).filter((x: Account) => x.type === 'EXPENSE'))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const deactivate = async (c: Category) => {
    if (!confirm(`Deactivate "${c.name}"? Existing requests keep their classification.`)) return
    try { await request(`/api/expense/categories/${c.id}`, { method: 'DELETE' }); toast.success('Deactivated'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not deactivate') }
  }

  if (loading) return <div className="py-10 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New category</button>
      </div>
      {creating && <CategoryEditor initial={blankCategory} accounts={accounts} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Category</th><th className="pr-3">GL account</th><th className="pr-3">Spending limit</th><th className="pr-3">Requests</th><th className="pr-3">Status</th><th></th>
            </tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><span className="font-medium text-gray-800">{c.name}</span><span className="block text-[11px] text-gray-400">{c.code}{c.legacyFunctionName ? ` · from ${c.legacyFunctionName}` : ''}</span></td>
                  <td className="pr-3 text-gray-600">{c.budgetAccount ? `${c.budgetAccount.code} ${c.budgetAccount.name}` : <span className="text-gray-400">falls back to Petty Cash Expense</span>}</td>
                  <td className="pr-3 text-gray-600">{c.spendingLimit > 0 ? formatCurrency(c.spendingLimit) : '—'}</td>
                  <td className="pr-3 text-gray-600">{c._count?.requests ?? 0}</td>
                  <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${c.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setEditing(editing === c.id ? null : c.id)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">{editing === c.id ? 'Close' : 'Edit'}</button>
                    {c.isActive && <button onClick={() => deactivate(c)} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>}
                  </td>
                </tr>
              ))}
              {!categories.length && <tr><td colSpan={6} className="py-6 text-center text-gray-400">No categories yet</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (() => {
        const c = categories.find((x) => x.id === editing)!
        return <CategoryEditor initial={{ id: c.id, name: c.name, code: c.code, budgetAccountId: c.budgetAccountId || '', spendingLimit: c.spendingLimit, costCenter: c.costCenter || '' }}
          accounts={accounts} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      })()}
    </div>
  )
}

function CategoryEditor({ initial, accounts, onCancel, onSaved }: {
  initial: { id?: string; name: string; code: string; budgetAccountId: string; spendingLimit: number; costCenter: string }
  accounts: Account[]; onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = !!initial.id
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  const save = async () => {
    setSaving(true)
    try {
      const body = { ...f, budgetAccountId: f.budgetAccountId || null }
      if (isEdit) await request(`/api/expense/categories/${initial.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      else await request('/api/expense/categories', { method: 'POST', body: JSON.stringify(body) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${initial.name}` : 'New category'}</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Name</span><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Code {isEdit && '(fixed)'}</span><input className={inputCls} value={f.code} disabled={isEdit} onChange={(e) => set({ code: e.target.value })} placeholder="auto from name" /></label>
        <label className="block"><span className="text-xs text-gray-500">GL account <span className="text-gray-400">(blank = Petty Cash Expense fallback)</span></span>
          <select className={inputCls} value={f.budgetAccountId} onChange={(e) => set({ budgetAccountId: e.target.value })}>
            <option value="">— fallback —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Spending limit (0 = none)</span><input type="number" className={inputCls} value={f.spendingLimit} onChange={(e) => set({ spendingLimit: Number(e.target.value) })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Cost center <span className="text-gray-400">(free text)</span></span><input className={inputCls} value={f.costCenter} onChange={(e) => set({ costCenter: e.target.value })} /></label>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !f.name} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}

// ─── Funding Sources tab ─────────────────────────────────────────────────────
const blankSource = { name: '', code: '', sourceType: 'CASH' as string, companyPaymentAccountId: '', openingBalance: 0, dailyLimit: 0, approvalThreshold: 0, escalationHours: 0, lowBalanceThreshold: 0 }

function FundingSourcesTab() {
  const { request } = useApi()
  const [sources, setSources] = useState<FundingSource[]>([])
  const [accounts, setAccounts] = useState<CompanyPaymentAccount[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, a, u] = await Promise.all([request('/api/expense/funding-sources'), request('/api/finance/company-accounts').catch(() => []), request('/api/users').catch(() => [])])
      setSources(s); setAccounts(a || []); setUsers(u || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const deactivate = async (s: FundingSource) => {
    if (!confirm(`Deactivate "${s.name}"? Existing payments keep their history.`)) return
    try { await request(`/api/expense/funding-sources/${s.id}`, { method: 'DELETE' }); toast.success('Deactivated'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not deactivate') }
  }

  if (loading) return <div className="py-10 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New funding source</button>
      </div>
      {creating && <SourceEditor initial={blankSource} accounts={accounts} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Funding source</th><th className="pr-3">Fund</th><th className="pr-3">Available balance</th><th className="pr-3">Approval</th><th className="pr-3">Payments</th><th className="pr-3">Status</th><th></th>
            </tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><span className="font-medium text-gray-800">{s.name}</span><span className="block text-[11px] text-gray-400">{s.code}{s.companyPaymentAccount ? ` · ${s.companyPaymentAccount.accountName}` : ''}</span></td>
                  <td className="pr-3 text-gray-600">
                    {s.fundClass ? FUND_CLASS_LABELS[s.fundClass] : <span className="text-gray-400">—</span>}
                    <span className="block text-[10px] text-gray-400">{s.sourceType}</span>
                  </td>
                  {/* §5: one computed figure per fund, with where it comes from —
                      the source matters as much as the number when a custodian
                      is deciding whether they can pay something. */}
                  <td className="pr-3 text-gray-600">
                    {formatCurrency(s.availableBalance)}
                    <span className="block text-[10px] text-gray-400">
                      {s.allocationMode === 'ROLLING_CASH_BALANCE' ? "today's cash position"
                        : s.allocationMode === 'BANK_BALANCE' ? 'linked account (GL)'
                        : s.allocationMode === 'FIXED_ALLOCATION' ? 'allocated float'
                        : 'stored balance'}
                    </span>
                  </td>
                  <td className="pr-3 text-gray-600">
                    {s.approvalThreshold > 0
                      ? <>≤ {formatCurrency(s.approvalThreshold)}<span className="block text-[10px] text-gray-400">skips approval</span></>
                      : <span className="text-gray-400">always required</span>}
                  </td>
                  <td className="pr-3 text-gray-600">{s._count?.payments ?? 0}</td>
                  <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${s.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.isActive ? 'ACTIVE' : 'INACTIVE'}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setEditing(editing === s.id ? null : s.id)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">{editing === s.id ? 'Close' : 'Edit'}</button>
                    {s.isActive && <button onClick={() => deactivate(s)} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>}
                  </td>
                </tr>
              ))}
              {!sources.length && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No funding sources yet</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (() => {
        const s = sources.find((x) => x.id === editing)!
        return <SourceEditor initial={{
          id: s.id, name: s.name, code: s.code, sourceType: s.sourceType, companyPaymentAccountId: s.companyPaymentAccountId || '',
          openingBalance: s.openingBalance, dailyLimit: s.dailyLimit, outletId: s.outletId ?? null,
          approvalThreshold: s.approvalThreshold, escalationHours: s.escalationHours, lowBalanceThreshold: s.lowBalanceThreshold,
        }}
          accounts={accounts} isEditMode onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      })()}
    </div>
  )
}

// Eligibility comes from the §4 access list, NOT from User.role: offering
// everyone with a management role would let an admin assign a fund to someone
// the access list never authorized, and the server now rejects that anyway
// (lib/expense-access.ts assignFundingSourceCustodian). Assignment is still a
// separate act — holding "Petty Cash Custodian" makes you eligible for every
// petty cash fund, not automatically assigned to any of them.
function CustodianPicker({ fundingSourceId, fundClass, outletId }: {
  fundingSourceId: string; fundClass: FundClass | null; outletId: string | null
}) {
  const { request } = useApi()
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [eligible, setEligible] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ grantType: 'CUSTODIAN' })
      if (fundClass) params.set('fundClass', fundClass)
      if (outletId) params.set('outletId', outletId)
      const [rows, elig] = await Promise.all([
        request(`/api/expense/funding-sources/${fundingSourceId}/custodians`),
        request(`/api/expense/access-grants/eligible?${params.toString()}`).catch(() => []),
      ])
      setAssignedIds((rows as { userId: string }[]).map((r) => r.userId))
      setEligible(elig || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load custodians') }
    finally { setLoading(false) }
  }, [request, fundingSourceId, fundClass, outletId])
  useEffect(() => { load() }, [load])

  const toggle = async (userId: string) => {
    try {
      if (assignedIds.includes(userId)) await request(`/api/expense/funding-sources/${fundingSourceId}/custodians?userId=${userId}`, { method: 'DELETE' })
      else await request(`/api/expense/funding-sources/${fundingSourceId}/custodians`, { method: 'POST', body: JSON.stringify({ userId }) })
      load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not update custodian') }
  }

  return (
    <div className="mb-3">
      <span className="text-xs text-gray-500 block mb-1">Custodians <span className="text-gray-400">(who holds and disburses this fund)</span></span>
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : (
        <div className="flex flex-wrap gap-2 mt-2">
          {eligible.map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${assignedIds.includes(u.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
              {u.name}
            </button>
          ))}
          {!eligible.length && (
            <p className="text-xs text-gray-400">
              {fundClass
                ? `Nobody has ${FUND_CLASS_LABELS[fundClass]} Custodian access${outletId ? ' for this outlet' : ''} yet — grant it under Manage Access first.`
                : 'This fund type has no custodian class, so no eligibility applies.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SourceEditor({ initial, accounts, isEditMode, onCancel, onSaved }: {
  initial: {
    id?: string; name: string; code: string; sourceType: string; companyPaymentAccountId: string
    openingBalance: number; dailyLimit: number; outletId?: string | null
    approvalThreshold: number; escalationHours: number; lowBalanceThreshold: number
  }
  accounts: CompanyPaymentAccount[]; isEditMode?: boolean; onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = !!initial.id
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  const isAccountBacked = f.sourceType === 'BANK' || f.sourceType === 'MOBILE_MONEY' || f.sourceType === 'CARD'
  // §5: only a FIXED_ALLOCATION fund has an allocation to enter. A Cashier Cash
  // fund follows the till and a Digital fund follows the bank, so an opening
  // balance on either would write a figure nothing reads. Derived from the same
  // mapping the server uses rather than re-listing source types here.
  const fundClass = fundClassOf(f.sourceType)
  const allowsAllocation = allowsManualAllocation(f.sourceType)

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit) await request(`/api/expense/funding-sources/${initial.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: f.name, dailyLimit: f.dailyLimit,
          approvalThreshold: f.approvalThreshold, escalationHours: f.escalationHours, lowBalanceThreshold: f.lowBalanceThreshold,
        }),
      })
      else await request('/api/expense/funding-sources', { method: 'POST', body: JSON.stringify({ ...f, companyPaymentAccountId: isAccountBacked ? f.companyPaymentAccountId : undefined }) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${initial.name}` : 'New funding source'}</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Name</span><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Code {isEdit && '(fixed)'}</span><input className={inputCls} value={f.code} disabled={isEdit} onChange={(e) => set({ code: e.target.value })} placeholder="auto from name" /></label>
        <label className="block"><span className="text-xs text-gray-500">Type {isEdit && '(fixed — deactivate and recreate to change)'}</span>
          <select className={inputCls} value={f.sourceType} disabled={isEditMode} onChange={(e) => set({ sourceType: e.target.value })}>
            {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></label>
        {!isEdit && isAccountBacked && (
          <label className="block"><span className="text-xs text-gray-500">Company payment account</span>
            <select className={inputCls} value={f.companyPaymentAccountId} onChange={(e) => set({ companyPaymentAccountId: e.target.value })}>
              <option value="">— select —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.paymentChannel.label} · {a.accountName}{a.bankName ? ` (${a.bankName})` : ''}</option>)}
            </select></label>
        )}
        {!isEdit && allowsAllocation && (
          <label className="block"><span className="text-xs text-gray-500">Opening balance</span><input type="number" className={inputCls} value={f.openingBalance} onChange={(e) => set({ openingBalance: Number(e.target.value) })} /></label>
        )}
        <label className="block"><span className="text-xs text-gray-500">Daily limit (0 = none)</span><input type="number" className={inputCls} value={f.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} /></label>
      </div>

      {isEdit && (
        <>
          <p className="text-xs font-semibold text-gray-700 mb-2">Approval &amp; alert policy for this fund</p>
          <div className="grid sm:grid-cols-3 gap-3 mb-3">
            <label className="block"><span className="text-xs text-gray-500">Skip approval at or below</span>
              <input type="number" className={inputCls} value={f.approvalThreshold} onChange={(e) => set({ approvalThreshold: Number(e.target.value) })} />
              <span className="block text-[11px] text-gray-400 mt-1">0 = every request needs both approvers.</span>
            </label>
            <label className="block"><span className="text-xs text-gray-500">Escalate after (hours)</span>
              <input type="number" className={inputCls} value={f.escalationHours} onChange={(e) => set({ escalationHours: Number(e.target.value) })} />
              <span className="block text-[11px] text-gray-400 mt-1">0 = no reminders. Cashier Cash usually needs a much shorter window than a petty cash top-up.</span>
            </label>
            <label className="block"><span className="text-xs text-gray-500">Low balance alert at</span>
              <input type="number" className={inputCls} value={f.lowBalanceThreshold} onChange={(e) => set({ lowBalanceThreshold: Number(e.target.value) })} />
              <span className="block text-[11px] text-gray-400 mt-1">0 = no alert. Warns the custodian before the fund runs dry.</span>
            </label>
          </div>
        </>
      )}

      {isAccountBacked && <p className="text-[11px] text-gray-400 mb-3">Bank/mobile-money/card sources have no stored balance — every read computes it live from the linked payment account&apos;s GL balance, so it never drifts from the ledger.</p>}
      {f.sourceType === 'CASHIER_DRAWER' && <p className="text-[11px] text-gray-400 mb-3">No opening balance needed — this fund&apos;s balance always follows the assigned cashier&apos;s current daily cash position.</p>}
      {isEdit && <CustodianPicker fundingSourceId={initial.id!} fundClass={fundClass} outletId={initial.outletId ?? null} />}
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !f.name || (!isEdit && isAccountBacked && !f.companyPaymentAccountId)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}

// ─── Manage Access tab ───────────────────────────────────────────────────────
// §4's access list — the single source of truth for who may request, custody a
// fund, and approve at each stage. Everything downstream (the Requested By
// dropdown, custodian assignment, approval routing, and §7's "action needed"
// notifications) reads these grants rather than User.role.
interface AccessGrant {
  id: string; userId: string; grantType: string; fundClass: string | null; outletId: string | null
  grantedById: string; grantedByName: string | null; grantedAt: string
  revokedAt: string | null; revokedById: string | null; note: string | null
  user: { id: string; name: string; email: string; role: string } | null
  outlet: { id: string; name: string } | null
}

/** The fund fields the "Assign to funds" shortcut needs — the /funding-sources
 *  GET returns more, but the shortcut only matches on class + outlet + active. */
interface FundOption { id: string; name: string; fundClass: string | null; outletId: string | null; isActive: boolean }

/** Stable key for one flag, so a (grantType, fundClass) pair round-trips through
 *  checkbox state without a nested structure. */
const flagKey = (grantType: string, fundClass: string | null) => `${grantType}:${fundClass || ''}`

function labelForGrant(grantType: string, fundClass: string | null): string {
  const flag = EXPENSE_GRANT_FLAGS.find((f) => flagKey(f.grantType, f.fundClass) === flagKey(grantType, fundClass))
  if (flag) return flag.label
  // An approver grant narrowed to one fund has no matching flag row (the flag
  // list carries fundClass=null for approvers), so compose its label instead.
  const fundLabel = fundClass ? FUND_CLASS_LABELS[fundClass as FundClass] || fundClass : ''
  const base = EXPENSE_GRANT_FLAGS.find((f) => f.grantType === grantType)?.label || grantType.replace(/_/g, ' ')
  return fundLabel ? `${base} · ${fundLabel}` : base
}

/**
 * The eligibility→assignment shortcut, shown inline under a CUSTODIAN grant row.
 * A grant only says "this person MAY hold a <class> fund" (ExpenseAccessGrant);
 * the actual "holds THIS fund" record is FundingSourceCustodian, written per
 * fund. This lists the funds the grant covers — same fund class, and either the
 * grant's outlet or (for a business-wide grant) every outlet — and toggles the
 * assignment straight against the same endpoint the Funding Sources → Edit
 * picker uses, so the two entry points can never disagree. The server still
 * enforces the eligibility grant on POST (lib/expense-access.ts), which sitting
 * on the grant row already satisfies.
 */
function AssignToFunds({ grant, sources }: { grant: AccessGrant; sources: FundOption[] }) {
  const { request } = useApi()
  const matching = useMemo(
    () => sources.filter((s) => s.isActive && s.fundClass === grant.fundClass && (!grant.outletId || s.outletId === grant.outletId)),
    [sources, grant.fundClass, grant.outletId],
  )
  const [assigned, setAssigned] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const entries = await Promise.all(
      matching.map(async (f) => {
        const rows = await request(`/api/expense/funding-sources/${f.id}/custodians`).catch(() => [])
        return [f.id, (rows as { userId: string }[]).some((r) => r.userId === grant.userId)] as const
      }),
    )
    setAssigned(new Set(entries.filter(([, has]) => has).map(([id]) => id)))
  }, [request, matching, grant.userId])
  useEffect(() => { load() }, [load])

  const toggle = async (fundId: string) => {
    setBusy(fundId)
    try {
      if (assigned?.has(fundId)) {
        await request(`/api/expense/funding-sources/${fundId}/custodians?userId=${grant.userId}`, { method: 'DELETE' })
      } else {
        await request(`/api/expense/funding-sources/${fundId}/custodians`, { method: 'POST', body: JSON.stringify({ userId: grant.userId }) })
      }
      await load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not update assignment') }
    finally { setBusy(null) }
  }

  const classLabel = grant.fundClass ? FUND_CLASS_LABELS[grant.fundClass as FundClass] || grant.fundClass : ''
  return (
    <div className="mt-2 p-2 rounded-lg bg-gray-50 border border-gray-100">
      <span className="text-[11px] text-gray-500 block mb-1.5">Assign to a {classLabel} fund <span className="text-gray-400">(who actually holds and pays it)</span></span>
      {matching.length === 0 ? (
        <p className="text-[11px] text-gray-400">No {classLabel} funds{grant.outletId ? ' at this outlet' : ''} exist yet — create one under Funding Sources first.</p>
      ) : assigned === null ? (
        <p className="text-[11px] text-gray-400">Loading funds…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {matching.map((f) => {
            const on = assigned.has(f.id)
            return (
              <button key={f.id} type="button" disabled={busy === f.id} onClick={() => toggle(f.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border-2 transition ${on ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'} ${busy === f.id ? 'opacity-50' : ''}`}>
                {on ? '✓ ' : '+ '}{f.name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ManageAccessTab() {
  const { request } = useApi()
  const [grants, setGrants] = useState<AccessGrant[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [outlets, setOutlets] = useState<OutletOption[]>([])
  // Funds are pulled here purely so the per-row "Assign to funds" shortcut can
  // list the funds a CUSTODIAN grant covers without a second screen. Only the
  // handful of fields the shortcut filters on are kept (see FundOption).
  const [sources, setSources] = useState<FundOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showRevoked, setShowRevoked] = useState(false)
  const [adding, setAdding] = useState(false)
  // Which CUSTODIAN grant row has its fund-assignment panel open (grant id).
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, u, o, s] = await Promise.all([
        request(`/api/expense/access-grants${showRevoked ? '?includeRevoked=true' : ''}`),
        request('/api/users').catch(() => []),
        request('/api/outlets').catch(() => []),
        request('/api/expense/funding-sources').catch(() => []),
      ])
      setGrants(g || []); setUsers(u || []); setOutlets(o || [])
      setSources((s || []).map((f: FundOption) => ({ id: f.id, name: f.name, fundClass: f.fundClass, outletId: f.outletId, isActive: f.isActive })))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load access grants') }
    finally { setLoading(false) }
  }, [request, showRevoked])
  useEffect(() => { load() }, [load])

  const revoke = async (g: AccessGrant) => {
    if (!confirm(`Revoke "${labelForGrant(g.grantType, g.fundClass)}" from ${g.user?.name || 'this user'}? The grant is kept for the audit trail, not deleted.`)) return
    try { await request(`/api/expense/access-grants/${g.id}`, { method: 'DELETE' }); toast.success('Revoked'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not revoke') }
  }

  // Grouped by user so the table reads as "this person holds these flags" — a
  // custodian who also approves would otherwise be scattered across the list.
  const byUser = new Map<string, AccessGrant[]>()
  for (const g of grants) {
    const list = byUser.get(g.userId) || []
    list.push(g)
    byUser.set(g.userId, list)
  }

  if (loading) return <div className="py-10 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-gray-600">
          This list decides who can submit an Expense Form, who holds each fund, and who approves at each stage.
          It is the only thing those checks read — a user&apos;s role no longer grants expense access by itself.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Each fund gets its own approval chain. Grant a <strong>Single Approver</strong> for a one-stage
          workflow — one approval finalizes the request. Otherwise use <strong>First</strong> and{' '}
          <strong>Second Approver</strong> for the two-stage chain; a Single Approver, where set, replaces
          that chain for the fund. Leave the fund as &ldquo;All funds&rdquo; to have someone approve for all
          three. Grants are revoked, never deleted, so past approvals stay explainable.
        </p>
      </Card>

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input type="checkbox" checked={showRevoked} onChange={(e) => setShowRevoked(e.target.checked)} className="w-4 h-4 accent-indigo-600" />
          Show revoked (audit trail)
        </label>
        <button onClick={() => setAdding(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ Grant access</button>
      </div>

      {adding && <GrantEditor users={users} outlets={outlets} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">User</th><th className="pr-3">Access</th><th className="pr-3">Outlet</th><th className="pr-3">Granted</th><th></th>
            </tr></thead>
            <tbody>
              {[...byUser.entries()].map(([userId, userGrants]) => (
                userGrants.map((g, i) => (
                  <tr key={g.id} className={`border-b border-gray-50 ${g.revokedAt ? 'opacity-50' : ''}`}>
                    {i === 0 && (
                      <td className="py-2 pr-3 align-top" rowSpan={userGrants.length}>
                        <span className="font-medium text-gray-800">{g.user?.name || userId}</span>
                        <span className="block text-[11px] text-gray-400">{g.user?.email}{g.user?.role ? ` · ${g.user.role}` : ''}</span>
                      </td>
                    )}
                    <td className="pr-3">
                      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${g.revokedAt ? 'bg-gray-100 text-gray-500 line-through' : 'bg-indigo-50 text-indigo-700'}`}>
                        {labelForGrant(g.grantType, g.fundClass)}
                      </span>
                      {!g.fundClass && (g.grantType === 'SINGLE_APPROVER' || g.grantType === 'FIRST_APPROVER' || g.grantType === 'SECOND_APPROVER') && (
                        <span className="block text-[10px] text-gray-400">all funds</span>
                      )}
                      {/* The eligibility→assignment shortcut: a CUSTODIAN grant
                          only makes this person *eligible* to hold a fund; the
                          panel below writes the actual FundingSourceCustodian
                          assignment (what clears the "No custodian assigned"
                          banner) without leaving for the Funding Sources tab. */}
                      {expandedId === g.id && g.grantType === 'CUSTODIAN' && !g.revokedAt && (
                        <AssignToFunds grant={g} sources={sources} />
                      )}
                    </td>
                    <td className="pr-3 text-gray-600">{g.outlet?.name || <span className="text-gray-400">All outlets</span>}</td>
                    <td className="pr-3 text-gray-500 text-[11px]">
                      {new Date(g.grantedAt).toLocaleDateString()}{g.grantedByName ? ` by ${g.grantedByName}` : ''}
                      {g.revokedAt && <span className="block text-red-500">revoked {new Date(g.revokedAt).toLocaleDateString()}</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {!g.revokedAt && g.grantType === 'CUSTODIAN' && (
                        <button onClick={() => setExpandedId(expandedId === g.id ? null : g.id)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">
                          {expandedId === g.id ? 'Close' : 'Assign to funds'}
                        </button>
                      )}
                      {!g.revokedAt && <button onClick={() => revoke(g)} className="text-xs text-red-500 hover:text-red-700">Revoke</button>}
                    </td>
                  </tr>
                ))
              ))}
              {!grants.length && (
                <tr><td colSpan={5} className="py-6 text-center text-gray-400">
                  No access granted yet — nobody can submit or approve an expense until someone is added here.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function GrantEditor({ users, outlets, onCancel, onSaved }: {
  users: UserOption[]; outlets: OutletOption[]
  onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const [userId, setUserId] = useState('')
  const [outletId, setOutletId] = useState('')
  const [checked, setChecked] = useState<string[]>([])
  // Approver flags can additionally be narrowed to a single fund; the custodian
  // flags already name their fund and Requesting Access is fund-agnostic.
  const [approverFund, setApproverFund] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const toggle = (key: string) => setChecked((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]))

  const save = async () => {
    if (!userId) { toast.error('Pick a user'); return }
    if (!checked.length) { toast.error('Tick at least one access flag'); return }
    setSaving(true)
    try {
      const flags = checked.map((key) => {
        const flag = EXPENSE_GRANT_FLAGS.find((f) => flagKey(f.grantType, f.fundClass) === key)!
        return { grantType: flag.grantType, fundClass: flag.fundClass ?? (approverFund[key] || null) }
      })
      await request('/api/expense/access-grants', {
        method: 'POST',
        body: JSON.stringify({ userId, outletId: outletId || null, flags }),
      })
      toast.success('Access granted')
      onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not grant access') }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">Grant access</h3>
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <label className="block"><span className="text-xs text-gray-500">User</span>
          <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select a user…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs text-gray-500">Outlet</span>
          <select className={inputCls} value={outletId} onChange={(e) => setOutletId(e.target.value)}>
            <option value="">All outlets (business-wide)</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <span className="block text-[11px] text-gray-400 mt-1">One person can hold the same access at both outlets — grant it business-wide, or add a separate grant per outlet.</span>
        </label>
      </div>

      <div className="space-y-2">
        {EXPENSE_GRANT_FLAGS.map((f) => {
          const key = flagKey(f.grantType, f.fundClass)
          const isApprover = f.grantType === 'SINGLE_APPROVER' || f.grantType === 'FIRST_APPROVER' || f.grantType === 'SECOND_APPROVER'
          return (
            <div key={key} className="border-2 border-gray-100 rounded-xl p-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={checked.includes(key)} onChange={() => toggle(key)} className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0" />
                <span>
                  <span className="text-sm font-medium text-gray-800">{f.label}</span>
                  <span className="block text-xs text-gray-400">{f.hint}</span>
                </span>
              </label>
              {isApprover && checked.includes(key) && (
                <label className="block mt-2 ml-7">
                  <span className="text-[11px] text-gray-500">Approves for</span>
                  <select className={inputCls} value={approverFund[key] || ''} onChange={(e) => setApproverFund((m) => ({ ...m, [key]: e.target.value }))}>
                    <option value="">All funds</option>
                    {FUND_CLASSES.map((c) => <option key={c} value={c}>{FUND_CLASS_LABELS[c]}</option>)}
                  </select>
                </label>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Granting…' : 'Grant access'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}
