'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Upload, ChevronRight } from 'lucide-react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { SystemSalesUploadModal } from '@/components/SystemSalesUploadModal'
import toast from 'react-hot-toast'

interface TxSession {
  id: string; date: string; status: string
  outlet: { name: string }
  _count: { systemSales: number; transactions: number }
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-indigo-50 text-indigo-700',
  VALIDATED: 'bg-emerald-50 text-emerald-700',
  CLOSED: 'bg-gray-100 text-gray-600',
}

export default function TransactionSessionsPage() {
  const { request } = useApi()
  const [sessions, setSessions] = useState<TxSession[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadFor, setUploadFor] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setSessions((await request('/api/transaction-sessions')) || []) } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const openToday = async () => {
    setOpening(true)
    try {
      const s = await request('/api/transaction-sessions', { method: 'POST', body: JSON.stringify({ date: format(new Date(), 'yyyy-MM-dd') }) })
      toast.success('Session opened for today')
      setUploadFor(s.id)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not open session')
    } finally { setOpening(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Transaction Sessions</h1>
            <p className="text-gray-500 text-sm">Import System Sales to open a day — staff declare their own transactions, you just validate.</p>
          </div>
          <Button onClick={openToday} disabled={opening}><Upload className="w-4 h-4" /> Open Today</Button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : sessions.length === 0 ? (
            <p className="py-6 text-center text-gray-400 text-sm">No sessions yet — click &quot;Open Today&quot; to start.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {sessions.map((s) => (
                <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                  <Link href={`/transaction-sessions/${s.id}`} className="flex-1 flex items-center justify-between gap-3 group">
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{format(new Date(s.date), 'EEE, dd MMM yyyy')} · {s.outlet.name}</p>
                      <p className="text-xs text-gray-400">{s._count.systemSales} staff imported · {s._count.transactions} transactions declared</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${STATUS_STYLE[s.status] || ''}`}>{s.status}</span>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500" />
                    </div>
                  </Link>
                  {s.status === 'OPEN' && (
                    <button onClick={() => setUploadFor(s.id)} className="px-2.5 py-1.5 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100 whitespace-nowrap">
                      Import Sales
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {uploadFor && (
        <SystemSalesUploadModal open={!!uploadFor} onClose={() => setUploadFor(null)} sessionId={uploadFor} onUploaded={load} />
      )}
    </AppShell>
  )
}
