'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

interface User { id: string; name: string; email: string; role: string; outlet?: { name: string } | null; isActive: boolean; createdAt: string }
interface Outlet { id: string; name: string }

const ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const ROLE_COLORS: Record<string, string> = {
  CASHIER: 'bg-blue-100 text-blue-700', ACCOUNTANT: 'bg-green-100 text-green-700',
  MANAGER: 'bg-purple-100 text-purple-700', DIRECTOR: 'bg-orange-100 text-orange-700', ADMIN: 'bg-red-100 text-red-700',
}

export default function UsersPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'CASHIER', outletId: '', isActive: true })

  const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const isOwner = !!OWNER_EMAIL && (user?.email || '').toLowerCase() === OWNER_EMAIL

  if (user?.role !== 'ADMIN' && !isOwner) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-5xl mb-3">🔒</div>
          <p className="text-gray-600 font-medium">Admin access required</p>
        </div>
      </div>
    </AppShell>
  )

  const load = useCallback(async () => {
    setLoading(true)
    const [u, o] = await Promise.all([request('/api/users'), request('/api/outlets')])
    setUsers(u); setOutlets(o); setLoading(false)
  }, [request])

  useEffect(() => { load() }, [load])

  const resetForm = () => setForm({ name: '', email: '', password: '', role: 'CASHIER', outletId: '', isActive: true })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (editingId) {
        await request(`/api/users/${editingId}`, { method: 'PUT', body: JSON.stringify(form) })
        toast.success('User updated!')
      } else {
        await request('/api/users', { method: 'POST', body: JSON.stringify(form) })
        toast.success('User created!')
      }
      resetForm(); setEditingId(null); setShowForm(false); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving user')
    } finally { setSubmitting(false) }
  }

  const startEdit = (u: User) => {
    setEditingId(u.id)
    setForm({ name: u.name, email: u.email, password: '', role: u.role, outletId: '', isActive: u.isActive })
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const newUser = () => { setEditingId(null); resetForm(); setShowForm((s) => !s) }
  const deleteUser = async (u: User) => {
    if (!window.confirm(`Delete user "${u.name}" (${u.email})? This cannot be undone.`)) return
    try {
      await request(`/api/users/${u.id}`, { method: 'DELETE' })
      toast.success('User deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting user')
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
            <p className="text-gray-500 text-sm">Create and manage system users</p>
          </div>
          <button onClick={newUser}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
            <span>+</span> New User
          </button>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">{editingId ? 'Edit User' : 'Create New User'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Email *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">{editingId ? 'New Password (optional)' : 'Password *'}</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required={!editingId} minLength={editingId ? 0 : 6}
                    placeholder={editingId ? 'Leave blank to keep current' : ''} />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Role *</label>
                  <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet (Optional)</label>
                  <select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    <option value="">-- All Outlets --</option>
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                {editingId && (
                  <div className="flex items-center gap-2 pt-7">
                    <input id="isActive" type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4" />
                    <label htmlFor="isActive" className="text-sm font-semibold text-gray-700">Active (uncheck to deactivate)</label>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : editingId ? 'Update User' : 'Create User'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-5 py-3 font-semibold">Name</th>
                    <th className="px-5 py-3 font-semibold">Email</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Outlet</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Created</th>
                    {isOwner && <th className="px-5 py-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                            {u.name.charAt(0)}
                          </div>
                          <span className="font-medium text-gray-800">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-600">{u.email}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${ROLE_COLORS[u.role]}`}>{u.role}</span>
                      </td>
                      <td className="px-5 py-4 text-gray-500">{u.outlet?.name || 'All'}</td>
                      <td className="px-5 py-4">
                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {u.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-500">{formatDate(u.createdAt)}</td>
                      {isOwner && (
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(u)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1">Edit</button>
                          <button onClick={() => deleteUser(u)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
