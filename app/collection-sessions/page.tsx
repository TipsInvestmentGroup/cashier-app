'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import Link from 'next/link'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Template { id: string; name: string; code: string; isDefault: boolean; isActive: boolean }
interface TodaySession {
  id: string; status: string
  outlet: { name: string }
  template: { name: string }
  stageRecords: { status: string }[]
}

const DONE_STATUSES = new Set(['COMPLETED', 'APPROVED', 'PENDING_APPROVAL'])

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
  const [todaySessions, setTodaySessions] = useState<TodaySession[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const [o, t, sessions] = await Promise.all([
        request('/api/outlets'), request('/api/collection-templates'),
        request(`/api/collection-sessions?date=${today}`).catch(() => []),
      ])
      setOutlets(o || [])
      const custom = (t || []).filter((tpl: Template) => !tpl.isDefault && tpl.isActive)
      setTemplates(custom)
      setTodaySessions(sessions || [])
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

        {todaySessions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-3">Today's Sessions</h2>
            <div className="divide-y divide-gray-50">
              {todaySessions.map((s) => {
                const done = s.stageRecords.filter((r) => DONE_STATUSES.has(r.status)).length
                const total = s.stageRecords.length || 1
                const pct = Math.round((done / total) * 100)
                return (
                  <Link key={s.id} href={`/collection-sessions/${s.id}`} className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{s.template.name}</p>
                      <p className="text-xs text-gray-400">{s.outlet.name} · {s.status}</p>
                    </div>
                    <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
