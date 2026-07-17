'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

interface Approval {
  id: string
  approverRole: string
  comment: string | null
  createdAt: string
  requestedBy: { name: string }
  stageRecord: {
    id: string
    staffName: string | null
    stage: { label: string }
    session: { id: string; outlet: { name: string }; template: { name: string } }
  }
}

export default function CollectionApprovalsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [deciding, setDeciding] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems((await request('/api/collection-approvals')) || []) } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const decide = async (id: string, decision: 'APPROVED' | 'REJECTED') => {
    setDeciding(id)
    try {
      await request(`/api/collection-approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) })
      toast.success(decision === 'APPROVED' ? 'Approved' : 'Rejected')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save decision')
    } finally { setDeciding(null) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Collection Approvals</h1>
          <p className="text-gray-500 text-sm">Requests waiting on sign-off before a collection stage counts as complete.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : items.length === 0 ? (
            <p className="py-6 text-center text-gray-400 text-sm">No pending approvals</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {items.map((a) => (
                <div key={a.id} className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{a.stageRecord.session.template.name} · {a.stageRecord.stage.label}</p>
                      <p className="text-xs text-gray-400">{a.stageRecord.session.outlet.name} · {a.stageRecord.staffName || '—'} · requested by {a.requestedBy.name}</p>
                    </div>
                    <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[11px] font-semibold rounded-full">{a.approverRole}</span>
                  </div>
                  {a.comment && <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-2.5 py-1.5">{a.comment}</p>}
                  <div className="flex gap-2">
                    <button disabled={deciding === a.id} onClick={() => decide(a.id, 'APPROVED')}
                      className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-lg hover:bg-emerald-100 disabled:opacity-50">Approve</button>
                    <button disabled={deciding === a.id} onClick={() => decide(a.id, 'REJECTED')}
                      className="px-3 py-1.5 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-50">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
