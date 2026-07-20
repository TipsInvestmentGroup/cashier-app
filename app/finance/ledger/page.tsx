'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import toast from 'react-hot-toast'

interface Line { id: string; debit: number; credit: number; description: string | null; account: { code: string; name: string } }
interface Entry {
  id: string; entryNumber: string; entryDate: string; sourceModule: string; sourceType: string | null
  description: string | null; status: string; lines: Line[]
}
interface Period { id: string; name: string; startDate: string; endDate: string; status: string; periodType: string }

const PERIOD_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const

export default function GeneralLedgerPage() {
  const { request } = useApi()
  const [entries, setEntries] = useState<Entry[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newPeriodName, setNewPeriodName] = useState('')
  const [newPeriodType, setNewPeriodType] = useState<typeof PERIOD_TYPES[number]>('MONTHLY')
  const [newPeriodStart, setNewPeriodStart] = useState('')
  const [newPeriodEnd, setNewPeriodEnd] = useState('')
  const [yearStartDate, setYearStartDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [e, p] = await Promise.all([request('/api/finance/journal-entries'), request('/api/finance/periods')])
      setEntries(e || []); setPeriods(p || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const reverse = async (id: string) => {
    if (!confirm('Reverse this journal entry?')) return
    try { await request(`/api/finance/journal-entries/${id}/reverse`, { method: 'POST', body: JSON.stringify({}) }); toast.success('Entry reversed'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not reverse') }
  }

  const togglePeriod = async (p: Period) => {
    const reopening = p.status === 'LOCKED'
    const reason = reopening ? window.prompt('Reason for reopening this period? (required for authorization)') : null
    if (reopening && !reason?.trim()) return
    try {
      await request('/api/finance/periods', { method: 'POST', body: JSON.stringify({ id: p.id, status: reopening ? 'OPEN' : 'LOCKED', reason: reason || undefined }) })
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not update period') }
  }

  const addPeriod = async () => {
    if (!newPeriodName.trim() || !newPeriodStart || !newPeriodEnd) return toast.error('Name, start and end date are required')
    try {
      await request('/api/finance/periods', { method: 'POST', body: JSON.stringify({ name: newPeriodName.trim(), periodType: newPeriodType, startDate: newPeriodStart, endDate: newPeriodEnd }) })
      toast.success('Period created'); setNewPeriodName(''); setNewPeriodStart(''); setNewPeriodEnd(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not create period') }
  }

  const generateFinancialYear = async () => {
    if (!yearStartDate) return toast.error('Pick the financial year start date')
    try {
      const result = await request('/api/finance/periods/generate-year', { method: 'POST', body: JSON.stringify({ yearStartDate }) })
      toast.success(`Financial year generated: ${result.created} created, ${result.skipped} already existed`); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not generate the financial year') }
  }

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">General Ledger</h1>
          <p className="text-gray-500 text-sm">Every posted journal entry, system-generated from Procurement, Inventory and Collections</p>
        </div>

        <Card>
          <CardHeader title="Financial periods" subtitle="Locking a period blocks any further posting into it — periods can nest (a month inside its quarter and year)" />
          <div className="flex flex-wrap gap-2 mb-3">
            <input value={newPeriodName} onChange={(e) => setNewPeriodName(e.target.value)} placeholder="Name (e.g. 2026-07)"
              className="w-40 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={newPeriodType} onChange={(e) => setNewPeriodType(e.target.value as typeof newPeriodType)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              {PERIOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date" value={newPeriodStart} onChange={(e) => setNewPeriodStart(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <input type="date" value={newPeriodEnd} onChange={(e) => setNewPeriodEnd(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <button onClick={addPeriod} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add Period</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-gray-50 rounded-xl">
            <span className="text-xs text-gray-500">Financial Year Management:</span>
            <input type="date" value={yearStartDate} onChange={(e) => setYearStartDate(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none" />
            <button onClick={generateFinancialYear} className="px-4 py-2 bg-gray-800 text-white text-sm font-semibold rounded-xl hover:bg-gray-900">
              Generate Full Year (Annual + Quarters + Months)
            </button>
          </div>
          {periods.length === 0 ? <p className="text-sm text-gray-400">No periods configured — posting is unrestricted (treated as always open).</p> : (
            <div className="divide-y divide-gray-50">
              {periods.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2">
                  <Badge tone="gray">{p.periodType}</Badge>
                  <span className="flex-1 text-sm text-gray-800 font-medium">{p.name}</span>
                  <span className="text-xs text-gray-400">{formatDate(p.startDate)} – {formatDate(p.endDate)}</span>
                  <Badge tone={p.status === 'OPEN' ? 'green' : 'red'}>{p.status}</Badge>
                  <button onClick={() => togglePeriod(p)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">
                    {p.status === 'OPEN' ? 'Lock' : 'Reopen'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Journal entries" />
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : entries.length === 0 ? (
            <EmptyState icon="📖" title="No journal entries yet" hint="Entries post automatically from GRNs, supplier invoices/payments, and daily collections" />
          ) : (
            <div className="divide-y divide-gray-50">
              {entries.map((e) => (
                <div key={e.id} className="py-2.5">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                    <span className="font-mono text-xs text-gray-400 w-24">{e.entryNumber}</span>
                    <span className="text-xs text-gray-400 w-24">{formatDate(e.entryDate)}</span>
                    <span className="flex-1 text-sm text-gray-800">{e.description}</span>
                    <Badge tone={e.status === 'POSTED' ? 'green' : 'gray'}>{e.status}</Badge>
                    {e.status === 'POSTED' && (
                      <button onClick={(ev) => { ev.stopPropagation(); reverse(e.id) }} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Reverse</button>
                    )}
                  </div>
                  {expanded === e.id && (
                    <div className="mt-2 ml-24 bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                      {e.lines.map((l) => (
                        <div key={l.id} className="flex gap-3">
                          <span className="w-40 text-gray-600">{l.account.code} {l.account.name}</span>
                          <span className="w-24 text-right text-gray-800">{l.debit > 0 ? formatCurrency(l.debit) : ''}</span>
                          <span className="w-24 text-right text-gray-800">{l.credit > 0 ? formatCurrency(l.credit) : ''}</span>
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
