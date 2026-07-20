'use client'
import { useState } from 'react'
import { format } from 'date-fns'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDateTime, formatAuditDetails } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import type { TrendWidgetDef, TrendDay } from './types'

interface SourceRecord {
  id: string
  staffName: string | null
  total: number
  outletName: string
  cashierName: string
  createdAt: string
  updatedAt: string
}
interface AuditEntry { id: string; createdAt: string; action: string; details?: string; user: string; role: string }
interface DayDetail {
  hourly: { hour: number; label: string; orders: number; revenue: number }[]
  topStaff: { staffName: string; officialCollection: number }[]
  paymentSplit: { cash: number; bank: number; mobileMoney: number }
  sourceRecords: SourceRecord[]
}

const INSIGHT_STATUS_CLASS: Record<'good' | 'bad' | 'neutral', string> = {
  good: 'text-green-600', bad: 'text-red-600', neutral: 'text-gray-400',
}

/**
 * Three-level progressive disclosure: collapsed total → click to see the
 * period's daily rows → click a day to lazy-load its hourly order pattern,
 * top staff, and payment split (see app/api/dashboard/day-detail/route.ts).
 */
export function TrendWidget<T>({ def, data }: { def: TrendWidgetDef<T>; data: T }) {
  const { request } = useApi()
  const [open, setOpen] = useState(false)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, DayDetail | 'loading' | 'error'>>({})
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)
  const [auditHistory, setAuditHistory] = useState<Record<string, AuditEntry[] | 'loading' | 'error'>>({})

  const total = def.getTotal(data)
  const insight = def.getInsight?.(data)
  const series = def.getSeries(data)

  const toggleDay = async (day: TrendDay) => {
    const next = openDay === day.date ? null : day.date
    setOpenDay(next)
    if (next && !details[day.date]) {
      setDetails((d) => ({ ...d, [day.date]: 'loading' }))
      try {
        const result = await request(def.dayDetailUrl(day))
        setDetails((d) => ({ ...d, [day.date]: result }))
      } catch {
        setDetails((d) => ({ ...d, [day.date]: 'error' }))
      }
    }
  }

  const toggleRecord = async (recordId: string) => {
    const next = openRecordId === recordId ? null : recordId
    setOpenRecordId(next)
    if (next && !auditHistory[recordId]) {
      setAuditHistory((h) => ({ ...h, [recordId]: 'loading' }))
      try {
        const result = await request(`/api/audit-log?entity=DailyCollection&entityId=${recordId}`)
        setAuditHistory((h) => ({ ...h, [recordId]: result.logs || [] }))
      } catch {
        setAuditHistory((h) => ({ ...h, [recordId]: 'error' }))
      }
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-5 hover:bg-gray-50/60 transition">
        <p className="text-sm font-medium text-gray-500">{def.label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-3 tracking-tight">{formatCurrency(total)}</p>
        <div className="flex items-center justify-between mt-1 min-h-[16px]">
          {insight && <p className={`text-xs font-medium ${INSIGHT_STATUS_CLASS[insight.status]}`}>{insight.text}</p>}
          <span className="text-xs font-semibold text-indigo-600 ml-auto">{open ? 'Hide daily breakdown' : 'View daily breakdown →'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {series.map((day) => {
            const detail = details[day.date]
            const isOpen = openDay === day.date
            return (
              <div key={day.date}>
                <button onClick={() => toggleDay(day)} className="w-full flex items-center justify-between px-5 py-2.5 text-sm hover:bg-gray-50/60 transition">
                  <span className="font-medium text-gray-700">{format(new Date(day.date), 'EEE dd MMM')}</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(day.total)}</span>
                </button>
                {isOpen && (
                  <div className="px-5 pb-4 bg-gray-50/60">
                    {detail === 'loading' && <p className="text-xs text-gray-400 py-3">Loading…</p>}
                    {detail === 'error' && <p className="text-xs text-red-500 py-3">Couldn&apos;t load details for this day.</p>}
                    {detail && detail !== 'loading' && detail !== 'error' && (
                      <div className="space-y-4 pt-2">
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Time Analysis</p>
                          <div className="flex items-end gap-0.5 h-12">
                            {detail.hourly.map((h) => {
                              const max = Math.max(1, ...detail.hourly.map((x) => x.orders))
                              return (
                                <div key={h.hour} title={`${h.label} — ${h.orders} order(s), ${formatCurrency(h.revenue)}`}
                                  className="flex-1 bg-indigo-400 rounded-t" style={{ height: `${Math.max(4, (h.orders / max) * 100)}%` }} />
                              )
                            })}
                          </div>
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                            <span>00:00</span><span>12:00</span><span>23:00</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Top Staff</p>
                          {detail.topStaff.length === 0 ? <p className="text-xs text-gray-400">No staff activity this day</p> : (
                            <div className="space-y-1">
                              {detail.topStaff.map((s) => (
                                <div key={s.staffName} className="flex items-center justify-between text-xs">
                                  <span className="text-gray-700">{s.staffName}</span>
                                  <span className="font-semibold text-gray-900">{formatCurrency(s.officialCollection)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Payment Distribution</p>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-white rounded-lg px-2.5 py-1.5"><p className="text-gray-400">Cash</p><p className="font-semibold text-gray-800">{formatCurrency(detail.paymentSplit.cash)}</p></div>
                            <div className="bg-white rounded-lg px-2.5 py-1.5"><p className="text-gray-400">Bank</p><p className="font-semibold text-gray-800">{formatCurrency(detail.paymentSplit.bank)}</p></div>
                            <div className="bg-white rounded-lg px-2.5 py-1.5"><p className="text-gray-400">Mobile Money</p><p className="font-semibold text-gray-800">{formatCurrency(detail.paymentSplit.mobileMoney)}</p></div>
                          </div>
                        </div>
                        {/* Data-integrity drill-down: the exact source records behind this
                            day's total — click one to trace who created/edited/deleted it,
                            when, and why (immutable AuditLog trail). */}
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Source Records</p>
                          {detail.sourceRecords.length === 0 ? (
                            <p className="text-xs text-gray-400">No collection records for this day</p>
                          ) : (
                            <div className="space-y-1">
                              {detail.sourceRecords.map((r) => {
                                const history = auditHistory[r.id]
                                const isRecordOpen = openRecordId === r.id
                                return (
                                  <div key={r.id} className="bg-white rounded-lg overflow-hidden">
                                    <button onClick={() => toggleRecord(r.id)} className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs hover:bg-gray-50">
                                      <span className="text-gray-700">{r.staffName || 'No staff'} · {r.outletName} · by {r.cashierName}</span>
                                      <span className="font-semibold text-gray-900">{formatCurrency(r.total)}</span>
                                    </button>
                                    {isRecordOpen && (
                                      <div className="px-2.5 pb-2 border-t border-gray-100">
                                        <p className="text-[10px] text-gray-400 pt-1.5">Created {formatDateTime(r.createdAt)}{r.updatedAt !== r.createdAt ? ` · last updated ${formatDateTime(r.updatedAt)}` : ''}</p>
                                        {history === 'loading' && <p className="text-[10px] text-gray-400 pt-1">Loading audit trail…</p>}
                                        {history === 'error' && <p className="text-[10px] text-red-500 pt-1">Couldn&apos;t load audit trail.</p>}
                                        {history && history !== 'loading' && history !== 'error' && (
                                          <div className="space-y-1 pt-1">
                                            {history.length === 0 ? <p className="text-[10px] text-gray-400">No audit entries</p> : history.map((a) => (
                                              <div key={a.id} className="text-[10px] text-gray-500 flex gap-1.5">
                                                <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span>
                                                <Badge tone="indigo" className="!px-1.5 !py-0">{a.action}</Badge>
                                                <span className="truncate">{a.user} — {formatAuditDetails(a.details)}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
