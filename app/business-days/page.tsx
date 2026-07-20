'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import Link from 'next/link'

interface MissingItem { type: string; label: string; shift?: string; counter?: string }
interface BusinessDay {
  id: string
  date: string
  outlet: { id: string; name: string }
  status: string
  isComplete: boolean
  missingItems: MissingItem[]
  closedByName?: string
  reopenedByName?: string
  reopenReason?: string
  lockExpiresAt?: string
}
interface Outlet { id: string; name: string }

const STATUSES = ['OPEN', 'CLOSED', 'REOPENED', 'ARCHIVED']

export default function BusinessDaysPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [days, setDays] = useState<BusinessDay[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (outletId) qs.set('outletId', outletId)
      if (status) qs.set('status', status)
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const r = await request(`/api/business-days?${qs}`)
      setDays(r.businessDays || [])
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request, outletId, status, from, to])

  useEffect(() => { request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {}) }, [request])
  useEffect(() => { load() }, [load])

  const isMgmt = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'].includes(user?.role || '')

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Day Dashboard</h1>
          <p className="text-gray-500 text-sm">Status, completeness, and responsibility for every outlet&apos;s business day</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {isMgmt && (
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">All outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>

        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : days.length === 0 ? (
            <EmptyState icon="📅" title="No business days found" hint="Adjust the filters, or check back once a day has been closed." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                    <th className="px-4 py-3 font-semibold">Missing Item</th>
                    <th className="px-4 py-3 font-semibold">Responsible User</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {days.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Link href={`/business-day-management?id=${d.id}`} className="text-indigo-600 hover:underline">{formatDate(d.date)}</Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{d.outlet.name}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[360px]">
                        {d.missingItems.length === 0 ? '—' : (
                          <div className="flex flex-wrap gap-1">
                            {d.missingItems.map((m, i) => (
                              <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 text-[11px] rounded-full" title={m.shift ? `Shift ${m.shift}` : undefined}>
                                {m.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{d.reopenedByName || d.closedByName || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge status={d.isComplete ? d.status : 'PENDING'}>{d.isComplete ? d.status : `${d.status} · INCOMPLETE`}</Badge>
                      </td>
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
