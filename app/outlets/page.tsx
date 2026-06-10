'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string; location?: string; isActive: boolean; createdAt: string }

export default function OutletsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', location: '' })
  const [submitting, setSubmitting] = useState(false)

  const canManage = user?.role === 'ADMIN'

  const load = useCallback(async () => {
    setLoading(true)
    const data = await request('/api/outlets')
    setOutlets(data); setLoading(false)
  }, [request])

  useEffect(() => { load() }, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await request('/api/outlets', { method: 'POST', body: JSON.stringify(form) })
      toast.success('Outlet created!')
      setForm({ name: '', location: '' }); setShowForm(false); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error')
    } finally { setSubmitting(false) }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Outlets</h1>
            <p className="text-gray-500 text-sm">Manage lounge branches and locations</p>
          </div>
          {canManage && (
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              <span>+</span> New Outlet
            </button>
          )}
        </div>

        {showForm && canManage && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Add New Outlet</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="Mikocheni Branch" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Location</label>
                  <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="Mikocheni, Dar es Salaam" />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Creating...' : 'Create Outlet'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">Loading...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {outlets.map((o) => (
              <div key={o.id} className="bg-white rounded-2xl border-2 border-gray-100 p-6 hover:border-indigo-200 transition">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center text-2xl">🏢</div>
                  <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${o.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {o.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{o.name}</h3>
                {o.location && <p className="text-sm text-gray-500 mt-1">📍 {o.location}</p>}
              </div>
            ))}
            {outlets.length === 0 && (
              <div className="col-span-3 text-center py-12 text-gray-400">No outlets configured yet</div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
