'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

// Kept as a runtime array because the rounding <select> maps over it; the other
// policy enums render human-labelled options, so they're plain union types.
const ROUNDING_POLICIES = ['NONE', 'NEAREST_0_01', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10'] as const
type ExchangeRatePolicy = 'RUN_DATE' | 'PERIOD_END' | 'MANUAL'
type NegativeNetPolicy = 'BLOCK' | 'CARRY_FORWARD' | 'CAP'
type PayVisibility = 'SUMMARY' | 'FULL' | 'MASKED'

interface Terminology { module: string; employee: string; payslip: string; run: string; earning: string; deduction: string }
interface Config {
  moduleName: string
  enabled: boolean
  defaultCurrency: string
  exchangeRatePolicy: ExchangeRatePolicy
  approvalRequiredDefault: boolean
  roundingPolicy: (typeof ROUNDING_POLICIES)[number]
  negativeNetPolicy: NegativeNetPolicy
  payElementVisibilityDefault: PayVisibility
  terminology: Terminology
}

const inputCls = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white w-full'

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">{children}</div>
}
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2 cursor-pointer">
      <span><span className="text-sm font-medium text-gray-800">{label}</span>{hint && <span className="block text-xs text-gray-400">{hint}</span>}</span>
      <button type="button" onClick={() => onChange(!checked)}
        className={`shrink-0 w-11 h-6 rounded-full transition relative ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  )
}

export default function PayrollSettingsPage() {
  const { request } = useApi()
  const [cfg, setCfg] = useState<Config | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { setCfg(await request('/api/payroll/config')) }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not load') }
  }, [request])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!cfg) return
    setSaving(true)
    try {
      const saved = await request('/api/payroll/config', { method: 'PUT', body: JSON.stringify(cfg) })
      setCfg(saved); toast.success('Saved')
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSaving(false) }
  }

  const set = (patch: Partial<Config>) => cfg && setCfg({ ...cfg, ...patch })
  const setTerm = (k: keyof Terminology, v: string) => cfg && setCfg({ ...cfg, terminology: { ...cfg.terminology, [k]: v } })

  return (
    <AppShell>
      <SetupTabs />
      <div className="max-w-5xl space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payroll Settings</h1>
            <p className="text-gray-500 text-sm">Configure the payroll module — whether it&apos;s on, what it&apos;s called, and how runs round, convert and handle edge cases. Everything here is configuration; nothing is hardcoded. The module ships <span className="font-medium">disabled</span> — turning it on is what activates pay runs.</p>
          </div>
          {cfg && (
            <span className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold ${cfg.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {cfg.enabled ? '● Enabled' : '○ Disabled'}
            </span>
          )}
        </div>

        {!cfg ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
          <div className="space-y-5">
            <Card>
              <h2 className="font-semibold text-gray-800 mb-3">Identity</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs text-gray-500">Module name</span>
                  <input className={inputCls} value={cfg.moduleName} onChange={(e) => set({ moduleName: e.target.value })} /></label>
                <label className="block"><span className="text-xs text-gray-500">Default currency</span>
                  <input className={inputCls} value={cfg.defaultCurrency} onChange={(e) => set({ defaultCurrency: e.target.value })} /></label>
              </div>
              <Toggle label="Module enabled" hint="Off = today's behaviour (deduction report only, nobody paid). On = pay runs can be created, calculated and posted to the ledger." checked={cfg.enabled} onChange={(v) => set({ enabled: v })} />
            </Card>

            <Card>
              <h2 className="font-semibold text-gray-800 mb-1">Calculation policy</h2>
              <p className="text-xs text-gray-400 mb-3">Defaults for every run. Individual pay groups and components can override where it matters.</p>
              <div className="grid sm:grid-cols-2 gap-3 mb-1">
                <label className="block"><span className="text-xs text-gray-500">Rounding</span>
                  <select className={inputCls} value={cfg.roundingPolicy} onChange={(e) => set({ roundingPolicy: e.target.value as Config['roundingPolicy'] })}>
                    {ROUNDING_POLICIES.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ').toLowerCase()}</option>)}
                  </select></label>
                <label className="block"><span className="text-xs text-gray-500">Exchange rate basis</span>
                  <select className={inputCls} value={cfg.exchangeRatePolicy} onChange={(e) => set({ exchangeRatePolicy: e.target.value as Config['exchangeRatePolicy'] })}>
                    <option value="RUN_DATE">Run date</option>
                    <option value="PERIOD_END">Period end</option>
                    <option value="MANUAL">Manual</option>
                  </select></label>
                <label className="block"><span className="text-xs text-gray-500">When net pay goes negative</span>
                  <select className={inputCls} value={cfg.negativeNetPolicy} onChange={(e) => set({ negativeNetPolicy: e.target.value as Config['negativeNetPolicy'] })}>
                    <option value="CARRY_FORWARD">Carry the shortfall forward</option>
                    <option value="BLOCK">Block — the run won&apos;t calculate</option>
                    <option value="CAP">Cap deductions at net zero</option>
                  </select></label>
                <label className="block"><span className="text-xs text-gray-500">Payslip visibility default</span>
                  <select className={inputCls} value={cfg.payElementVisibilityDefault} onChange={(e) => set({ payElementVisibilityDefault: e.target.value as Config['payElementVisibilityDefault'] })}>
                    <option value="SUMMARY">Summary — totals only</option>
                    <option value="FULL">Full — every line</option>
                    <option value="MASKED">Masked — amounts hidden</option>
                  </select></label>
              </div>
              <Toggle label="Approval required by default" hint="New pay runs need sign-off before they can be posted, unless a pay group says otherwise." checked={cfg.approvalRequiredDefault} onChange={(v) => set({ approvalRequiredDefault: v })} />
            </Card>

            <Card>
              <h2 className="font-semibold text-gray-800 mb-1">Terminology</h2>
              <p className="text-xs text-gray-400 mb-3">Rename the concepts to match how this business speaks (labels only — no data changes).</p>
              <div className="grid sm:grid-cols-3 gap-3">
                {(['module', 'employee', 'payslip', 'run', 'earning', 'deduction'] as const).map((k) => (
                  <label key={k} className="block"><span className="text-xs text-gray-500 capitalize">{k}</span>
                    <input className={inputCls} value={cfg.terminology[k]} onChange={(e) => setTerm(k, e.target.value)} /></label>
                ))}
              </div>
            </Card>

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <Link href="/payroll/employees" className="text-sm font-semibold text-indigo-600 hover:text-indigo-800">Manage employees →</Link>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
