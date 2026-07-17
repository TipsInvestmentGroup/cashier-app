'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { BookOpen } from 'lucide-react'
import toast from 'react-hot-toast'

const GUIDE_URL = 'https://claude.ai/code/artifact/6f64a71f-ad53-45e1-a65e-d6c54820d242'

interface Template { id: string; code: string; name: string; description: string | null; isDefault: boolean; isActive: boolean }

export default function CollectionTemplatesPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const router = useRouter()
  const [canManage, setCanManage] = useState(false)
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [duplicating, setDuplicating] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tpl, perms] = await Promise.all([request('/api/collection-templates'), request('/api/permissions/me')])
      setItems(tpl || [])
      setCanManage(user?.role === 'ADMIN' || !!perms?.COLLECTION_TEMPLATES?.canAdd)
    } finally { setLoading(false) }
  }, [request, user])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!newName.trim()) return
    try {
      const created = await request('/api/collection-templates', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) })
      toast.success('Template created — add stages next')
      setNewName('')
      load()
      window.location.href = `/collection-templates/${created.id}`
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not create template') }
  }

  const remove = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"?`)) return
    try { await request(`/api/collection-templates/${t.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  const duplicate = async (t: Template) => {
    setDuplicating(t.id)
    try {
      const copy = await request(`/api/collection-templates/${t.id}/duplicate`, { method: 'POST' })
      toast.success(`Duplicated as "${copy.name}" — it's saved inactive until you review it`)
      router.push(`/collection-templates/${copy.id}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not duplicate template')
    } finally { setDuplicating(null) }
  }

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Collection Templates</h1>
            <p className="text-gray-500 text-sm">Define how a Daily Collection is structured — stages, sections, and fields — without a code change.</p>
          </div>
          <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100 whitespace-nowrap">
            <BookOpen className="w-3.5 h-3.5" /> Setup Guide
          </a>
        </div>

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            👁️ View only. Creating or editing templates is limited to administrators.
          </div>
        )}

        {canManage && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create() }}
                placeholder="New template name (e.g. Restaurant Collection)…"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
              <button onClick={create} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Create Template</button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="divide-y divide-gray-50">
              {items.map((t) => (
                <div key={t.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${t.isActive ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{t.name}</span>
                      {t.isDefault && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-semibold rounded-full">Default</span>}
                      {!t.isActive && <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[11px] font-semibold rounded-full">Disabled</span>}
                    </div>
                    {t.description && <p className="text-xs text-gray-400 mt-0.5">{t.description}</p>}
                  </div>
                  <Link href={`/collection-templates/${t.id}`} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">
                    {canManage ? 'Edit' : 'View'}
                  </Link>
                  {canManage && (
                    <button onClick={() => duplicate(t)} disabled={duplicating === t.id}
                      className="px-3 py-1.5 bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-100 disabled:opacity-50">
                      {duplicating === t.id ? 'Duplicating…' : 'Duplicate'}
                    </button>
                  )}
                  {canManage && !t.isDefault && (
                    <button onClick={() => remove(t)} className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                  )}
                </div>
              ))}
              {items.length === 0 && <p className="py-6 text-center text-gray-400 text-sm">No templates yet</p>}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
