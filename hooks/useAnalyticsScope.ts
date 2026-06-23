'use client'
import { useCallback, useEffect, useState } from 'react'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subDays } from 'date-fns'

// Shared, persistent analytics filters (period + outlet) used by the Analytics
// hub and carried into each report via the URL query string. Stored in
// localStorage so the scope survives navigation and reloads.

export type Preset = 'today' | 'week' | 'month' | 'quarter' | '30d' | 'custom'
export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'This Quarter' }, { key: '30d', label: 'Last 30 Days' }, { key: 'custom', label: 'Custom' },
]

interface Stored { preset: Preset; customFrom: string; customTo: string; outletId: string }
const KEY = 'tips.analyticsScope'
const todayStr = () => format(new Date(), 'yyyy-MM-dd')

function resolveRange(preset: Preset, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date()
  switch (preset) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) }
    case 'week': return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'month': return { from: startOfMonth(now), to: endOfMonth(now) }
    case 'quarter': return { from: startOfQuarter(now), to: endOfQuarter(now) }
    case '30d': return { from: subDays(now, 29), to: now }
    case 'custom': return { from: startOfDay(new Date(customFrom)), to: endOfDay(new Date(customTo)) }
  }
}

export function useAnalyticsScope() {
  const [state, setState] = useState<Stored>(() => {
    if (typeof window !== 'undefined') {
      try { const raw = window.localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Stored } catch { /* ignore */ }
    }
    return { preset: 'month', customFrom: format(subDays(new Date(), 29), 'yyyy-MM-dd'), customTo: todayStr(), outletId: '' }
  })

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state])

  const { from, to } = resolveRange(state.preset, state.customFrom, state.customTo)
  const fromStr = format(from, 'yyyy-MM-dd')
  const toStr = format(to, 'yyyy-MM-dd')

  const setPreset = useCallback((preset: Preset) => setState((s) => ({ ...s, preset })), [])
  const setCustom = useCallback((customFrom: string, customTo: string) => setState((s) => ({ ...s, preset: 'custom', customFrom, customTo })), [])
  const setOutlet = useCallback((outletId: string) => setState((s) => ({ ...s, outletId })), [])

  // Build a query string for a drill-down link, optionally with extras (e.g. grain).
  const query = useCallback((extra?: Record<string, string>) => {
    const qs = new URLSearchParams({ from: fromStr, to: toStr })
    if (state.outletId) qs.set('outletId', state.outletId)
    if (extra) for (const [k, v] of Object.entries(extra)) qs.set(k, v)
    return qs.toString()
  }, [fromStr, toStr, state.outletId])

  return { ...state, from, to, fromStr, toStr, setPreset, setCustom, setOutlet, query }
}
