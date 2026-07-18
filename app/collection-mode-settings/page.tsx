'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { VALID_ROLES } from '@/lib/shared-constants'
import toast from 'react-hot-toast'

type Mode = 'DEFAULT' | 'TRANSACTION_VERIFICATION' | 'HYBRID'
interface ConfigRow { id: string; scope: 'GLOBAL' | 'COMPANY' | 'OUTLET' | 'ROLE'; scopeId: string | null; mode: Mode }
interface Outlet { id: string; name: string }
interface Company { id: string; name: string }

const MODE_LABEL: Record<Mode, string> = { DEFAULT: 'Default Collection', TRANSACTION_VERIFICATION: 'Transaction Verification', HYBRID: 'Hybrid (mixed per-role)' }

export default function CollectionModeSettingsPage() {
  const { request } = useApi()
  const [rows, setRows] = useState<ConfigRow[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newOutletId, setNewOutletId] = useState('')
  const [newOutletMode, setNewOutletMode] = useState<Mode>('TRANSACTION_VERIFICATION')
  const [newCompanyId, setNewCompanyId] = useState('')
  const [newCompanyMode, setNewCompanyMode] = useState<Mode>('TRANSACTION_VERIFICATION')
  const [newRole, setNewRole] = useState('')
  const [newRoleMode, setNewRoleMode] = useState<Mode>('TRANSACTION_VERIFICATION')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, o, c] = await Promise.all([request('/api/collection-mode-config'), request('/api/outlets'), request('/api/companies')])
      setRows(cfg || []); setOutlets(o || []); setCompanies(c || [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const global = rows.find((r) => r.scope === 'GLOBAL')
  const outletRows = rows.filter((r) => r.scope === 'OUTLET')
  const companyRows = rows.filter((r) => r.scope === 'COMPANY')
  const roleRows = rows.filter((r) => r.scope === 'ROLE')

  const set = async (scope: ConfigRow['scope'], scopeId: string | null, mode: Mode) => {
    setSaving(true)
    try {
      await request('/api/collection-mode-config', { method: 'POST', body: JSON.stringify({ scope, scopeId, mode }) })
      toast.success('Saved')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(false) }
  }

  const remove = async (id: string) => {
    try { await request(`/api/collection-mode-config?id=${id}`, { method: 'DELETE' }); toast.success('Removed'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not remove') }
  }

  if (loading) return <AppShell><SetupTabs /><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Collection Mode</h1>
          <p className="text-gray-500 text-sm">Choose which collection workflow applies where — Default Collection (the traditional cashier form), Transaction Verification (staff self-declare, cashier validates), or Hybrid (both at once — e.g. some staff self-declare while the cashier still enters others directly). Every collection ends up the same regardless of mode; only the data-entry screens differ.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-800 mb-1">Global Default</h2>
          <p className="text-xs text-gray-400 mb-3">Applies everywhere unless overridden below by Company, Outlet, or Role.</p>
          <div className="flex gap-2">
            {(['DEFAULT', 'TRANSACTION_VERIFICATION', 'HYBRID'] as Mode[]).map((m) => (
              <button key={m} disabled={saving} onClick={() => set('GLOBAL', null, m)}
                className={`flex-1 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${(global?.mode || 'DEFAULT') === m ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>

        <OverrideSection
          title="By Outlet" hint="Most common override — different physical locations often run differently."
          rows={outletRows} nameFor={(id) => outlets.find((o) => o.id === id)?.name || id}
          options={outlets.filter((o) => !outletRows.some((r) => r.scopeId === o.id)).map((o) => ({ id: o.id, label: o.name }))}
          newId={newOutletId} setNewId={setNewOutletId} newMode={newOutletMode} setNewMode={setNewOutletMode}
          onAdd={() => newOutletId && set('OUTLET', newOutletId, newOutletMode).then(() => setNewOutletId(''))}
          onRemove={remove}
        />

        <OverrideSection
          title="By Company" hint="For multi-business deployments — each company can run its own default."
          rows={companyRows} nameFor={(id) => companies.find((c) => c.id === id)?.name || id}
          options={companies.filter((c) => !companyRows.some((r) => r.scopeId === c.id)).map((c) => ({ id: c.id, label: c.name }))}
          newId={newCompanyId} setNewId={setNewCompanyId} newMode={newCompanyMode} setNewMode={setNewCompanyMode}
          onAdd={() => newCompanyId && set('COMPANY', newCompanyId, newCompanyMode).then(() => setNewCompanyId(''))}
          onRemove={remove}
        />

        <OverrideSection
          title="By Staff Role" hint="Optional — e.g. force WAITER to always self-declare regardless of outlet."
          rows={roleRows} nameFor={(id) => id}
          options={VALID_ROLES.filter((r) => !roleRows.some((row) => row.scopeId === r)).map((r) => ({ id: r, label: r }))}
          newId={newRole} setNewId={setNewRole} newMode={newRoleMode} setNewMode={setNewRoleMode}
          onAdd={() => newRole && set('ROLE', newRole, newRoleMode).then(() => setNewRole(''))}
          onRemove={remove}
        />

        <p className="text-xs text-gray-400">Priority when several apply: Staff Role &gt; Outlet &gt; Company &gt; Global Default. Switching modes never touches past collections — only new sessions follow the new mode.</p>
      </div>
    </AppShell>
  )
}

function OverrideSection({
  title, hint, rows, nameFor, options, newId, setNewId, newMode, setNewMode, onAdd, onRemove,
}: {
  title: string; hint: string; rows: ConfigRow[]; nameFor: (id: string) => string
  options: { id: string; label: string }[]
  newId: string; setNewId: (v: string) => void; newMode: Mode; setNewMode: (m: Mode) => void
  onAdd: () => void; onRemove: (id: string) => void
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h2 className="font-semibold text-gray-800 mb-1">{title}</h2>
      <p className="text-xs text-gray-400 mb-3">{hint}</p>

      {rows.length > 0 && (
        <div className="divide-y divide-gray-50 mb-3">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm font-medium text-gray-800">{nameFor(r.scopeId!)}</span>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-semibold rounded-full">{MODE_LABEL[r.mode]}</span>
                <button onClick={() => onRemove(r.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {options.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select value={newId} onChange={(e) => setNewId(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">Select…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select value={newMode} onChange={(e) => setNewMode(e.target.value as Mode)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="DEFAULT">Default Collection</option>
            <option value="TRANSACTION_VERIFICATION">Transaction Verification</option>
            <option value="HYBRID">Hybrid (mixed per-role)</option>
          </select>
          <button onClick={onAdd} disabled={!newId} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">Add Override</button>
        </div>
      )}
    </div>
  )
}
