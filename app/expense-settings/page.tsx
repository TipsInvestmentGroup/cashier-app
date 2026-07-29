'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
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
  openingBalance: number; currentBalance: number; liveBalance?: number; dailyLimit: number; isActive: boolean
  _count?: { payments: number }
}
interface UserOption { id: string; name: string; role: string }
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

type Tab = 'module' | 'requestTypes' | 'categories' | 'fundingSources'

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
          {([['module', 'Module'], ['requestTypes', 'Request Types'], ['categories', 'Categories'], ['fundingSources', 'Funding Sources']] as [Tab, string][]).map(([k, label]) => (
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
const blankSource = { name: '', code: '', sourceType: 'CASH' as string, companyPaymentAccountId: '', openingBalance: 0, dailyLimit: 0 }

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
      {creating && <SourceEditor initial={blankSource} accounts={accounts} users={users} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Funding source</th><th className="pr-3">Type</th><th className="pr-3">Balance</th><th className="pr-3">Daily limit</th><th className="pr-3">Payments</th><th className="pr-3">Status</th><th></th>
            </tr></thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><span className="font-medium text-gray-800">{s.name}</span><span className="block text-[11px] text-gray-400">{s.code}{s.companyPaymentAccount ? ` · ${s.companyPaymentAccount.accountName}` : ''}</span></td>
                  <td className="pr-3 text-gray-600">{s.sourceType}</td>
                  <td className="pr-3 text-gray-600">
                    {s.sourceType === 'CASH' || s.sourceType === 'OTHER'
                      ? formatCurrency(s.currentBalance)
                      : s.sourceType === 'CASHIER_DRAWER'
                        ? <>{formatCurrency(s.liveBalance ?? 0)}<span className="block text-[10px] text-gray-400">from today&apos;s cash position</span></>
                        : <span className="text-gray-400">from GL</span>}
                  </td>
                  <td className="pr-3 text-gray-600">{s.dailyLimit > 0 ? formatCurrency(s.dailyLimit) : '—'}</td>
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
        return <SourceEditor initial={{ id: s.id, name: s.name, code: s.code, sourceType: s.sourceType, companyPaymentAccountId: s.companyPaymentAccountId || '', openingBalance: s.openingBalance, dailyLimit: s.dailyLimit }}
          accounts={accounts} users={users} isEditMode onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      })()}
    </div>
  )
}

function CustodianPicker({ fundingSourceId, users }: { fundingSourceId: string; users: UserOption[] }) {
  const { request } = useApi()
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const rows: { userId: string }[] = await request(`/api/expense/funding-sources/${fundingSourceId}/custodians`)
      setAssignedIds(rows.map((r) => r.userId))
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load custodians') }
    finally { setLoading(false) }
  }, [request, fundingSourceId])
  useEffect(() => { load() }, [load])

  const toggle = async (userId: string) => {
    try {
      if (assignedIds.includes(userId)) await request(`/api/expense/funding-sources/${fundingSourceId}/custodians?userId=${userId}`, { method: 'DELETE' })
      else await request(`/api/expense/funding-sources/${fundingSourceId}/custodians`, { method: 'POST', body: JSON.stringify({ userId }) })
      load()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not update custodian') }
  }

  const eligible = users.filter((u) => ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'].includes(u.role))

  return (
    <div className="mb-3">
      <span className="text-xs text-gray-500 block mb-1">Custodians <span className="text-gray-400">(who can receive/disburse this fund)</span></span>
      {loading ? <p className="text-xs text-gray-400">Loading…</p> : (
        <div className="flex flex-wrap gap-2 mt-2">
          {eligible.map((u) => (
            <button key={u.id} type="button" onClick={() => toggle(u.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${assignedIds.includes(u.id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>
              {u.name}
            </button>
          ))}
          {!eligible.length && <p className="text-xs text-gray-400">No eligible users found</p>}
        </div>
      )}
    </div>
  )
}

function SourceEditor({ initial, accounts, users, isEditMode, onCancel, onSaved }: {
  initial: { id?: string; name: string; code: string; sourceType: string; companyPaymentAccountId: string; openingBalance: number; dailyLimit: number }
  accounts: CompanyPaymentAccount[]; users: UserOption[]; isEditMode?: boolean; onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = !!initial.id
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  const isAccountBacked = f.sourceType === 'BANK' || f.sourceType === 'MOBILE_MONEY' || f.sourceType === 'CARD'
  const isLiveBalance = isAccountBacked || f.sourceType === 'CASHIER_DRAWER'

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit) await request(`/api/expense/funding-sources/${initial.id}`, { method: 'PATCH', body: JSON.stringify({ name: f.name, dailyLimit: f.dailyLimit }) })
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
        {!isEdit && !isLiveBalance && (
          <label className="block"><span className="text-xs text-gray-500">Opening balance</span><input type="number" className={inputCls} value={f.openingBalance} onChange={(e) => set({ openingBalance: Number(e.target.value) })} /></label>
        )}
        <label className="block"><span className="text-xs text-gray-500">Daily limit (0 = none)</span><input type="number" className={inputCls} value={f.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} /></label>
      </div>
      {isAccountBacked && <p className="text-[11px] text-gray-400 mb-3">Bank/mobile-money/card sources have no stored balance — every read computes it live from the linked payment account&apos;s GL balance, so it never drifts from the ledger.</p>}
      {f.sourceType === 'CASHIER_DRAWER' && <p className="text-[11px] text-gray-400 mb-3">No opening balance needed — this fund&apos;s balance always follows the assigned cashier&apos;s current daily cash position.</p>}
      {isEdit && <CustodianPicker fundingSourceId={initial.id!} users={users} />}
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !f.name || (!isEdit && isAccountBacked && !f.companyPaymentAccountId)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}
