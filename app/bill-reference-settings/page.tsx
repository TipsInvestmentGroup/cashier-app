'use client'
import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  DATE_FORMAT_OPTIONS, SEPARATOR_OPTIONS, PERSON_NUMBERING_MODES, SEQUENCE_RESET_RULES, REFERENCE_COMPONENT_TYPES,
} from '@/lib/bill-reference-defaults'

// Always present, never deletable (only toggleable) — matches the server-side
// safeguard in app/api/bill-reference-config/components/route.ts.
const CORE_TYPES = new Set(['DATE', 'BILL_TYPE_CODE', 'PERSON_CODE', 'SEQUENCE'])

const SEPARATOR_LABELS: Record<string, string> = { '-': 'Hyphen ( - )', '/': 'Slash ( / )', '_': 'Underscore ( _ )', '.': 'Dot ( . )', NONE: 'None (no separator)' }
const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

interface BillComponent {
  id: string
  type: string
  label: string
  order: number
  isEnabled: boolean
  staticValue: string | null
}

interface ConfigResponse {
  id: string
  dateFormat: string
  customDateFormat: string | null
  separator: string
  numberPadding: number
  personNumberingMode: string
  sequenceResetRule: string
  components: BillComponent[]
}

const MIGRATE_MODELS = ['SignedBill', 'PaidBill', 'CashReconExcess', 'CollectionExcess', 'Breakage'] as const
type MigrateModel = (typeof MIGRATE_MODELS)[number]

interface MigratePreviewRow {
  id: string
  oldReference: string | null
  newInternalBillId: string
  newDisplayReference: string
  billTypeCode: string
}

function SortableComponentRow({
  component, canManage, onPatch, onDelete,
}: {
  component: BillComponent
  canManage: boolean
  onPatch: (id: string, patch: Partial<BillComponent>) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: component.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }
  const isCore = CORE_TYPES.has(component.type)

  return (
    <div ref={setNodeRef} style={style} className="flex flex-wrap items-center gap-3 p-3 bg-white border border-gray-100 rounded-xl">
      <button
        type="button" {...(canManage ? { ...attributes, ...listeners } : {})}
        disabled={!canManage}
        className="text-gray-400 hover:text-gray-600 disabled:opacity-30 touch-none cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <span className="text-[11px] font-mono text-gray-400 w-32 shrink-0">{component.type}</span>

      <input
        value={component.label}
        onChange={(e) => onPatch(component.id, { label: e.target.value })}
        disabled={!canManage}
        placeholder="Label"
        className="flex-1 min-w-[8rem] px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
      />

      {component.type === 'STATIC_TEXT' && (
        <input
          value={component.staticValue || ''}
          onChange={(e) => onPatch(component.id, { staticValue: e.target.value })}
          disabled={!canManage}
          placeholder="Static text…"
          className="w-32 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
        />
      )}

      <label className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
        <input
          type="checkbox" checked={component.isEnabled} disabled={!canManage}
          onChange={(e) => onPatch(component.id, { isEnabled: e.target.checked })}
          className="w-4 h-4"
        />
        Enabled
      </label>

      {canManage && !isCore && (
        <button
          type="button" onClick={() => onDelete(component.id)}
          className="p-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100" aria-label="Delete component"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      {isCore && <span className="text-[10px] text-gray-300 shrink-0">core</span>}
    </div>
  )
}

export default function BillReferenceSettingsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'DIRECTOR'
  // Migration is a one-way data backfill — gated tighter (ADMIN only) than
  // the format/component settings above, matching the API routes' own gate.
  const canMigrate = user?.role === 'ADMIN'

  const [loading, setLoading] = useState(true)
  const [components, setComponents] = useState<BillComponent[]>([])
  const [deleteIds, setDeleteIds] = useState<string[]>([])
  const [dateFormat, setDateFormat] = useState('YYMMDD')
  const [customDateFormat, setCustomDateFormat] = useState('')
  const [separator, setSeparator] = useState('-')
  const [numberPadding, setNumberPadding] = useState(3)
  const [personNumberingMode, setPersonNumberingMode] = useState('AUTO')
  const [sequenceResetRule, setSequenceResetRule] = useState('NEVER')
  const [addType, setAddType] = useState('')
  const [savingFormat, setSavingFormat] = useState(false)
  const [savingComponents, setSavingComponents] = useState(false)
  const [preview, setPreview] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  // Data Migration panel — one-time backfill of pre-existing bills that
  // predate the Bill Reference System (see scripts/backfill-bill-references.ts).
  const [migrateModel, setMigrateModel] = useState<MigrateModel>('SignedBill')
  const [migratePreview, setMigratePreview] = useState<MigratePreviewRow[] | null>(null)
  const [migratePreviewLoading, setMigratePreviewLoading] = useState(false)
  const [migrateRunning, setMigrateRunning] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data: ConfigResponse = await request('/api/bill-reference-config')
      setComponents((data.components || []).slice().sort((a, b) => a.order - b.order))
      setDateFormat(data.dateFormat)
      setCustomDateFormat(data.customDateFormat || '')
      setSeparator(data.separator)
      setNumberPadding(data.numberPadding)
      setPersonNumberingMode(data.personNumberingMode)
      setSequenceResetRule(data.sequenceResetRule)
      setDeleteIds([])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load Bill Reference Settings')
    } finally {
      setLoading(false)
    }
  }, [request])

  useEffect(() => { load() }, [load])

  // Debounced live preview — recomputes against the current (possibly
  // unsaved) form state whenever any setting or the component list changes.
  useEffect(() => {
    if (loading) return
    const handle = setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const res = await request('/api/bill-reference-config/preview', {
          method: 'POST',
          body: JSON.stringify({
            dateFormat,
            customDateFormat: dateFormat === 'CUSTOM' ? (customDateFormat || null) : null,
            separator,
            numberPadding,
            personNumberingMode,
            sequenceResetRule,
            components: components.map((c) => ({ type: c.type, isEnabled: c.isEnabled, order: c.order, staticValue: c.staticValue })),
          }),
        })
        setPreview(res.preview || '')
      } catch {
        // Keep the last good preview on transient errors — this call fires on every keystroke.
      } finally {
        setPreviewLoading(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [loading, dateFormat, customDateFormat, separator, numberPadding, personNumberingMode, sequenceResetRule, components, request])

  const patchComponent = (id: string, patch: Partial<BillComponent>) => {
    setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const handleDelete = (id: string) => {
    setComponents((prev) => prev.filter((c) => c.id !== id))
    if (!id.startsWith('client-')) setDeleteIds((prev) => [...prev, id])
  }

  const handleAdd = () => {
    if (!addType) return
    setComponents((prev) => [
      ...prev,
      {
        id: `client-${crypto.randomUUID()}`,
        type: addType,
        label: humanize(addType),
        order: prev.length,
        isEnabled: true,
        staticValue: addType === 'STATIC_TEXT' ? '' : null,
      },
    ])
    setAddType('')
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setComponents((prev) => {
      const oldIndex = prev.findIndex((c) => c.id === active.id)
      const newIndex = prev.findIndex((c) => c.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      return arrayMove(prev, oldIndex, newIndex).map((c, idx) => ({ ...c, order: idx }))
    })
  }

  const saveFormat = async () => {
    setSavingFormat(true)
    try {
      await request('/api/bill-reference-config', {
        method: 'PUT',
        body: JSON.stringify({
          dateFormat,
          customDateFormat: dateFormat === 'CUSTOM' ? customDateFormat.trim() : null,
          separator,
          numberPadding: Number(numberPadding),
          personNumberingMode,
          sequenceResetRule,
        }),
      })
      toast.success('Format settings saved')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save format settings')
    } finally {
      setSavingFormat(false)
    }
  }

  const saveComponents = async () => {
    setSavingComponents(true)
    try {
      const payload = components.map((c, idx) => ({
        id: c.id.startsWith('client-') ? undefined : c.id,
        type: c.type,
        label: c.label.trim() || humanize(c.type),
        order: idx,
        isEnabled: c.isEnabled,
        staticValue: c.type === 'STATIC_TEXT' ? (c.staticValue || '') : null,
      }))
      await request('/api/bill-reference-config/components', {
        method: 'PUT',
        body: JSON.stringify({ components: payload, deleteIds }),
      })
      toast.success('Component order saved')
      await load() // refresh with real DB ids for anything newly added
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save components')
    } finally {
      setSavingComponents(false)
    }
  }

  const saveAll = async () => { await saveFormat(); await saveComponents() }

  const availableTypes = REFERENCE_COMPONENT_TYPES.filter((t) => !components.some((c) => c.type === t))

  const runMigratePreview = async () => {
    setMigratePreviewLoading(true)
    try {
      const res = await request('/api/bill-reference-config/migrate/preview', {
        method: 'POST',
        body: JSON.stringify({ model: migrateModel, limit: 20 }),
      })
      setMigratePreview(res.preview || [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not preview the migration')
    } finally {
      setMigratePreviewLoading(false)
    }
  }

  const runMigrateRun = async () => {
    if (!(await confirmMigrate())) return
    setMigrateRunning(true)
    try {
      const res = await request('/api/bill-reference-config/migrate/run', {
        method: 'POST',
        body: JSON.stringify({ model: migrateModel, confirm: true }),
      })
      toast.success(`Migrated ${res.migrated} ${migrateModel} record(s)`)
      setMigratePreview(null)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Migration failed')
    } finally {
      setMigrateRunning(false)
    }
  }

  const confirmMigrate = async () => {
    if (typeof window === 'undefined') return true
    return window.confirm(
      `Run the Bill Reference backfill for every un-migrated ${migrateModel} record? This permanently stamps an Internal Bill ID and Display Reference on each — it cannot be undone (though nothing else about the record changes, and old references stay intact as legacyReference).`
    )
  }

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bill Reference Settings</h1>
          <p className="text-gray-500 text-sm">Configure how Internal Bill IDs &amp; Display References are built across Signed Bills, Paid Bills, Excess &amp; Loss records</p>
        </div>

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            👁️ View only. Changing the reference format or component layout is limited to Admin and Director.
          </div>
        )}

        {/* Live preview */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5">
          <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-1">Live Preview</p>
          <p className="font-mono text-lg text-indigo-900 min-h-[1.75rem]">
            {previewLoading && !preview ? 'Calculating…' : (preview || '—')}
          </p>
          <p className="text-[11px] text-indigo-400 mt-1">Sample values — person code 14, sequence 3, outlet DSM</p>
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : (
          <>
            {/* Component order */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-gray-800">Reference Components</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Drag to reorder. Date, Bill Type, Person Code &amp; Sequence always exist and can only be toggled.</p>
                </div>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={components.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {components.map((c) => (
                      <SortableComponentRow key={c.id} component={c} canManage={canManage} onPatch={patchComponent} onDelete={handleDelete} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {canManage && availableTypes.length > 0 && (
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                  <select
                    value={addType} onChange={(e) => setAddType(e.target.value)}
                    className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white"
                  >
                    <option value="">Add component…</option>
                    {availableTypes.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                  </select>
                  <button
                    type="button" onClick={handleAdd} disabled={!addType}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-700 text-sm font-semibold rounded-xl hover:bg-indigo-100 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </div>
              )}

              {canManage && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="button" onClick={saveComponents} disabled={savingComponents}
                    className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {savingComponents ? 'Saving…' : 'Save Component Order'}
                  </button>
                </div>
              )}
            </div>

            {/* Format panel */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h3 className="font-semibold text-gray-800 mb-4">Format Settings</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date Format</label>
                  <select
                    value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} disabled={!canManage}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    {DATE_FORMAT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>

                {dateFormat === 'CUSTOM' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Custom Date Format</label>
                    <input
                      value={customDateFormat} onChange={(e) => setCustomDateFormat(e.target.value)} disabled={!canManage}
                      placeholder="e.g. yyyy-MM-dd"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">date-fns token string</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Separator</label>
                  <select
                    value={separator} onChange={(e) => setSeparator(e.target.value)} disabled={!canManage}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    {SEPARATOR_OPTIONS.map((opt) => <option key={opt} value={opt}>{SEPARATOR_LABELS[opt] || opt}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Number Padding</label>
                  <input
                    type="number" min={1} max={8} value={numberPadding} disabled={!canManage}
                    onChange={(e) => setNumberPadding(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">e.g. 3 → 001, 4 → 0001</p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Person Numbering Mode</label>
                  <select
                    value={personNumberingMode} onChange={(e) => setPersonNumberingMode(e.target.value)} disabled={!canManage}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    {PERSON_NUMBERING_MODES.map((opt) => <option key={opt} value={opt}>{humanize(opt)}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Sequence Reset Rule</label>
                  <select
                    value={sequenceResetRule} onChange={(e) => setSequenceResetRule(e.target.value)} disabled={!canManage}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    {SEQUENCE_RESET_RULES.map((opt) => <option key={opt} value={opt}>{humanize(opt)}</option>)}
                  </select>
                </div>
              </div>

              {canManage && (
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button" onClick={saveFormat} disabled={savingFormat}
                    className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {savingFormat ? 'Saving…' : 'Save Format Settings'}
                  </button>
                </div>
              )}
            </div>

            {canManage && (
              <div className="flex justify-end">
                <button
                  type="button" onClick={saveAll} disabled={savingFormat || savingComponents}
                  className="px-5 py-3 bg-gray-900 text-white text-sm font-bold rounded-xl hover:bg-gray-800 disabled:opacity-60"
                >
                  Save Everything
                </button>
              </div>
            )}

            {/* Data Migration — one-time backfill of bills that predate the
                Bill Reference System. ADMIN-only (tighter than canManage
                above), matching the migrate/preview + migrate/run API gate. */}
            {canMigrate && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <h3 className="font-semibold text-gray-800 mb-1">Data Migration</h3>
                <p className="text-xs text-gray-400 mb-4">
                  Backfill Internal Bill IDs &amp; Display References onto bills created before this feature existed.
                  Old references are preserved as &ldquo;legacy&rdquo; and stay searchable. Preview first — this is a one-way write.
                </p>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <select
                    value={migrateModel}
                    onChange={(e) => { setMigrateModel(e.target.value as MigrateModel); setMigratePreview(null) }}
                    className="px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white"
                  >
                    {MIGRATE_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <button
                    type="button" onClick={runMigratePreview} disabled={migratePreviewLoading}
                    className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-200 disabled:opacity-60"
                  >
                    {migratePreviewLoading ? 'Loading…' : 'Preview'}
                  </button>
                  <button
                    type="button" onClick={runMigrateRun} disabled={migrateRunning}
                    className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700 disabled:opacity-60"
                  >
                    {migrateRunning ? 'Migrating…' : 'Run Migration'}
                  </button>
                </div>

                {migratePreview !== null && (
                  migratePreview.length === 0 ? (
                    <p className="text-sm text-green-700">Nothing to migrate — every {migrateModel} record already has a Bill Reference.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr className="text-left text-gray-500">
                            <th className="px-3 py-2 font-semibold">Old Reference</th>
                            <th className="px-3 py-2 font-semibold">New Internal Bill ID</th>
                            <th className="px-3 py-2 font-semibold">New Display Reference</th>
                            <th className="px-3 py-2 font-semibold">Bill Type</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {migratePreview.map((r) => (
                            <tr key={r.id}>
                              <td className="px-3 py-2 font-mono text-gray-500">{r.oldReference || '—'}</td>
                              <td className="px-3 py-2 font-mono text-gray-700">{r.newInternalBillId}</td>
                              <td className="px-3 py-2 font-mono text-indigo-700">{r.newDisplayReference}</td>
                              <td className="px-3 py-2 text-gray-500">{r.billTypeCode}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-gray-400 mt-2">Showing up to 20 of the next un-migrated records — nothing is written until you click Run Migration.</p>
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
