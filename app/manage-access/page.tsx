'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { VALID_ROLES } from '@/lib/shared-constants'
import toast from 'react-hot-toast'

type ActionKey = 'add' | 'edit' | 'delete'
const ACTIONS: { key: ActionKey; label: string; resource: string }[] = [
  { key: 'add', label: 'Add users', resource: 'ADD_USER' },
  { key: 'edit', label: 'Edit users', resource: 'EDIT_USER' },
  { key: 'delete', label: 'Delete users', resource: 'DELETE_USER' },
]

interface RoleRow { role: string; resource: string; allowed: boolean }
interface UserRow { id: string; resource: string; canAdd: boolean; user: { id: string; name: string; email: string } }
interface Person { id: string; name: string; email: string }

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`w-10 h-6 rounded-full transition relative ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

export default function ManageAccessPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [roleMatrix, setRoleMatrix] = useState<Record<string, Record<ActionKey, boolean>>>({})
  const [overrides, setOverrides] = useState<Record<string, Partial<Record<ActionKey, boolean>>>>({})
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [addingUserId, setAddingUserId] = useState('')

  const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const isOwner = !!OWNER_EMAIL && (user?.email || '').toLowerCase() === OWNER_EMAIL

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [roleResults, userResults, allPeople] = await Promise.all([
        Promise.all(ACTIONS.map((a) => request(`/api/role-permissions?resource=${a.resource}`))),
        Promise.all(ACTIONS.map((a) => request(`/api/permissions?resource=${a.resource}`))),
        request('/api/users'),
      ])
      const matrix: Record<string, Record<ActionKey, boolean>> = {}
      for (const role of VALID_ROLES) matrix[role] = { add: false, edit: false, delete: false }
      roleResults.forEach((rows: RoleRow[], i: number) => {
        const action = ACTIONS[i].key
        rows.forEach((r) => { if (matrix[r.role]) matrix[r.role][action] = r.allowed })
      })
      setRoleMatrix(matrix)

      const ov: Record<string, Partial<Record<ActionKey, boolean>>> = {}
      userResults.forEach((rows: UserRow[], i: number) => {
        const action = ACTIONS[i].key
        rows.forEach((r) => { ov[r.user.id] = { ...ov[r.user.id], [action]: r.canAdd } })
      })
      setOverrides(ov)
      setPeople(allPeople.map((p: Person) => ({ id: p.id, name: p.name, email: p.email })))
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load access settings')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  if (!isOwner) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-5xl mb-3">🔒</div>
          <p className="text-gray-600 font-medium">Only the system owner can manage user-management access</p>
        </div>
      </div>
    </AppShell>
  )

  const setRole = async (role: string, action: ActionKey, allowed: boolean) => {
    setRoleMatrix((m) => ({ ...m, [role]: { ...m[role], [action]: allowed } }))
    try {
      await request('/api/role-permissions', { method: 'PUT', body: JSON.stringify({ resource: ACTIONS.find((a) => a.key === action)!.resource, role, allowed }) })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
      setRoleMatrix((m) => ({ ...m, [role]: { ...m[role], [action]: !allowed } }))
    }
  }

  const setOverride = async (userId: string, action: ActionKey, allowed: boolean) => {
    setOverrides((o) => ({ ...o, [userId]: { ...o[userId], [action]: allowed } }))
    try {
      await request('/api/permissions', { method: 'PUT', body: JSON.stringify({ resource: ACTIONS.find((a) => a.key === action)!.resource, userId, canAdd: allowed }) })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
      setOverrides((o) => ({ ...o, [userId]: { ...o[userId], [action]: !allowed } }))
    }
  }

  const addOverride = () => {
    if (!addingUserId) return
    setOverrides((o) => ({ ...o, [addingUserId]: o[addingUserId] || { add: false, edit: false, delete: false } }))
    setAddingUserId('')
  }

  const overriddenIds = Object.keys(overrides)
  const availablePeople = people.filter((p) => !overriddenIds.includes(p.id))

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manage Access</h1>
          <p className="text-gray-500 text-sm">Choose which roles — and optionally which individual people — can add, edit, or delete users in User Management. The system owner always has full access regardless of these settings.</p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            <Card>
              <h2 className="font-semibold text-gray-800 mb-1">Role defaults</h2>
              <p className="text-xs text-gray-400 mb-4">Applies to every user with that role, unless overridden below.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-2 pr-4 font-semibold">Role</th>
                      {ACTIONS.map((a) => <th key={a.key} className="py-2 px-4 font-semibold">{a.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {VALID_ROLES.map((role) => (
                      <tr key={role}>
                        <td className="py-3 pr-4 font-medium text-gray-800">{role}</td>
                        {ACTIONS.map((a) => (
                          <td key={a.key} className="py-3 px-4">
                            <Toggle checked={!!roleMatrix[role]?.[a.key]} onChange={(v) => setRole(role, a.key, v)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <h2 className="font-semibold text-gray-800 mb-1">Per-person overrides</h2>
              <p className="text-xs text-gray-400 mb-4">Grant or deny specific people, regardless of their role default above.</p>
              <div className="space-y-2 mb-4">
                {overriddenIds.length === 0 && <p className="text-sm text-gray-400">No overrides yet.</p>}
                {overriddenIds.map((id) => {
                  const person = people.find((p) => p.id === id)
                  if (!person) return null
                  return (
                    <div key={id} className="flex items-center justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
                      <div>
                        <div className="font-medium text-gray-800 text-sm">{person.name}</div>
                        <div className="text-xs text-gray-400">{person.email}</div>
                      </div>
                      <div className="flex items-center gap-6">
                        {ACTIONS.map((a) => (
                          <div key={a.key} className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{a.label.split(' ')[0]}</span>
                            <Toggle checked={!!overrides[id]?.[a.key]} onChange={(v) => setOverride(id, a.key, v)} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <select value={addingUserId} onChange={(e) => setAddingUserId(e.target.value)}
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                  <option value="">-- Select a person to add an override --</option>
                  {availablePeople.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
                </select>
                <button type="button" onClick={addOverride} disabled={!addingUserId}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                  Add
                </button>
              </div>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
