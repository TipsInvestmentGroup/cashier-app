'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

type OverLimit = 'BLOCK' | 'WARN' | 'APPROVE'
const SETTLEMENT_METHODS = ['PAYROLL_DEDUCTION', 'CASH', 'BANK', 'MOBILE_MONEY'] as const
type Settlement = (typeof SETTLEMENT_METHODS)[number]

interface ModuleConfig {
  moduleName: string; enabled: boolean; defaultCurrency: string
  approvalRequiredDefault: boolean; allowPartialPayments: boolean
  allowOverLimit: OverLimit; requireAttachmentsDefault: boolean
  terminology: { module: string; account: string; invoice: string; payment: string; group: string }
}
interface Group {
  id: string; code: string; name: string; description: string | null; status: string
  legacyBillTypeCode: string | null; isCreditBearing: boolean; requiresApproval: boolean
  settlementMethods: string; defaultSettlementMethod: string; maxCredit: number
  paymentTermsDays: number; gracePeriodDays: number; riskRating: string; priority: number
  _count?: { accountLinks: number; signedBills: number }
}
interface Account {
  id: string; displayName: string; accountType: string; status: string; riskRating: string
  creditLimitOverride: number | null; personCreditLimit: number; effectiveLimit: number
  outstanding: number; groups: { id: string; name: string; code: string }[]
}

const fmt = (n: number) => n.toLocaleString('en-US')
type Tab = 'module' | 'groups' | 'accounts'

export default function CreditSettingsPage() {
  const [tab, setTab] = useState<Tab>('module')
  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-5xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Credit Settings</h1>
          <p className="text-gray-500 text-sm">Configure the credit module — what it&apos;s called, how limits and approvals behave, the credit groups (bill types), and each account&apos;s limit and status. Everything here is configuration; nothing is hardcoded.</p>
        </div>
        <div className="flex gap-2">
          {([['module', 'Module'], ['groups', 'Credit Groups'], ['accounts', 'Accounts']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${tab === k ? 'bg-indigo-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'module' && <ModuleTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'accounts' && <AccountsTab />}
      </div>
    </AppShell>
  )
}

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
const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

// ─── Module tab ──────────────────────────────────────────────────────────────
function ModuleTab() {
  const { request } = useApi()
  const [cfg, setCfg] = useState<ModuleConfig | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setCfg(await request('/api/credit/config')) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
  }, [request])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try {
      const saved = await request('/api/credit/config', { method: 'PUT', body: JSON.stringify(cfg) })
      setCfg(saved); toast.success('Saved')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
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
        <Toggle label="Module enabled" hint="Turn the whole credit module on or off." checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />
      </Card>

      <Card>
        <h2 className="font-semibold text-gray-800 mb-1">Policy</h2>
        <label className="block mb-3"><span className="text-xs text-gray-500">When a credit limit is exceeded</span>
          <select className={inputCls} value={cfg.allowOverLimit} onChange={(e) => set({ allowOverLimit: e.target.value as OverLimit })}>
            <option value="WARN">Warn — allow but flag it</option>
            <option value="BLOCK">Block — refuse the bill</option>
            <option value="APPROVE">Require approval</option>
          </select></label>
        <Toggle label="Allow partial payments" checked={cfg.allowPartialPayments} onChange={(v) => set({ allowPartialPayments: v })} />
        <Toggle label="Approval required by default" hint="New credit bills need sign-off unless a group overrides." checked={cfg.approvalRequiredDefault} onChange={(v) => set({ approvalRequiredDefault: v })} />
        <Toggle label="Require attachments by default" checked={cfg.requireAttachmentsDefault} onChange={(v) => set({ requireAttachmentsDefault: v })} />
      </Card>

      <Card>
        <h2 className="font-semibold text-gray-800 mb-1">Terminology</h2>
        <p className="text-xs text-gray-400 mb-3">Rename the concepts to match how this business speaks (labels only — no data changes).</p>
        <div className="grid sm:grid-cols-2 gap-3">
          {(['module', 'account', 'invoice', 'payment', 'group'] as const).map((k) => (
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

// ─── Groups tab ──────────────────────────────────────────────────────────────
const blankGroup = { name: '', code: '', isCreditBearing: true, requiresApproval: false, settlementMethods: ['CASH', 'BANK', 'MOBILE_MONEY'] as string[], defaultSettlementMethod: 'CASH', maxCredit: 0, paymentTermsDays: 0, riskRating: 'LOW', priority: 0 }

function GroupsTab() {
  const { request } = useApi()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setGroups(await request('/api/credit/groups')) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const deactivate = async (g: Group) => {
    if (!confirm(`Deactivate "${g.name}"? Existing bills keep their classification; no new bills use it.`)) return
    try { await request(`/api/credit/groups/${g.id}`, { method: 'DELETE' }); toast.success('Deactivated'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not deactivate') }
  }

  if (loading) return <div className="py-10 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New group</button>
      </div>
      {creating && <GroupEditor initial={blankGroup} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
              <th className="py-2 pr-3">Group</th><th className="pr-3">Legacy</th><th className="pr-3">Credit?</th><th className="pr-3">Approval?</th>
              <th className="pr-3">Default settle</th><th className="pr-3">Max credit</th><th className="pr-3">Accounts</th><th className="pr-3">Status</th><th></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id} className="border-b border-gray-50">
                  <td className="py-2 pr-3"><span className="font-medium text-gray-800">{g.name}</span><span className="block text-[11px] text-gray-400">{g.code}</span></td>
                  <td className="pr-3 text-gray-500">{g.legacyBillTypeCode || '—'}</td>
                  <td className="pr-3">{g.isCreditBearing ? '✓' : '—'}</td>
                  <td className="pr-3">{g.requiresApproval ? '✓' : '—'}</td>
                  <td className="pr-3 text-gray-600">{g.defaultSettlementMethod}</td>
                  <td className="pr-3 text-gray-600">{g.maxCredit > 0 ? fmt(g.maxCredit) : '—'}</td>
                  <td className="pr-3 text-gray-600">{g._count?.accountLinks ?? 0}</td>
                  <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${g.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{g.status}</span></td>
                  <td className="text-right whitespace-nowrap">
                    <button onClick={() => setEditing(editing === g.id ? null : g.id)} className="text-xs text-indigo-600 hover:text-indigo-800 mr-3">{editing === g.id ? 'Close' : 'Edit'}</button>
                    {g.status === 'ACTIVE' && <button onClick={() => deactivate(g)} className="text-xs text-red-500 hover:text-red-700">Deactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (() => {
        const g = groups.find((x) => x.id === editing)!
        let methods: string[] = []; try { methods = JSON.parse(g.settlementMethods) } catch {}
        return <GroupEditor initial={{ ...g, settlementMethods: methods }} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      })()}
    </div>
  )
}

function GroupEditor({ initial, onCancel, onSaved }: {
  initial: Omit<Partial<Group>, 'settlementMethods'> & { settlementMethods: string[] }
  onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = !!initial.id
  const [f, setF] = useState({
    name: initial.name || '', code: initial.code || '',
    isCreditBearing: initial.isCreditBearing ?? true, requiresApproval: initial.requiresApproval ?? false,
    settlementMethods: initial.settlementMethods, defaultSettlementMethod: initial.defaultSettlementMethod || 'CASH',
    maxCredit: initial.maxCredit ?? 0, paymentTermsDays: initial.paymentTermsDays ?? 0, priority: initial.priority ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  const toggleMethod = (m: Settlement) => {
    const has = f.settlementMethods.includes(m)
    const next = has ? f.settlementMethods.filter((x) => x !== m) : [...f.settlementMethods, m]
    set({ settlementMethods: next, defaultSettlementMethod: next.includes(f.defaultSettlementMethod) ? f.defaultSettlementMethod : (next[0] || 'CASH') })
  }

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit) await request(`/api/credit/groups/${initial.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await request('/api/credit/groups', { method: 'POST', body: JSON.stringify(f) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${initial.name}` : 'New credit group'}</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Name</span><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Code {isEdit && '(fixed)'}</span><input className={inputCls} value={f.code} disabled={isEdit} onChange={(e) => set({ code: e.target.value })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Max credit (0 = no limit)</span><input type="number" className={inputCls} value={f.maxCredit} onChange={(e) => set({ maxCredit: Number(e.target.value) })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Payment terms (days)</span><input type="number" className={inputCls} value={f.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: Number(e.target.value) })} /></label>
      </div>
      <div className="mb-3">
        <span className="text-xs text-gray-500 block mb-1">Settlement methods</span>
        <div className="flex flex-wrap gap-2">
          {SETTLEMENT_METHODS.map((m) => (
            <button key={m} type="button" onClick={() => toggleMethod(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition ${f.settlementMethods.includes(m) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500'}`}>{m}</button>
          ))}
        </div>
      </div>
      <label className="block mb-3 max-w-xs"><span className="text-xs text-gray-500">Default settlement method</span>
        <select className={inputCls} value={f.defaultSettlementMethod} onChange={(e) => set({ defaultSettlementMethod: e.target.value })}>
          {f.settlementMethods.map((m) => <option key={m} value={m}>{m}</option>)}
        </select></label>
      <Toggle label="Credit-bearing" hint="Bills in this group are real receivables (off = internal marker like staff loss)." checked={f.isCreditBearing} onChange={(v) => set({ isCreditBearing: v })} />
      <Toggle label="Requires approval" hint="New bills wait for sign-off before counting as debt." checked={f.requiresApproval} onChange={(v) => set({ requiresApproval: v })} />
      <div className="flex gap-2 mt-3">
        <button onClick={save} disabled={saving || !f.name} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}

// ─── Accounts tab ────────────────────────────────────────────────────────────
function AccountsTab() {
  const { request } = useApi()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async (search: string) => {
    setLoading(true)
    try { setAccounts(await request(`/api/credit/accounts?q=${encodeURIComponent(search)}`)) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load('') }, [load])

  const save = async (id: string, data: { creditLimitOverride: number | null; status: string }) => {
    try { await request(`/api/credit/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); toast.success('Saved'); setEditing(null); load(q) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); load(q) }} className="flex gap-2">
        <input className={inputCls + ' max-w-xs'} placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Search</button>
      </form>
      <Card>
        {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                <th className="py-2 pr-3">Account</th><th className="pr-3">Type</th><th className="pr-3">Groups</th>
                <th className="pr-3 text-right">Credit limit</th><th className="pr-3 text-right">Outstanding</th><th className="pr-3">Status</th><th></th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 align-top">
                    <td className="py-2 pr-3 font-medium text-gray-800">{a.displayName}</td>
                    <td className="pr-3 text-gray-500">{a.accountType}</td>
                    <td className="pr-3 text-gray-500">{a.groups.map((g) => g.name).join(', ') || '—'}</td>
                    <td className="pr-3 text-right text-gray-700">{a.effectiveLimit > 0 ? fmt(a.effectiveLimit) : '—'}{a.creditLimitOverride ? <span className="block text-[10px] text-indigo-500">override</span> : null}</td>
                    <td className={`pr-3 text-right ${a.outstanding > a.effectiveLimit && a.effectiveLimit > 0 ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>{fmt(a.outstanding)}</td>
                    <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${a.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{a.status}</span></td>
                    <td className="text-right"><button onClick={() => setEditing(editing === a.id ? null : a.id)} className="text-xs text-indigo-600 hover:text-indigo-800">{editing === a.id ? 'Close' : 'Edit'}</button></td>
                  </tr>
                ))}
                {!accounts.length && <tr><td colSpan={7} className="py-6 text-center text-gray-400">No accounts</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && (() => { const a = accounts.find((x) => x.id === editing)!; return <AccountEditor account={a} onCancel={() => setEditing(null)} onSave={save} /> })()}
    </div>
  )
}

function AccountEditor({ account, onCancel, onSave }: { account: Account; onCancel: () => void; onSave: (id: string, d: { creditLimitOverride: number | null; status: string }) => void }) {
  const [override, setOverride] = useState<string>(account.creditLimitOverride ? String(account.creditLimitOverride) : '')
  const [status, setStatus] = useState(account.status)
  return (
    <Card>
      <h3 className="font-semibold text-gray-800 mb-3">Edit {account.displayName}</h3>
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <label className="block"><span className="text-xs text-gray-500">Credit limit override (blank = use group/person limit)</span>
          <input type="number" className={inputCls} value={override} onChange={(e) => setOverride(e.target.value)} placeholder={account.personCreditLimit ? `person limit: ${fmt(account.personCreditLimit)}` : 'none'} /></label>
        <label className="block"><span className="text-xs text-gray-500">Status</span>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['ACTIVE', 'SUSPENDED', 'CLOSED', 'BLACKLISTED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
      </div>
      <div className="flex gap-2">
        <button onClick={() => onSave(account.id, { creditLimitOverride: override === '' ? null : Number(override), status })} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Save</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </Card>
  )
}
