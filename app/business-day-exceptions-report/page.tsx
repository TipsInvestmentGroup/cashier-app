'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatDate, formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'

interface Exception {
  id: string; date: string; outlet: string; status: string
  reopenedByName?: string; reopenReason?: string; reopenedAt?: string; closedByName?: string
  unlockHistory: { id: string; reason: string; status: string; requestedBy: { name: string }; approver?: { name: string } }[]
  correctedRecords: { collections: number; cashRecon: number; bankRecon: number }
}
interface Outlet { id: string; name: string }

export default function BusinessDayExceptionsReportPage() {
  const { request } = useApi()
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [reasons, setReasons] = useState<string[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [status, setStatus] = useState('')
  const [reason, setReason] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      if (status) qs.set('status', status)
      if (reason) qs.set('reason', reason)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const r = await request(`/api/business-day-exceptions-report?${qs}`)
      setExceptions(r.exceptions || []); setReasons(r.reasons || [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [request, outletId, status, reason, from, to])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Day Exceptions Report</h1>
          <p className="text-gray-500 text-sm">Every reopened day, with its unlock history and corrected-record counts</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All statuses</option>
            <option value="REOPENED">REOPENED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All reasons</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : exceptions.length === 0 ? (
            <EmptyState icon="📋" title="No exceptions found" hint="Days that have been reopened will appear here." />
          ) : (
            <div className="divide-y divide-gray-50">
              {exceptions.map((e) => (
                <div key={e.id} className="p-4">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-medium text-gray-800">{formatDate(e.date)}</span>
                    <span className="text-sm text-gray-500">{e.outlet}</span>
                    <Badge status={e.status}>{e.status}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">Reopened by {e.reopenedByName} {e.reopenedAt && `at ${formatDateTime(e.reopenedAt)}`}{e.reopenReason ? ` — ${e.reopenReason}` : ''}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Corrected records since reopen: {e.correctedRecords.collections} collections, {e.correctedRecords.cashRecon} cash recon, {e.correctedRecords.bankRecon} bank recon
                  </p>
                  {e.unlockHistory.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {e.unlockHistory.map((u) => (
                        <div key={u.id} className="text-xs text-gray-500 flex items-center gap-2">
                          <Badge status={u.status}>{u.status}</Badge>
                          <span>{u.requestedBy.name}: {u.reason}{u.approver ? ` (decided by ${u.approver.name})` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
