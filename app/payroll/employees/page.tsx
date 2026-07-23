'use client'
import { useEffect, useState, useCallback, Fragment } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

interface Lookup { id: string; code: string; name: string; status: string }
interface Employee {
  id: string; name: string; employeeNumber: string | null
  categoryId: string; categoryName: string; payGroupId: string; payGroupName: string
  baseSalary: number; baseCurrency: string; paymentMethod: string
  bankRef: string | null; mobileMoneyRef: string | null; status: string
  userId: string | null; userName: string | null; userRole: string | null
  personId: string | null; personName: string | null
  outletId: string | null; hireDate: string | null; notes: string | null
}
interface UserOpt { id: string; name: string; email: string; role: string; outletId: string | null }
interface PersonOpt { id: string; name: string; phone: string | null; code: string | null }

const STATUSES = ['ACTIVE', 'PROBATION', 'SUSPENDED', 'ON_LEAVE', 'TERMINATED']
const PAYMENT_METHODS = ['BANK', 'MOBILE_MONEY', 'CASH']
const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700', PROBATION: 'bg-amber-50 text-amber-700',
  SUSPENDED: 'bg-orange-50 text-orange-700', ON_LEAVE: 'bg-blue-50 text-blue-700',
  TERMINATED: 'bg-gray-100 text-gray-500',
}
const fmt = (n: number) => n.toLocaleString('en-US')
const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}

export default function PayrollEmployeesPage() {
  const { request } = useApi()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [categories, setCategories] = useState<Lookup[]>([])
  const [payGroups, setPayGroups] = useState<Lookup[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await request('/api/payroll/employees')
      setEmployees(d.employees || [])
      setCategories(d.categories || [])
      setPayGroups(d.payGroups || [])
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
    finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const activeCats = categories.filter((c) => c.status === 'ACTIVE')
  const activeGroups = payGroups.filter((g) => g.status === 'ACTIVE')
  const filtered = q
    ? employees.filter((e) => e.name.toLowerCase().includes(q.toLowerCase()) || (e.employeeNumber || '').toLowerCase().includes(q.toLowerCase()))
    : employees

  const totalBase = filtered.reduce((s, e) => s + (e.status !== 'TERMINATED' ? e.baseSalary : 0), 0)

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-6xl space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
            <p className="text-gray-500 text-sm">The compensation roster — one record per staff member, linking a login and/or a person record to a category, pay group and base salary. This is who pay runs pay. <Link href="/payroll/settings" className="text-indigo-600 hover:text-indigo-800 font-medium">Payroll Settings →</Link></p>
          </div>
          <button onClick={() => { setCreating(true); setEditing(null) }}
            className="shrink-0 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">+ New employee</button>
        </div>

        {(activeCats.length === 0 || activeGroups.length === 0) && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            No active {activeCats.length === 0 ? 'employee categories' : ''}{activeCats.length === 0 && activeGroups.length === 0 ? ' or ' : ''}{activeGroups.length === 0 ? 'pay groups' : ''} exist yet. Seed the payroll framework or create them before adding employees.
          </div>
        )}

        {creating && (
          <EmployeeEditor mode="create" categories={activeCats} payGroups={activeGroups}
            onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); load() }} />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-5 shadow">
            <p className="text-sm opacity-80">Total base pay (active)</p>
            <p className="text-3xl font-bold mt-1">{fmt(totalBase)}</p>
            <p className="text-xs opacity-70 mt-1">{filtered.filter((e) => e.status !== 'TERMINATED').length} active</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm text-gray-500">Employees</p>
            <p className="text-2xl font-bold mt-1 text-gray-800">{employees.length}</p>
            <p className="text-xs text-gray-400 mt-1">{employees.filter((e) => e.personId).length} linked to a person</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-sm text-gray-500">Base salary set</p>
            <p className="text-2xl font-bold mt-1 text-gray-800">{employees.filter((e) => e.baseSalary > 0).length}</p>
            <p className="text-xs text-gray-400 mt-1">{employees.filter((e) => e.baseSalary === 0 && e.status !== 'TERMINATED').length} still at zero</p>
          </div>
        </div>

        <input className={inputCls + ' max-w-xs'} placeholder="Search by name or number…" value={q} onChange={(e) => setQ(e.target.value)} />

        <Card>
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-3">Employee</th><th className="pr-3">Category</th><th className="pr-3">Pay group</th>
                  <th className="pr-3 text-right">Base salary</th><th className="pr-3">Pay via</th><th className="pr-3">Links</th><th className="pr-3">Status</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.map((e) => (
                    <Fragment key={e.id}>
                      <tr className="border-b border-gray-50 align-top">
                        <td className="py-2 pr-3">
                          <span className="font-medium text-gray-800">{e.name}</span>
                          {e.employeeNumber && <span className="block text-[11px] text-gray-400">#{e.employeeNumber}</span>}
                        </td>
                        <td className="pr-3 text-gray-600">{e.categoryName}</td>
                        <td className="pr-3 text-gray-600">{e.payGroupName}</td>
                        <td className={`pr-3 text-right ${e.baseSalary > 0 ? 'text-gray-800 font-medium' : 'text-amber-600'}`}>{e.baseSalary > 0 ? fmt(e.baseSalary) : 'not set'}</td>
                        <td className="pr-3 text-gray-500">{e.paymentMethod.replace('_', ' ').toLowerCase()}</td>
                        <td className="pr-3">
                          <span className="flex gap-1">
                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${e.userId ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`} title={e.userName || 'no login'}>login</span>
                            <span className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${e.personId ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`} title={e.personName || 'no person'}>person</span>
                          </span>
                        </td>
                        <td className="pr-3"><span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${STATUS_COLORS[e.status] || 'bg-gray-100 text-gray-500'}`}>{e.status.replace('_', ' ')}</span></td>
                        <td className="text-right"><button onClick={() => { setEditing(editing === e.id ? null : e.id); setCreating(false) }} className="text-xs text-indigo-600 hover:text-indigo-800">{editing === e.id ? 'Close' : 'Edit'}</button></td>
                      </tr>
                      {editing === e.id && (
                        <tr><td colSpan={8} className="pb-4 pt-1">
                          <EmployeeEditor mode="edit" employee={e} categories={activeCats} payGroups={activeGroups}
                            onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                  {!filtered.length && <tr><td colSpan={8} className="py-10 text-center text-gray-400">No employees{q ? ' match your search' : ' yet'}.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}

// ─── Editor (create + edit share the form; create adds the identity-link step) ──
function EmployeeEditor({ mode, employee, categories, payGroups, onCancel, onSaved }: {
  mode: 'create' | 'edit'
  employee?: Employee
  categories: Lookup[]; payGroups: Lookup[]
  onCancel: () => void; onSaved: () => void
}) {
  const { request } = useApi()
  const isEdit = mode === 'edit'
  const [saving, setSaving] = useState(false)

  const [f, setF] = useState({
    categoryId: employee?.categoryId || categories[0]?.id || '',
    payGroupId: employee?.payGroupId || payGroups[0]?.id || '',
    baseSalary: employee?.baseSalary ?? 0,
    baseCurrency: employee?.baseCurrency || 'TZS',
    paymentMethod: employee?.paymentMethod || 'BANK',
    bankRef: employee?.bankRef || '',
    mobileMoneyRef: employee?.mobileMoneyRef || '',
    employeeNumber: employee?.employeeNumber || '',
    status: employee?.status || 'ACTIVE',
    notes: employee?.notes || '',
  })
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })

  // Identity linking. On create you pick a user and/or a person; on edit you can
  // additionally attach a person to a login-only employee (the curated link).
  const [userId, setUserId] = useState<string | null>(employee?.userId ?? null)
  const [personId, setPersonId] = useState<string | null>(employee?.personId ?? null)
  const [users, setUsers] = useState<UserOpt[]>([])
  const [persons, setPersons] = useState<PersonOpt[]>([])
  const [optSearch, setOptSearch] = useState('')
  const canAttachPerson = !isEdit || !employee?.personId

  const loadOptions = useCallback(async (search: string) => {
    try {
      const d = await request(`/api/payroll/employees/options?q=${encodeURIComponent(search)}`)
      setUsers(d.users || []); setPersons(d.persons || [])
    } catch { /* non-fatal — the form still works with whatever is loaded */ }
  }, [request])
  useEffect(() => { if (!isEdit || canAttachPerson) loadOptions('') }, [isEdit, canAttachPerson, loadOptions])

  const save = async () => {
    setSaving(true)
    try {
      if (isEdit) {
        const body: Record<string, unknown> = { ...f }
        if (canAttachPerson && personId) body.personId = personId
        await request(`/api/payroll/employees/${employee!.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        if (!userId && !personId) { toast.error('Link a user account and/or a person'); setSaving(false); return }
        await request('/api/payroll/employees', { method: 'POST', body: JSON.stringify({ ...f, userId, personId }) })
      }
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-indigo-50/40 border border-indigo-100 rounded-2xl p-5">
      <h3 className="font-semibold text-gray-800 mb-3">{isEdit ? `Edit ${employee!.name}` : 'New employee'}</h3>

      {/* Identity links */}
      {!isEdit && (
        <div className="mb-4 space-y-3">
          <div className="flex gap-2">
            <input className={inputCls + ' max-w-xs'} placeholder="Search users / persons…" value={optSearch}
              onChange={(e) => setOptSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadOptions(optSearch)} />
            <button type="button" onClick={() => loadOptions(optSearch)} className="px-3 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Search</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-500">Login (User) {!personId && <span className="text-indigo-500">— at least one link required</span>}</span>
              <select className={inputCls} value={userId || ''} onChange={(e) => setUserId(e.target.value || null)}>
                <option value="">— none —</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </select></label>
            <label className="block"><span className="text-xs text-gray-500">Person record</span>
              <select className={inputCls} value={personId || ''} onChange={(e) => setPersonId(e.target.value || null)}>
                <option value="">— none —</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
              </select></label>
          </div>
        </div>
      )}
      {isEdit && (
        <div className="mb-4 text-xs text-gray-500 flex flex-wrap gap-4">
          <span>Login: <span className="font-medium text-gray-700">{employee!.userName || '—'}</span></span>
          <span>Person: <span className="font-medium text-gray-700">{employee!.personName || '—'}</span></span>
        </div>
      )}

      {/* Attach a person to a login-only employee (curated link) */}
      {isEdit && canAttachPerson && (
        <label className="block mb-4 max-w-md"><span className="text-xs text-gray-500">Attach a person record (enables settling their signed bills through payroll)</span>
          <select className={inputCls} value={personId || ''} onChange={(e) => setPersonId(e.target.value || null)}>
            <option value="">— leave unlinked —</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
          </select></label>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block"><span className="text-xs text-gray-500">Category</span>
          <select className={inputCls} value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Pay group</span>
          <select className={inputCls} value={f.payGroupId} onChange={(e) => set({ payGroupId: e.target.value })}>
            {payGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Employee number</span>
          <input className={inputCls} value={f.employeeNumber} onChange={(e) => set({ employeeNumber: e.target.value })} placeholder="optional" /></label>
        <label className="block"><span className="text-xs text-gray-500">Base salary ({f.baseCurrency})</span>
          <input type="number" min={0} className={inputCls} value={f.baseSalary} onChange={(e) => set({ baseSalary: Number(e.target.value) })} /></label>
        <label className="block"><span className="text-xs text-gray-500">Payment method</span>
          <select className={inputCls} value={f.paymentMethod} onChange={(e) => set({ paymentMethod: e.target.value })}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
          </select></label>
        <label className="block"><span className="text-xs text-gray-500">Status</span>
          <select className={inputCls} value={f.status} onChange={(e) => set({ status: e.target.value })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select></label>
        {f.paymentMethod === 'BANK' && (
          <label className="block"><span className="text-xs text-gray-500">Bank reference</span>
            <input className={inputCls} value={f.bankRef} onChange={(e) => set({ bankRef: e.target.value })} placeholder="account / handle" /></label>
        )}
        {f.paymentMethod === 'MOBILE_MONEY' && (
          <label className="block"><span className="text-xs text-gray-500">Mobile money number</span>
            <input className={inputCls} value={f.mobileMoneyRef} onChange={(e) => set({ mobileMoneyRef: e.target.value })} placeholder="e.g. 0754…" /></label>
        )}
      </div>

      <label className="block mt-3"><span className="text-xs text-gray-500">Notes</span>
        <input className={inputCls} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="optional" /></label>

      <div className="flex gap-2 mt-4">
        <button onClick={save} disabled={saving || !f.categoryId || !f.payGroupId} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  )
}
