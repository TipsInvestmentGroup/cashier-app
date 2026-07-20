'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader } from '@/components/ui/Card'
import { ReconciliationRoleAccessPanel } from '@/components/ReconciliationRoleAccessPanel'
import toast from 'react-hot-toast'

interface StageConfig {
  id: string
  scope: string
  scopeId: string | null
  stageKey: string
  isEnabled: boolean
  closeMode: string
  graceMinutes: number
  validationStrictness: string
  forceAutoClose: boolean
}
interface Requirement { id: string; scope: string; scopeId: string | null; stageKey: string; checkType: string; isRequired: boolean }
interface ReminderPolicy { id: string; scope: string; scopeId: string | null; stageKey: string | null; firstReminderMinutes: number; secondReminderMinutes: number; escalationAtEndOfWindow: boolean }

const STAGES: { key: string; label: string; hint: string; checkTypes?: string[] }[] = [
  { key: 'BUSINESS_DAY', label: 'Business Day', hint: 'Bills, Collections, Sales, Expenses, Inventory entry — locks when closed.' },
  { key: 'CASHIER_RECON', label: 'Cashier Reconciliation', hint: 'Cash in safe, Bank, Mobile Money, POS/Digital vs company balances.', checkTypes: ['CASH_RECON', 'BANK_RECON'] },
  { key: 'FINANCE_RECON', label: 'Finance Reconciliation', hint: 'Company-wide verification across all outlets, sponsor/direct payments.', checkTypes: ['PAYMENT_VERIFICATION'] },
  { key: 'FINANCIAL_CLOSE', label: 'Financial Close', hint: 'Optional — final period lock once Finance Recon has closed.' },
]
const CHECK_LABEL: Record<string, string> = { CASH_RECON: 'Cash Reconciliation', BANK_RECON: 'Bank/Digital Reconciliation', PAYMENT_VERIFICATION: 'Payment Verification' }

const DEFAULT_CONFIG: Omit<StageConfig, 'id' | 'scope' | 'scopeId' | 'stageKey'> = {
  isEnabled: false, closeMode: 'MANUAL', graceMinutes: 0, validationStrictness: 'BLOCK_ON_MISSING', forceAutoClose: false,
}

export default function ReconciliationSettingsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const isOwner = (user?.email || '').toLowerCase() === (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const [configs, setConfigs] = useState<StageConfig[]>([])
  const [requirements, setRequirements] = useState<Requirement[]>([])
  const [reminderPolicy, setReminderPolicyState] = useState<ReminderPolicy | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cfg, req_, rem] = await Promise.all([
        request('/api/reconciliation-stage-config'),
        request('/api/reconciliation-requirements'),
        request('/api/reconciliation-reminder-policy'),
      ])
      setConfigs(cfg.configs || [])
      setRequirements(req_.requirements || [])
      setReminderPolicyState((rem.policies || []).find((p: ReminderPolicy) => p.scope === 'GLOBAL' && !p.stageKey) || null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const configFor = (stageKey: string): StageConfig | (Omit<StageConfig, 'id'> & { id?: string }) =>
    configs.find((c) => c.scope === 'GLOBAL' && c.stageKey === stageKey) || { scope: 'GLOBAL', scopeId: null, stageKey, ...DEFAULT_CONFIG }

  const saveConfig = async (stageKey: string, patch: Partial<StageConfig>) => {
    setSaving(stageKey)
    try {
      const current = configFor(stageKey)
      await request('/api/reconciliation-stage-config', {
        method: 'POST',
        body: JSON.stringify({ ...current, ...patch }),
      })
      toast.success('Saved')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(null) }
  }

  const toggleRequirement = async (stageKey: string, checkType: string, isRequired: boolean) => {
    setSaving(`${stageKey}:${checkType}`)
    try {
      await request('/api/reconciliation-requirements', { method: 'POST', body: JSON.stringify({ scope: 'GLOBAL', stageKey, checkType, isRequired }) })
      toast.success('Saved')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(null) }
  }

  const saveReminderPolicy = async (patch: Partial<ReminderPolicy>) => {
    setSaving('reminder-policy')
    try {
      const base = reminderPolicy || { firstReminderMinutes: 30, secondReminderMinutes: 120, escalationAtEndOfWindow: true }
      await request('/api/reconciliation-reminder-policy', { method: 'POST', body: JSON.stringify({ scope: 'GLOBAL', ...base, ...patch }) })
      toast.success('Saved')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally { setSaving(null) }
  }

  const isRequired = (stageKey: string, checkType: string) => {
    const row = requirements.find((r) => r.scope === 'GLOBAL' && r.stageKey === stageKey && r.checkType === checkType)
    return row ? row.isRequired : true // defaults (seeded on first read) ship required=true
  }

  if (loading) return <AppShell><SectionTabs tabs={FINANCE_TABS} /><div className="py-10 text-center text-gray-400">Loading…</div></AppShell>

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation Settings</h1>
          <p className="text-gray-500 text-sm">Configure each stage independently — window, close mode, required checks, and escalation policy. Every company starts with only Business Day active; enable the rest as needed.</p>
        </div>

        {isOwner && <ReconciliationRoleAccessPanel />}

        {STAGES.map((stage) => {
          const cfg = configFor(stage.key)
          const busy = saving === stage.key
          return (
            <Card key={stage.key}>
              <CardHeader title={stage.label} subtitle={stage.hint} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input type="checkbox" checked={cfg.isEnabled} disabled={busy || stage.key === 'BUSINESS_DAY'}
                    onChange={(e) => saveConfig(stage.key, { isEnabled: e.target.checked })} className="w-4 h-4 rounded" />
                  Enabled {stage.key === 'BUSINESS_DAY' && <span className="text-xs text-gray-400">(always on)</span>}
                </label>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Close Mode</label>
                  <select value={cfg.closeMode} disabled={busy}
                    onChange={(e) => saveConfig(stage.key, { closeMode: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none">
                    <option value="MANUAL">Manual</option>
                    <option value="AUTO">Auto (notify + escalate; force-close only if enabled below)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Validation Strictness</label>
                  <select value={cfg.validationStrictness} disabled={busy}
                    onChange={(e) => saveConfig(stage.key, { validationStrictness: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-indigo-500 focus:outline-none">
                    <option value="BLOCK_ON_MISSING">Block close on missing checks</option>
                    <option value="WARN_ON_MISSING">Warn only</option>
                    <option value="ALLOW">Allow (no validation)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Grace Period (minutes)</label>
                  <input type="number" min={0} value={cfg.graceMinutes} disabled={busy}
                    onChange={(e) => saveConfig(stage.key, { graceMinutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                </div>

                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
                  <input type="checkbox" checked={cfg.forceAutoClose} disabled={busy}
                    onChange={(e) => saveConfig(stage.key, { forceAutoClose: e.target.checked })} className="w-4 h-4 rounded" />
                  Force Auto Close past the grace period <span className="text-xs text-gray-400">(default off — the stage only notifies + escalates, it never silently locks with unresolved discrepancies)</span>
                </label>
              </div>

              {stage.checkTypes && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Required checks before this stage can close</p>
                  <div className="flex flex-wrap gap-3">
                    {stage.checkTypes.map((ct) => (
                      <label key={ct} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={isRequired(stage.key, ct)} disabled={saving === `${stage.key}:${ct}`}
                          onChange={(e) => toggleRequirement(stage.key, ct, e.target.checked)} className="w-4 h-4 rounded" />
                        {CHECK_LABEL[ct] || ct}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )
        })}

        <Card>
          <CardHeader title="Reminder & Escalation Cadence" subtitle="Applies to every stage unless overridden per stage — company/outlet overrides can be added via the API." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">First reminder (minutes after opening)</label>
              <input type="number" min={1} value={reminderPolicy?.firstReminderMinutes ?? 30} disabled={saving === 'reminder-policy'}
                onChange={(e) => saveReminderPolicy({ firstReminderMinutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Second reminder / supervisor (minutes)</label>
              <input type="number" min={1} value={reminderPolicy?.secondReminderMinutes ?? 120} disabled={saving === 'reminder-policy'}
                onChange={(e) => saveReminderPolicy({ secondReminderMinutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
              <input type="checkbox" checked={reminderPolicy?.escalationAtEndOfWindow ?? true} disabled={saving === 'reminder-policy'}
                onChange={(e) => saveReminderPolicy({ escalationAtEndOfWindow: e.target.checked })} className="w-4 h-4 rounded" />
              Escalate to Finance/Admin at end of reconciliation window
            </label>
          </div>
        </Card>
      </div>
    </AppShell>
  )
}
