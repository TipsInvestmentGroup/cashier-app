'use client'
import { useState } from 'react'
import { format } from 'date-fns'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import type { TrendWidgetDef, TrendDay } from './types'

interface DayDetail {
  hourly: { hour: number; label: string; orders: number; revenue: number }[]
  topStaff: { staffName: string; officialCollection: number }[]
  paymentSplit: { cash: number; bank: number; mobileMoney: number }
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
