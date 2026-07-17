'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { useCompanyConfig } from '@/contexts/CompanyConfigContext'
import { DEFAULT_COMPANY_CONFIG, type CompanyConfig } from '@/lib/company-config-shared'
import { DEFAULT_FLOOR_POSITIONS } from '@/lib/floor-positions'
import toast from 'react-hot-toast'

/**
 * Admin-only company preferences: branding, currency and VAT. Everything here
 * used to be hard-coded — the defaults shown are exactly the old values, so
 * saving without changes is a no-op.
 */
export default function CompanyPreferencesPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const { reload } = useCompanyConfig()
  const isAdmin = user?.role === 'ADMIN'

  const [form, setForm] = useState<CompanyConfig>(DEFAULT_COMPANY_CONFIG)
  const [vatPct, setVatPct] = useState(String(DEFAULT_COMPANY_CONFIG.vatRate * 100))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [positions, setPositions] = useState<string[]>(DEFAULT_FLOOR_POSITIONS)
  const [newPosition, setNewPosition] = useState('')
  const [savingPositions, setSavingPositions] = useState(false)

  useEffect(() => {
    request('/api/company-config')
      .then((cfg) => { if (cfg) { setForm(cfg); setVatPct(String(Math.round((cfg.vatRate || 0) * 10000) / 100)) } })
      .finally(() => setLoading(false))
    request('/api/floor-positions').then((p) => { if (Array.isArray(p) && p.length) setPositions(p) }).catch(() => {})
  }, [request])

  const savePositions = async (next: string[]) => {
    setPositions(next)
    setSavingPositions(true)
    try { await request('/api/floor-positions', { method: 'PUT', body: JSON.stringify({ positions: next }) }) }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save floor positions') }
    finally { setSavingPositions(false) }
  }
  const addPosition = () => {
    const v = newPosition.trim().toUpperCase()
    if (!v || positions.includes(v)) return
    savePositions([...positions, v]); setNewPosition('')
  }
  const removePosition = (p: string) => savePositions(positions.filter((x) => x !== p))
  const movePosition = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= positions.length) return
    const next = [...positions]; [next[i], next[j]] = [next[j], next[i]]
    savePositions(next)
  }

  const set = (k: keyof CompanyConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const vat = Number(vatPct)
    if (!Number.isFinite(vat) || vat < 0 || vat >= 100) return toast.error('VAT must be between 0 and 99.99%')
    setSaving(true)
    try {
      const next = await request('/api/company-config', {
        method: 'PUT',
        body: JSON.stringify({ ...form, vatRate: vat / 100 }),
      })
      setForm(next)
      reload() // refresh the app-wide provider so branding/currency update live
      toast.success('Company preferences saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save preferences')
    } finally { setSaving(false) }
  }

  const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
  const inputCls = 'w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm'

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Company Preferences</h1>
          <p className="text-gray-500 text-sm">Branding, currency and tax settings used across the whole system</p>
        </div>

        {!isAdmin ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            👁️ View only. Only an Admin can change company preferences.
          </div>
        ) : null}

        {loading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : (
          <form onSubmit={save} className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
              <h2 className="font-semibold text-gray-800">🏢 Branding</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Company name" hint="Used on letterheads and reports">
                  <input value={form.companyName} onChange={set('companyName')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="App name" hint="The title shown in the sidebar">
                  <input value={form.appName} onChange={set('appName')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Logo URL" hint="A /public path (e.g. /tips-logo.png) or full image URL">
                  <input value={form.logoUrl} onChange={set('logoUrl')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Letterhead logo text" hint="Short word drawn on PDF letter headers">
                  <input value={form.logoText} onChange={set('logoText')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Letterhead banner" hint="Right-hand text on warning/reward letter PDFs">
                    <input value={form.letterheadTitle} onChange={set('letterheadTitle')} disabled={!isAdmin} className={inputCls} />
                  </Field>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
              <h2 className="font-semibold text-gray-800">💰 Currency &amp; Tax</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Currency code" hint="ISO 4217 code, e.g. TZS, KES, USD">
                  <input value={form.currencyCode} onChange={set('currencyCode')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Currency locale" hint="Number formatting locale, e.g. en-TZ">
                  <input value={form.currencyLocale} onChange={set('currencyLocale')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Currency label" hint='Short prefix in reports/PDFs, e.g. "TSh"'>
                  <input value={form.currencyLabel} onChange={set('currencyLabel')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Receipt amount suffix" hint='Appended on printed bills, e.g. "/=" — may be empty'>
                  <input value={form.receiptAmountSuffix} onChange={set('receiptAmountSuffix')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="VAT rate (%)" hint="Used on purchase orders — e.g. 18">
                  <input value={vatPct} onChange={(e) => setVatPct(e.target.value)} disabled={!isAdmin} inputMode="decimal" className={inputCls} />
                </Field>
                <Field label="Business day starts at" hint="Entries before this hour count as the previous business day (e.g. a 1am entry counts as yesterday if set to 05:00)">
                  <select
                    value={form.businessDayCutoverHour}
                    onChange={(e) => setForm((f) => ({ ...f, businessDayCutoverHour: Number(e.target.value) }))}
                    disabled={!isAdmin}
                    className={inputCls}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
              <h2 className="font-semibold text-gray-800">🧾 Printed Receipt Text</h2>
              <div className="grid grid-cols-1 gap-4">
                <Field label="Disclaimer line" hint="Small print near the bottom of every printed bill — may be empty">
                  <input value={form.receiptDisclaimerText} onChange={set('receiptDisclaimerText')} disabled={!isAdmin} className={inputCls} />
                </Field>
                <Field label="Sign-off line" hint="Bold closing line, e.g. a thank-you — may be empty">
                  <input value={form.receiptFooterText} onChange={set('receiptFooterText')} disabled={!isAdmin} className={inputCls} />
                </Field>
              </div>
            </div>

            {isAdmin && (
              <button type="submit" disabled={saving}
                className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                {saving ? 'Saving…' : 'Save Preferences'}
              </button>
            )}
          </form>
        )}

        {!loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h2 className="font-semibold text-gray-800">🧑‍🍳 MyPos Floor Roles</h2>
            <p className="text-xs text-gray-400">Shown on the Users &quot;MyPos Floor Role&quot; picker. Informational — doesn&apos;t affect logins.</p>
            <div className="divide-y divide-gray-50">
              {positions.map((p, i) => (
                <div key={p} className="flex items-center gap-2 py-2">
                  <span className="flex-1 text-sm font-medium text-gray-800">{p}</span>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => movePosition(i, -1)} disabled={i === 0 || savingPositions}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-30">↑</button>
                      <button type="button" onClick={() => movePosition(i, 1)} disabled={i === positions.length - 1 || savingPositions}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:bg-gray-100 disabled:opacity-30">↓</button>
                      <button type="button" onClick={() => removePosition(p)} disabled={savingPositions}
                        className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100 disabled:opacity-40">Delete</button>
                    </div>
                  )}
                </div>
              ))}
              {positions.length === 0 && <p className="py-4 text-center text-gray-400 text-sm">No floor roles yet</p>}
            </div>
            {isAdmin && (
              <div className="flex gap-2 pt-1">
                <input value={newPosition} onChange={(e) => setNewPosition(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPosition() } }}
                  placeholder="New floor role (e.g. DJ BOOTH)…" className={inputCls} />
                <button type="button" onClick={addPosition} disabled={savingPositions}
                  className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 whitespace-nowrap">Add</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
