'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'

interface Log { id: string; createdAt: string; action: string; entity: string; entityId?: string; details?: string; user: string; role: string }

// Map an action to a badge tone.
function tone(action: string): 'green' | 'red' | 'amber' | 'indigo' | 'gray' {
  if (/CREATE|APPROVE|CLOSE/.test(action)) return 'green'
  if (/DELETE|REJECT/.test(action)) return 'red'
  if (/UPDATE|REOPEN/.test(action)) return 'amber'
  return 'indigo'
}

export default function AuditLogPage() {
  const { request } = useApi()
  const [logs, setLogs] = useState<Log[]>([])
  const [entities, setEntities] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (entity) qs.set('entity', entity)
      if (action) qs.set('action', action)
      const r = await request(`/api/audit-log?${qs}`)
      setLogs(r.logs || []); setEntities(r.entities || []); setActions(r.actions || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, entity, action])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = logs.filter((l) => !q || `${l.user} ${l.entity} ${l.action} ${l.details || ''}`.toLowerCase().includes(q))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-gray-500 text-sm">Who did what, and when — the 300 most recent actions</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select value={entity} onChange={(e) => setEntity(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All entities</option>
            {entities.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user / details…"
            className="flex-1 min-w-[180px] px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="🛡️" title="No audit entries" hint="Actions like create, edit, approve and close will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">When</th>
                    <th className="px-4 py-3 font-semibold">User</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Entity</th>
                    <th className="px-4 py-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((l) => (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDateTime(l.createdAt)}</td>
                      <td className="px-4 py-3"><span className="font-medium text-gray-800">{l.user}</span>{l.role && <span className="text-xs text-gray-400 ml-1">· {l.role}</span>}</td>
                      <td className="px-4 py-3"><Badge tone={tone(l.action)}>{l.action}</Badge></td>
                      <td className="px-4 py-3 text-gray-500">{l.entity}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[420px] truncate" title={l.details || ''}>{l.details || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
