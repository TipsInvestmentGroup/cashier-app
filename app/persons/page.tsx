'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, BILL_TYPE_COLORS, BILL_TYPE_LABELS } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import toast from 'react-hot-toast'

interface Person {
  id: string; name: string; phone?: string; email?: string; type: string; creditLimit: number; isActive: boolean
}
interface Category { code: string; label: string; isActive: boolean }

export default function PersonsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', type: 'CUSTOMER', creditLimit: '0', isActive: true })
  const [managerEmail, setManagerEmail] = useState('')
  const [accessOpen, setAccessOpen] = useState(false)
  const [allUsers, setAllUsers] = useState<{ id: string; name: string; email: string }[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const PERSON_TYPES = categories.filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.label }))
  const catLabel = (code: string) => categories.find((c) => c.code === code)?.label || BILL_TYPE_LABELS[code] || code
  const catColor = (code: string) => BILL_TYPE_COLORS[code] || 'bg-gray-100 text-gray-700'

  const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const FIXED_MANAGER = 'r.mlay@tips.co.tz'
  const myEmail = (user?.email || '').toLowerCase()
  const isOwner = !!OWNER_EMAIL && myEmail === OWNER_EMAIL
  const canEditDelete = !!myEmail && [OWNER_EMAIL, FIXED_MANAGER.toLowerCase(), managerEmail].filter(Boolean).includes(myEmail)

  const q = search.trim().toLowerCase()
  const filtered = persons.filter((p) => !q || `${p.name} ${p.phone || ''} ${p.email || ''}`.toLowerCase().includes(q))

  const canManage = ['ADMIN', 'ACCOUNTANT', 'MANAGER'].includes(user?.role || '')

  const load = useCallback(async () => {
    setLoading(true)
    const params = filterType ? `?type=${filterType}` : ''
    const [data, access, cats] = await Promise.all([request(`/api/persons${params}`), request('/api/persons-access'), request('/api/person-categories')])
    setPersons(data)
    setManagerEmail((access?.managerEmail || '').toLowerCase())
    setCategories(cats || [])
    setLoading(false)
  }, [request, filterType])

  useEffect(() => { load() }, [load])

  // Owner: load the user list for the access picker
  useEffect(() => {
    if (isOwner) request('/api/users').then((u) => setAllUsers(u || [])).catch(() => {})
  }, [isOwner, request])

  const resetForm = () => setForm({ name: '', phone: '', email: '', type: 'CUSTOMER', creditLimit: '0', isActive: true })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const payload = JSON.stringify({ ...form, creditLimit: Number(form.creditLimit) })
      if (editingId) {
        await request(`/api/persons/${editingId}`, { method: 'PUT', body: payload })
        toast.success('Person updated!')
      } else {
        await request('/api/persons', { method: 'POST', body: payload })
        toast.success('Person added!')
      }
      resetForm(); setEditingId(null); setShowForm(false); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving person')
    } finally {
      setSubmitting(false)
    }
  }

  const startEdit = (p: Person) => {
    setEditingId(p.id)
    setForm({ name: p.name, phone: p.phone || '', email: p.email || '', type: p.type, creditLimit: String(p.creditLimit ?? 0), isActive: p.isActive })
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const newPerson = () => { setEditingId(null); resetForm(); setShowForm((s) => !s) }
  const deletePerson = async (p: Person) => {
    if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    try {
      await request(`/api/persons/${p.id}`, { method: 'DELETE' })
      toast.success('Person deleted'); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting person')
    }
  }
  const saveAccess = async (email: string) => {
    try {
      await request('/api/persons-access', { method: 'PUT', body: JSON.stringify({ email }) })
      setManagerEmail(email.toLowerCase()); toast.success('Persons access updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating access')
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Persons</h1>
            <p className="text-gray-500 text-sm">Manage admins, directors, customers and staff</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {isOwner && (
              <button onClick={() => setAccessOpen(true)}
                className="px-4 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-medium hover:border-gray-300 transition">
                🔐 Manage Access
              </button>
            )}
            {canManage && (
              <button onClick={newPerson}
                className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
                <span className="text-lg">+</span> Add Person
              </button>
            )}
          </div>
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search persons by name, phone or email…" />

        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilterType('')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${!filterType ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
            All
          </button>
          {PERSON_TYPES.map((t) => (
            <button key={t.value} onClick={() => setFilterType(filterType === t.value ? '' : t.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterType === t.value ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {showForm && (canManage || canEditDelete) && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">{editingId ? 'Edit Person' : 'Add New Person'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mb-2">
                {PERSON_TYPES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setForm({ ...form, type: t.value })}
                    className={`py-2 rounded-xl text-sm font-medium transition ${form.type === t.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Full Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="John Doe" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="+255 7xx xxx xxx" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="john@example.com" />
                </div>
                {['ADMIN', 'DIRECTOR'].includes(form.type) && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Credit Limit (TZS)</label>
                    <input type="number" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                      placeholder="500000" />
                  </div>
                )}
              </div>
              {editingId && (
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4" />
                  Active (uncheck to deactivate)
                </label>
              )}
              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : editingId ? 'Update Person' : 'Add Person'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {loading ? (
            <div className="col-span-4 text-center py-12 text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="col-span-4 text-center py-12 text-gray-400">No persons found</div>
          ) : filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border-2 border-gray-100 p-5 hover:border-indigo-200 transition">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg flex-shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${catColor(p.type)}`}>
                    {catLabel(p.type)}
                  </span>
                </div>
              </div>
              {p.phone && <p className="text-sm text-gray-500 mb-1">📞 {p.phone}</p>}
              {p.email && <p className="text-sm text-gray-500 mb-1 truncate">✉️ {p.email}</p>}
              {p.creditLimit > 0 && (
                <div className="mt-3 bg-gray-50 rounded-lg p-2">
                  <p className="text-xs text-gray-500">Credit Limit</p>
                  <p className="font-bold text-gray-800">{formatCurrency(p.creditLimit)}</p>
                </div>
              )}
              {!p.isActive && <p className="mt-2 text-xs font-semibold text-gray-400">Inactive</p>}
              {canEditDelete && (
                <div className="mt-3 flex gap-2 pt-3 border-t border-gray-100">
                  <button onClick={() => startEdit(p)} className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Edit</button>
                  <button onClick={() => deletePerson(p)} className="flex-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Owner: manage who can edit/delete persons */}
      {accessOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAccessOpen(false)}>
          <div className="bg-white w-full max-w-md rounded-2xl shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">🔐 Persons Edit/Delete Access</h3>
              <button onClick={() => setAccessOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <p className="text-sm text-gray-500">Only these accounts can edit or delete persons:</p>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2"><span className="text-green-600">●</span> <strong>Owner</strong> — {OWNER_EMAIL || 'not set'}</li>
              <li className="flex items-center gap-2"><span className="text-green-600">●</span> <strong>Fixed</strong> — {FIXED_MANAGER}</li>
              <li className="flex items-center gap-2"><span className="text-green-600">●</span> <strong>Chosen manager</strong> — {managerEmail || '(none)'}</li>
            </ul>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Choose the third manager (change anytime)</label>
              <select value={managerEmail} onChange={(e) => saveAccess(e.target.value)}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">— None —</option>
                {allUsers
                  .filter((u) => u.email.toLowerCase() !== OWNER_EMAIL && u.email.toLowerCase() !== FIXED_MANAGER.toLowerCase())
                  .map((u) => <option key={u.id} value={u.email}>{u.name} ({u.email})</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Selecting a user grants them persons edit/delete; changing it instantly revokes the previous one.</p>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
