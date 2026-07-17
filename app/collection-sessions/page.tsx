'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Template { id: string; name: string; code: string; isDefault: boolean; isActive: boolean }

/**
 * Launcher for custom-template Collection Sessions. The Standard Staff
 * Collection template keeps using the existing /collections page unchanged —
 * this page is only for templates built via the Template Designer.
 */
export default function CollectionSessionsLauncherPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const router = useRouter()
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [outletId, setOutletId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, t] = await Promise.all([request('/api/outlets'), request('/api/collection-templates')])
      setOutlets(o || [])
      const custom = (t || []).filter((tpl: Template) => !tpl.isDefault && tpl.isActive)
      setTemplates(custom)
      if (user?.outletId) setOutletId(user.outletId)
      else if (o?.[0]) setOutletId(o[0].id)
      if (custom[0]) setTemplateId(custom[0].id)
    } finally { setLoading(false) }
  }, [request, user])

  useEffect(() => { load() }, [load])

  const openSession = async () => {
    if (!outletId || !templateId) return
    setOpening(true)
    try {
      const session = await request('/api/collection-sessions', { method: 'POST', body: JSON.stringify({ outletId, templateId }) })
      router.push(`/collection-sessions/${session.id}`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not open session')
    } finally { setOpening(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Collection Sessions</h1>
          <p className="text-gray-500 text-sm">Run today's collection using a custom template.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          {loading ? <div className="py-6 text-center text-gray-400">Loading…</div> : templates.length === 0 ? (
            <p className="text-sm text-gray-400">No custom templates yet — create one under Setup → Collection Templates.</p>
          ) : (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500">Outlet</label>
                <select value={outletId} onChange={(e) => setOutletId(e.target.value)} disabled={!!user?.outletId}
                  className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50">
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Template</label>
                <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <button onClick={openSession} disabled={opening} className="w-full py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {opening ? 'Opening…' : "Open Today's Session"}
              </button>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
