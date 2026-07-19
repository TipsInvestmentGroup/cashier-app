'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import Link from 'next/link'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { resolveBusinessDateLocal, DEFAULT_BUSINESS_CALENDAR } from '@/lib/business-calendar-shared'
import { DONE_STATUSES, statusColor } from '@/lib/collection-status'
import { format } from 'date-fns'
import { User, Clock, History, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'

interface Outlet { id: string; name: string }
interface Template { id: string; name: string; code: string; isDefault: boolean; isActive: boolean }
interface Stage { id: string; key: string; label: string; order: number }
interface TodaySession {
  id: string; status: string; date: string; createdAt: string; updatedAt: string
  outlet: { name: string }
  template: { name: string; description: string | null; stages: Stage[] }
  createdBy: { name: string } | null
  completedBy: { name: string } | null
  stageRecords: { status: string; stageId: string; updatedAt: string }[]
}

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

  // The Business Calendar Engine's start time for the selected outlet —
  // starts at today's exact legacy default and is corrected once the
  // snapshot for the selected outlet loads.
  const [calendarStartTime, setCalendarStartTime] = useState(DEFAULT_BUSINESS_CALENDAR.businessDayStartTime)
  useEffect(() => {
    const id = outletId || user?.outlet?.id
    request(`/api/business-calendar/snapshot${id ? `?outletId=${id}` : ''}`)
      .then((s) => { if (s?.config?.businessDayStartTime) setCalendarStartTime(s.config.businessDayStartTime) })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletId, user?.outlet?.id])

  const businessToday = format(resolveBusinessDateLocal(new Date(), calendarStartTime), 'yyyy-MM-dd')
  const isBeforeCutover = businessToday !== format(new Date(), 'yyyy-MM-dd')
  const [sessionDate, setSessionDate] = useState(businessToday)
  useEffect(() => { setSessionDate(businessToday) }, [businessToday]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [o, t, sessions] = await Promise.all([
        request('/api/outlets'), request('/api/collection-templates'),
        request(`/api/collection-sessions?date=${sessionDate}`).catch(() => []),
      ])
      setOutlets(o || [])
      const custom = (t || []).filter((tpl: Template) => !tpl.isDefault && tpl.isActive)
      setTemplates(custom)
      setTodaySessions(sessions || [])
      if (user?.outlet?.id) setOutletId(user.outlet.id)
      else if (o?.[0]) setOutletId(o[0].id)
      if (custom[0]) setTemplateId(custom[0].id)
    } finally { setLoading(false) }
  }, [request, user, sessionDate])

  useEffect(() => { load() }, [load])

  const openSession = async () => {
    if (!outletId || !templateId) return
    setOpening(true)
    try {
      const session = await request('/api/collection-sessions', { method: 'POST', body: JSON.stringify({ outletId, templateId, date: sessionDate }) })
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
                <label className="text-xs font-semibold text-gray-500">Business Date</label>
                <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                {isBeforeCutover && sessionDate === businessToday && (
                  <p className="text-xs text-amber-600 mt-1">
                    Auto-set to {format(new Date(businessToday), 'dd MMM')} — before the {calendarStartTime} business-day cutover.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Outlet</label>
                <select value={outletId} onChange={(e) => setOutletId(e.target.value)} disabled={!!user?.outlet?.id}
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
                {opening ? 'Opening…' : "Open Session"}
              </button>
            </>
          )}
        </div>

        {todaySessions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="text-sm font-bold text-gray-700 mb-3">Today's Sessions</h2>
            <div className="space-y-3">
              {todaySessions.map((s) => {
                const stages = s.template.stages
                const isStageDone = (stageId: string) => s.stageRecords.some((r) => r.stageId === stageId && DONE_STATUSES.has(r.status))
                const stagesDone = stages.filter((st) => isStageDone(st.id)).length
                const stagesTotal = stages.length || 1
                const pct = Math.round((stagesDone / stagesTotal) * 100)
                const currentStage = stages.find((st) => !isStageDone(st.id))
                const lastUpdated = s.stageRecords.reduce((latest, r) => r.status && new Date(r.updatedAt || 0) > latest ? new Date(r.updatedAt) : latest, new Date(s.updatedAt))
                return (
                  <div key={s.id} className="border border-gray-100 rounded-xl p-3.5 hover:border-indigo-200 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-gray-800">{s.template.name}</p>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{format(new Date(s.date), 'dd MMM yyyy')}</span>
                          <span className={`text-[10px] font-semibold ${statusColor(s.status)}`}>{s.status}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{s.outlet.name}</p>
                        {s.template.description && <p className="text-xs text-gray-400 mt-0.5 italic">{s.template.description}</p>}
                      </div>
                      <Link href={`/collection-sessions/${s.id}`} className="shrink-0 flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap">
                        View Details <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>

                    <p className="text-xs text-gray-600 mt-2">
                      {currentStage ? <>Current Stage: <span className="font-semibold">{currentStage.label}</span></> : <span className="font-semibold text-emerald-600">All stages complete</span>}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{stagesDone}/{stagesTotal} stages</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> Opened by {s.createdBy?.name || '—'}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {format(new Date(s.createdAt), 'dd MMM, HH:mm')}</span>
                      <span className="flex items-center gap-1"><History className="w-3 h-3" /> Updated {format(lastUpdated, 'dd MMM, HH:mm')}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
