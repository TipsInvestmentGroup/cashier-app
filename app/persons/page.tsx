'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, BILL_TYPE_COLORS, BILL_TYPE_LABELS } from '@/lib/utils'
import toast from 'react-hot-toast'

interface Person {
  id: string; name: string; phone?: string; email?: string; type: string; creditLimit: number; isActive: boolean
}

const PERSON_TYPES = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'DIRECTOR', label: 'Director' },
  { value: 'CUSTOMER', label: 'Customer' },
  { value: 'DJ', label: 'DJ' },
  { value: 'STAFF_LOSS', label: 'Staff' },
]

export default function PersonsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', email: '', type: 'CUSTOMER', creditLimit: '0' })

  const canManage = ['ADMIN', 'ACCOUNTANT', 'MANAGER'].includes(user?.role || '')

  const load = useCallback(async () => {
    setLoading(true)
    const params = filterType ? `?type=${filterType}` : ''
    const data = await request(`/api/persons${params}`)
    setPersons(data)
    setLoading(false)
  }, [request, filterType])

  useEffect(() => { load() }, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await request('/api/persons', {
        method: 'POST',
        body: JSON.stringify({ ...form, creditLimit: Number(form.creditLimit) }),
      })
      toast.success('Person added!')
      setForm({ name: '', phone: '', email: '', type: 'CUSTOMER', creditLimit: '0' })
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error adding person')
    } finally {
      setSubmitting(false)
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
          {canManage && (
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              <span className="text-lg">+</span> Add Person
            </button>
          )}
        </div>

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

        {showForm && canManage && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">Add New Person</h2>
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
              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : 'Add Person'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
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
          ) : persons.length === 0 ? (
            <div className="col-span-4 text-center py-12 text-gray-400">No persons found</div>
          ) : persons.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl border-2 border-gray-100 p-5 hover:border-indigo-200 transition">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg flex-shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{p.name}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${BILL_TYPE_COLORS[p.type]}`}>
                    {BILL_TYPE_LABELS[p.type]}
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
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  )
}
