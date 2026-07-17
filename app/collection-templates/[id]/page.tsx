'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

const FIELD_TYPES = ['NUMBER', 'TEXT', 'SELECT', 'STAFF_PICKER', 'PERSON_PICKER', 'DATE', 'BOOLEAN'] as const
const ENTRY_MODES: { value: string; label: string; enabled: boolean }[] = [
  { value: 'SINGLE_STAFF', label: 'Single Staff (one form, save, next staff)', enabled: true },
  { value: 'MULTI_STAFF_GRID', label: 'Multi-Staff Grid (all staff, one screen, one save)', enabled: true },
  { value: 'BATCH', label: 'Batch Entry (select staff, fill together)', enabled: true },
  { value: 'EXCEL_IMPORT', label: 'Excel Import (upload a spreadsheet)', enabled: true },
  { value: 'POS_SYNC', label: 'POS Auto Sync — not connected yet', enabled: true },
]
const SECTION_PRESETS = ['SALES', 'PAYMENT_CHANNELS', 'BILLS', 'DISCOUNTS', 'CANCELLATIONS', 'RETURNS', 'REFUNDS', 'EXCESS', 'CASH_RECON', 'BANK_DEPOSITS', 'CUSTOMER_DETAILS', 'REFERENCE_NUMBERS', 'REMARKS', 'ATTACHMENTS']
const RULE_TYPES: { value: string; label: string; help: string }[] = [
  { value: 'STAGE_SEQUENCE', label: 'Stage Sequence', help: 'A required stage must be completed before later stages can be submitted. No config needed.' },
  { value: 'CASH_NOT_EXCEED_SYSTEM_SALES', label: 'Cash Cannot Exceed System Sales', help: '{"cashFieldKey":"CASH","systemSalesFieldKey":"SYSTEM_SALES","reasonFieldKey":"EXCESS_REASON"}' },
  { value: 'DISCOUNT_APPROVAL_LIMIT', label: 'Discount Approval Limit', help: '{"fieldKey":"DISCOUNT","limit":50000,"approverRole":"MANAGER"}' },
  { value: 'NO_NEGATIVE_BALANCE', label: 'No Negative Balance', help: '{"fieldKey":"CASH"} — omit fieldKey to apply to every number field' },
  { value: 'REQUIRED_FIELD', label: 'Required Field', help: 'No-op — required fields are already enforced per-field in the editor above.' },
]

let tempSeq = 0
const tempKey = () => `tmp_${++tempSeq}`
const toKey = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

interface FieldState { _k: string; id?: string; key: string; label: string; fieldType: string; isRequired: boolean }
interface SectionState { _k: string; id?: string; key: string; label: string; isMandatory: boolean; fields: FieldState[] }
interface StageState { _k: string; id?: string; key: string; label: string; isOptional: boolean; entryMode: string; sections: SectionState[] }
interface RuleState { _k: string; id?: string; ruleType: string; config: string; isActive: boolean }

function TemplateEditorSkeleton() {
  return (
    <div className="max-w-4xl space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-gray-100 rounded" />
      <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
        <div className="h-9 w-full bg-gray-100 rounded-xl" />
        <div className="h-9 w-full bg-gray-100 rounded-xl" />
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
          <div className="h-9 w-1/2 bg-gray-100 rounded-xl" />
          <div className="h-16 w-full bg-gray-50 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

function move<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir
  if (target < 0 || target >= arr.length) return arr
  const copy = [...arr]
  ;[copy[index], copy[target]] = [copy[target], copy[index]]
  return copy
}

export default function CollectionTemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { request } = useApi()
  const { user } = useAuth()
  const [canManage, setCanManage] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [isDefault, setIsDefault] = useState(false)
  const [stages, setStages] = useState<StageState[]>([])
  const [rules, setRules] = useState<RuleState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, perms] = await Promise.all([request(`/api/collection-templates/${id}`), request('/api/permissions/me')])
      setCanManage(user?.role === 'ADMIN' || !!perms?.COLLECTION_TEMPLATES?.canEdit)
      setName(t.name); setDescription(t.description || ''); setIsActive(t.isActive); setIsDefault(t.isDefault)
      setStages((t.stages || []).map((s: { id: string; key: string; label: string; isOptional: boolean; entryMode: string; sections: { id: string; key: string; label: string; isMandatory: boolean; fields: { id: string; key: string; label: string; fieldType: string; isRequired: boolean }[] }[] }) => ({
        _k: tempKey(), id: s.id, key: s.key, label: s.label, isOptional: s.isOptional, entryMode: s.entryMode,
        sections: s.sections.map((sec) => ({
          _k: tempKey(), id: sec.id, key: sec.key, label: sec.label, isMandatory: sec.isMandatory,
          fields: sec.fields.map((f) => ({ _k: tempKey(), id: f.id, key: f.key, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired })),
        })),
      })))
      setRules((t.validationRules || []).map((r: { id: string; ruleType: string; config: string | null; isActive: boolean }) => ({
        _k: tempKey(), id: r.id, ruleType: r.ruleType, config: r.config || '', isActive: r.isActive,
      })))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load template')
    } finally { setLoading(false) }
  }, [request, id, user])

  useEffect(() => { load() }, [load])

  const addStage = () => setStages((prev) => [...prev, { _k: tempKey(), key: `STAGE_${prev.length + 1}`, label: 'New Stage', isOptional: false, entryMode: 'SINGLE_STAFF', sections: [] }])
  const removeStage = (i: number) => setStages((prev) => prev.filter((_, idx) => idx !== i))
  const updateStage = (i: number, patch: Partial<StageState>) => setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  const moveStage = (i: number, dir: -1 | 1) => setStages((prev) => move(prev, i, dir))

  const addSection = (stageIdx: number) => updateStage(stageIdx, { sections: [...stages[stageIdx].sections, { _k: tempKey(), key: 'CUSTOM_SECTION', label: 'New Section', isMandatory: false, fields: [] }] })
  const removeSection = (stageIdx: number, secIdx: number) => updateStage(stageIdx, { sections: stages[stageIdx].sections.filter((_, i) => i !== secIdx) })
  const updateSection = (stageIdx: number, secIdx: number, patch: Partial<SectionState>) =>
    updateStage(stageIdx, { sections: stages[stageIdx].sections.map((s, i) => (i === secIdx ? { ...s, ...patch } : s)) })
  const moveSection = (stageIdx: number, secIdx: number, dir: -1 | 1) => updateStage(stageIdx, { sections: move(stages[stageIdx].sections, secIdx, dir) })

  const addField = (stageIdx: number, secIdx: number) => {
    const section = stages[stageIdx].sections[secIdx]
    updateSection(stageIdx, secIdx, { fields: [...section.fields, { _k: tempKey(), key: `FIELD_${section.fields.length + 1}`, label: 'New Field', fieldType: 'NUMBER', isRequired: false }] })
  }
  const removeField = (stageIdx: number, secIdx: number, fieldIdx: number) => {
    const section = stages[stageIdx].sections[secIdx]
    updateSection(stageIdx, secIdx, { fields: section.fields.filter((_, i) => i !== fieldIdx) })
  }
  const updateField = (stageIdx: number, secIdx: number, fieldIdx: number, patch: Partial<FieldState>) => {
    const section = stages[stageIdx].sections[secIdx]
    updateSection(stageIdx, secIdx, { fields: section.fields.map((f, i) => (i === fieldIdx ? { ...f, ...patch } : f)) })
  }

  const addRule = () => setRules((prev) => [...prev, { _k: tempKey(), ruleType: 'DISCOUNT_APPROVAL_LIMIT', config: '', isActive: true }])
  const removeRule = (i: number) => setRules((prev) => prev.filter((_, idx) => idx !== i))
  const updateRule = (i: number, patch: Partial<RuleState>) => setRules((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const canSave = useMemo(() => {
    if (!name.trim()) return false
    for (const r of rules) { if (r.config) { try { JSON.parse(r.config) } catch { return false } } }
    return true
  }, [name, rules])

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name, description, isActive,
        stages: stages.map((s) => ({
          id: s.id, key: s.key, label: s.label, isOptional: s.isOptional, entryMode: s.entryMode,
          sections: s.sections.map((sec) => ({
            id: sec.id, key: sec.key, label: sec.label, isMandatory: sec.isMandatory,
            fields: sec.fields.map((f) => ({ id: f.id, key: f.key, label: f.label, fieldType: f.fieldType, isRequired: f.isRequired })),
          })),
        })),
        validationRules: rules.map((r) => ({ id: r.id, ruleType: r.ruleType, config: r.config || null, isActive: r.isActive })),
      }
      await request(`/api/collection-templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      toast.success('Template saved')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save template')
    } finally { setSaving(false) }
  }

  if (loading) return <AppShell><SetupTabs /><TemplateEditorSkeleton /></AppShell>

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-4xl pb-16">
        <div className="flex items-center justify-between">
          <div>
            <button onClick={() => router.push('/collection-templates')} className="text-xs text-gray-400 hover:text-gray-600 mb-1">← Back to templates</button>
            <h1 className="text-2xl font-bold text-gray-900">Edit Template</h1>
          </div>
          {canManage && (
            <button disabled={!canSave || saving} onClick={save} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-500">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage}
              className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm disabled:bg-gray-50" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage}
              className="w-full mt-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm disabled:bg-gray-50" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isActive} disabled={!canManage} onChange={(e) => setIsActive(e.target.checked)} /> Active
            {isDefault && <span className="ml-2 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[11px] font-semibold rounded-full">Default template</span>}
          </label>
        </div>

        <div className="space-y-4">
          {stages.map((stage, stageIdx) => (
            <div key={stage._k} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-1 bg-gray-100 text-gray-500 text-xs font-bold rounded-lg">Stage {stageIdx + 1}</span>
                <input value={stage.label} disabled={!canManage}
                  onChange={(e) => updateStage(stageIdx, { label: e.target.value, key: stage.key === `STAGE_${stageIdx + 1}` || !stage.id ? toKey(e.target.value) : stage.key })}
                  className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-semibold focus:border-indigo-500 focus:outline-none disabled:bg-gray-50" />
                {canManage && (
                  <div className="flex gap-1">
                    <button onClick={() => moveStage(stageIdx, -1)} className="px-2 py-1 bg-gray-50 rounded-lg text-gray-500 hover:bg-gray-100" title="Move up">↑</button>
                    <button onClick={() => moveStage(stageIdx, 1)} className="px-2 py-1 bg-gray-50 rounded-lg text-gray-500 hover:bg-gray-100" title="Move down">↓</button>
                    <button onClick={() => removeStage(stageIdx)} className="px-2 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-semibold">Remove</button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={stage.isOptional} disabled={!canManage} onChange={(e) => updateStage(stageIdx, { isOptional: e.target.checked })} /> Optional stage
                </label>
                <label className="flex items-center gap-1.5">
                  Entry mode:
                  <select value={stage.entryMode} disabled={!canManage} onChange={(e) => updateStage(stageIdx, { entryMode: e.target.value })}
                    className="px-2 py-1 border border-gray-200 rounded-lg text-xs">
                    {ENTRY_MODES.map((m) => <option key={m.value} value={m.value} disabled={!m.enabled}>{m.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="space-y-3 pl-3 border-l-2 border-gray-100">
                {stage.sections.map((section, secIdx) => (
                  <div key={section._k} className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input value={section.label} disabled={!canManage}
                        onChange={(e) => updateSection(stageIdx, secIdx, { label: e.target.value, key: !section.id ? toKey(e.target.value) : section.key })}
                        list="section-presets"
                        className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-100" />
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        <input type="checkbox" checked={section.isMandatory} disabled={!canManage} onChange={(e) => updateSection(stageIdx, secIdx, { isMandatory: e.target.checked })} /> Mandatory
                      </label>
                      {canManage && (
                        <div className="flex gap-1">
                          <button onClick={() => moveSection(stageIdx, secIdx, -1)} className="px-1.5 py-1 bg-white rounded-lg text-gray-400 hover:text-gray-600 border border-gray-200 text-xs">↑</button>
                          <button onClick={() => moveSection(stageIdx, secIdx, 1)} className="px-1.5 py-1 bg-white rounded-lg text-gray-400 hover:text-gray-600 border border-gray-200 text-xs">↓</button>
                          <button onClick={() => removeSection(stageIdx, secIdx)} className="px-2 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-semibold">✕</button>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      {section.fields.map((field, fieldIdx) => (
                        <div key={field._k} className="flex items-center gap-2">
                          <input value={field.label} disabled={!canManage}
                            onChange={(e) => updateField(stageIdx, secIdx, fieldIdx, { label: e.target.value, key: !field.id ? toKey(e.target.value) : field.key })}
                            className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:border-indigo-500 focus:outline-none disabled:bg-gray-100" />
                          <select value={field.fieldType} disabled={!canManage} onChange={(e) => updateField(stageIdx, secIdx, fieldIdx, { fieldType: e.target.value })}
                            className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                            <input type="checkbox" checked={field.isRequired} disabled={!canManage} onChange={(e) => updateField(stageIdx, secIdx, fieldIdx, { isRequired: e.target.checked })} /> Required
                          </label>
                          {canManage && (
                            <button onClick={() => removeField(stageIdx, secIdx, fieldIdx)} className="px-2 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-semibold">✕</button>
                          )}
                        </div>
                      ))}
                      {canManage && (
                        <button onClick={() => addField(stageIdx, secIdx)} className="text-xs text-indigo-600 font-semibold hover:text-indigo-800 mt-1">+ Add field</button>
                      )}
                    </div>
                  </div>
                ))}
                {canManage && (
                  <button onClick={() => addSection(stageIdx)} className="text-xs text-indigo-600 font-semibold hover:text-indigo-800">+ Add section</button>
                )}
              </div>
            </div>
          ))}
          {canManage && (
            <button onClick={addStage} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-sm font-semibold text-gray-400 hover:text-indigo-600 hover:border-indigo-300">
              + Add Stage
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Validation Rules</h2>
          <p className="text-xs text-gray-400 mb-3">Fixed rule types, configured per template — not a free-form rule builder.</p>
          <div className="space-y-3">
            {rules.map((rule, i) => {
              const def = RULE_TYPES.find((t) => t.value === rule.ruleType)
              return (
                <div key={rule._k} className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <select value={rule.ruleType} disabled={!canManage} onChange={(e) => updateRule(i, { ruleType: e.target.value })}
                      className="flex-1 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
                      {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                      <input type="checkbox" checked={rule.isActive} disabled={!canManage} onChange={(e) => updateRule(i, { isActive: e.target.checked })} /> Active
                    </label>
                    {canManage && <button onClick={() => removeRule(i)} className="px-2 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-xs font-semibold">✕</button>}
                  </div>
                  <input value={rule.config} disabled={!canManage || rule.ruleType === 'STAGE_SEQUENCE' || rule.ruleType === 'REQUIRED_FIELD'}
                    onChange={(e) => updateRule(i, { config: e.target.value })} placeholder={def?.help}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-mono bg-white focus:border-indigo-500 focus:outline-none disabled:bg-gray-100" />
                  <p className="text-[11px] text-gray-400">{def?.help}</p>
                </div>
              )
            })}
            {canManage && <button onClick={addRule} className="text-xs text-indigo-600 font-semibold hover:text-indigo-800">+ Add rule</button>}
            {rules.length === 0 && !canManage && <p className="text-xs text-gray-400">No validation rules configured.</p>}
          </div>
        </div>
      </div>
      <datalist id="section-presets">
        {SECTION_PRESETS.map((p) => <option key={p} value={p} />)}
      </datalist>
    </AppShell>
  )
}
