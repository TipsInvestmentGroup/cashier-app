'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { StageRenderer } from '@/components/collections/StageRenderer'
import { StageGridRenderer } from '@/components/collections/StageGridRenderer'
import toast from 'react-hot-toast'

interface FieldDef { id: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionDef { id: string; key: string; label: string; isMandatory: boolean; fields: FieldDef[] }
interface StageDef { id: string; key: string; label: string; entryMode: string; sections: SectionDef[] }
interface StageRecord { id: string; stageId: string; status: string; staffName: string | null }
interface SessionDetail {
  id: string; date: string; status: string
  outlet: { id: string; name: string }
  template: { id: string; name: string; stages: StageDef[] }
  stageRecords: StageRecord[]
}

const DONE_STATUSES = new Set(['COMPLETED', 'APPROVED', 'PENDING_APPROVAL'])

export default function CollectionSessionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { request } = useApi()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [staffCount, setStaffCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [activeStageId, setActiveStageId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, staff] = await Promise.all([request(`/api/collection-sessions/${id}`), request('/api/staff-list').catch(() => [])])
      setSession(s)
      setStaffCount((staff || []).length)
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not load session') }
    finally { setLoading(false) }
  }, [request, id])

  useEffect(() => { load() }, [load])

  const submitStage = async (stageId: string, payload: { staffId: string | null; staffName: string | null; values: Record<string, string> }) => {
    try {
      await request(`/api/collection-sessions/${id}/stages/${stageId}`, { method: 'POST', body: JSON.stringify(payload) })
      toast.success('Saved')
      setActiveStageId(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const submitGrid = async (stageId: string, rows: { staffId: string; values: Record<string, string> }[]) => {
    try {
      const res = await request(`/api/collection-sessions/${id}/stages/${stageId}`, { method: 'POST', body: JSON.stringify({ rows }) })
      toast.success(res.pendingApproval ? `Saved ${res.saved} — ${res.pendingApproval} pending approval` : `Saved ${res.saved}`)
      setActiveStageId(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const stageProgress = useMemo(() => {
    if (!session) return new Map<string, { done: number; total: number }>()
    const map = new Map<string, { done: number; total: number }>()
    for (const stage of session.template.stages) {
      const done = session.stageRecords.filter((r) => r.stageId === stage.id && DONE_STATUSES.has(r.status)).length
      map.set(stage.id, { done, total: staffCount || done })
    }
    return map
  }, [session, staffCount])

  if (loading) return <AppShell><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>
  if (!session) return <AppShell><div className="py-10 text-center text-gray-400">Session not found</div></AppShell>

  const activeStage = session.template.stages.find((s) => s.id === activeStageId) || null

  return (
    <AppShell>
      <div className="max-w-4xl space-y-6 pb-16">
        <div>
          <button onClick={() => router.push('/collection-sessions')} className="text-xs text-gray-400 hover:text-gray-600 mb-1">← Back</button>
          <h1 className="text-2xl font-bold text-gray-900">{session.template.name}</h1>
          <p className="text-gray-500 text-sm">{session.outlet.name} · {new Date(session.date).toDateString()} · <span className="font-semibold">{session.status}</span></p>
        </div>

        {activeStage ? (
          <div>
            <button onClick={() => setActiveStageId(null)} className="text-xs text-gray-400 hover:text-gray-600 mb-3">← Back to stages</button>
            {activeStage.entryMode === 'MULTI_STAFF_GRID' ? (
              <StageGridRenderer stage={activeStage} onSubmit={(rows) => submitGrid(activeStage.id, rows)} />
            ) : (
              <StageRenderer stage={activeStage} onSubmit={(payload) => submitStage(activeStage.id, payload)} />
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {session.template.stages.map((stage) => {
              const records = session.stageRecords.filter((r) => r.stageId === stage.id)
              const progress = stageProgress.get(stage.id)
              const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
              return (
                <div key={stage.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-gray-800">{stage.label}</h3>
                    <button onClick={() => setActiveStageId(stage.id)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">
                      {stage.entryMode === 'MULTI_STAFF_GRID' ? 'Open Grid' : '+ New Entry'}
                    </button>
                  </div>
                  {progress && (
                    <div className="mb-2">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[11px] text-gray-400 mt-1">{progress.done} / {progress.total} staff</p>
                    </div>
                  )}
                  {records.length === 0 ? (
                    <p className="text-xs text-gray-400">No entries yet</p>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {records.map((r) => (
                        <div key={r.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span className="text-gray-700">{r.staffName || '—'}</span>
                          <span className={`text-xs font-semibold ${r.status === 'PENDING_APPROVAL' ? 'text-amber-600' : r.status === 'REJECTED' ? 'text-red-600' : 'text-emerald-600'}`}>{r.status}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
