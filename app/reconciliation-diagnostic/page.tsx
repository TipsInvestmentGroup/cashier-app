'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatDateTime } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

interface Finding {
  code: string
  issue: string
  rootCause: string
  affectedModules: string[]
  recommendedFix: string
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'OK'
  count: number
  sample?: string[]
}

const SEV_STYLE: Record<Finding['severity'], string> = {
  CRITICAL: 'bg-red-100 text-red-800 border-red-300',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-300',
  LOW: 'bg-slate-100 text-slate-700 border-slate-300',
  OK: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}
const SEV_ORDER: Finding['severity'][] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OK']

export default function ReconciliationDiagnosticPage() {
  const { request } = useApi()
  const [findings, setFindings] = useState<Finding[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await request('/api/reconciliation-diagnostic')
      const sorted = (r.findings || []).sort(
        (a: Finding, b: Finding) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
      )
      setFindings(sorted)
      setGeneratedAt(r.generatedAt || null)
    } catch { /* surfaced by interceptor */ } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reconciliation Self-Diagnostic</h1>
          <p className="text-sm text-gray-500">
            Live, read-only checks of the Excess/Reconciliation accounting model — classification, GL integration, and cash consistency.
            {generatedAt && <> · Generated {formatDateTime(generatedAt)}</>}
          </p>
        </div>
        <button onClick={load} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Re-run
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : (
        <div className="space-y-3">
          {findings.map((f) => (
            <Card key={f.code} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-xs font-bold ${SEV_STYLE[f.severity]}`}>{f.severity}</span>
                  {f.count > 0 && <span className="text-xs text-gray-400">×{f.count}</span>}
                </div>
                <span className="text-[10px] font-mono text-gray-300">{f.code}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{f.issue}</p>
              {f.severity !== 'OK' && (
                <dl className="mt-2 space-y-1 text-xs text-gray-600">
                  <div><dt className="inline font-semibold">Root cause: </dt><dd className="inline">{f.rootCause}</dd></div>
                  <div><dt className="inline font-semibold">Affected: </dt><dd className="inline">{f.affectedModules.join(', ') || '—'}</dd></div>
                  <div><dt className="inline font-semibold">Recommended fix: </dt><dd className="inline">{f.recommendedFix}</dd></div>
                  {f.sample?.length ? (
                    <div className="mt-1 rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-500">
                      {f.sample.map((s, i) => <div key={i}>{s}</div>)}
                    </div>
                  ) : null}
                </dl>
              )}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  )
}
