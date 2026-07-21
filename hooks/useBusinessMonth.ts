'use client'
import { useEffect, useState } from 'react'
import { startOfDay, endOfDay } from 'date-fns'
import { useApi } from '@/hooks/useApi'
import type { BizMonthRange } from '@/lib/dateRange'

// Resolves the currently-configured Business Month window (Business Period
// engine) for use with the shared date-range filter. Returns the window as a
// { start, end } range ready to pass into getRangeInterval / inRange, plus a
// human label for the filter chip. Effective-dated + outlet-scoped resolution
// happens server-side in the periods snapshot; the outlet defaults to the
// signed-in user's outlet when none is given.
export function useBusinessMonth(outletId?: string): { range?: BizMonthRange; label?: string } {
  const { request } = useApi()
  const [state, setState] = useState<{ range?: BizMonthRange; label?: string }>({})

  useEffect(() => {
    let cancelled = false
    const qs = outletId ? `?outletId=${outletId}` : ''
    request(`/api/business-calendar/periods/snapshot${qs}`)
      .then((snap) => {
        if (cancelled || !snap?.businessMonth) return
        setState({
          range: {
            start: startOfDay(new Date(`${snap.businessMonth.startYMD}T00:00:00`)),
            end: endOfDay(new Date(`${snap.businessMonth.endYMD}T00:00:00`)),
          },
          label: snap.businessMonth.rangeLabel,
        })
      })
      .catch(() => { /* leaves range undefined → callers fall back to calendar month */ })
    return () => { cancelled = true }
  }, [outletId, request])

  return state
}
