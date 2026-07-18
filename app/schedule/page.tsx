'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { ExportBar } from '@/components/ExportBar'
import { format, addDays, startOfWeek, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { CalendarClock, Wand2, UserMinus, Settings2, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { SCHEDULE_ROLES, ABSENCE_REASONS, SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { DEFAULT_SCHEDULE_CONFIG } from '@/lib/schedule-config-shared'

type ShiftType = 'MORNING' | 'EVENING'
const SHIFT_CHIPS: Record<ShiftType, string> = {
  MORNING: 'bg-amber-100 text-amber-800 border-amber-200',
  EVENING: 'bg-indigo-100 text-indigo-800 border-indigo-200',
}
const ROLES = SCHEDULE_ROLES
const REASONS = ABSENCE_REASONS
const MANAGE_ROLES = SCHEDULE_MANAGE_ROLES

interface Outlet { id: string; name: string; isEventsOnly?: boolean }
interface Assignment { id: string; date: string; shiftType: ShiftType; outletId: string; staffId: string; staffName: string; role: string; source: string; note?: string }
interface Unavail { id: string; staffId: string; staffName: string; date: string; shiftType: ShiftType | null; reason: string; note?: string }
interface StaffLite { id: string; name: string; role: string; outletId?: string }
interface SchedConfig { outletId: string; morningWeight: number; eveningWeight: number; weekendMultiplier: number; daysOffPerWeek: number }
interface ScheduleData { weekStart: string; assignments: Assignment[]; unavailability: Unavail[]; config: SchedConfig | null; serviceStaff: StaffLite[]; allStaff: StaffLite[]; casualStaff: StaffLite[] }

const dayKey = (d: Date | string) => format(typeof d === 'string' ? parseISO(d) : d, 'yyyy-MM-dd')

export default function SchedulePage() {
  const { request } = useApi()
  const { user } = useAuth()
  const canManage = MANAGE_ROLES.includes(user?.role || '')

  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [data, setData] = useState<ScheduleData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // Modals
  const [addCell, setAddCell] = useState<{ staffId: string; staffName: string; date: Date } | null>(null)
  const [addForm, setAddForm] = useState<{ shiftType: ShiftType; role: string }>({ shiftType: 'EVENING', role: 'WAITER' })
  const [absOpen, setAbsOpen] = useState(false)
  const [absForm, setAbsForm] = useState({ staffId: '', date: format(new Date(), 'yyyy-MM-dd'), shiftType: '', reason: 'LEAVE', note: '' })
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfgForm, setCfgForm] = useState<SchedConfig | null>(null)
  const [extraCasualIds, setExtraCasualIds] = useState<string[]>([])
  const [addCasualOpen, setAddCasualOpen] = useState(false)
  const [addCasualId, setAddCasualId] = useState('')
  const [shiftDefs, setShiftDefs] = useState(DEFAULT_SCHEDULE_CONFIG.shiftDefs)

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const scheduleOutlets = outlets.filter((o) => !o.isEventsOnly)
  const SHIFTS = useMemo(() => (['MORNING', 'EVENING'] as ShiftType[]).map((key) => ({
    key, label: shiftDefs[key].label, time: `${shiftDefs[key].start}–${shiftDefs[key].end}`, chip: SHIFT_CHIPS[key],
  })), [shiftDefs])

  useEffect(() => {
    request('/api/schedule-config').then((cfg) => { if (cfg?.shiftDefs) setShiftDefs(cfg.shiftDefs) }).catch(() => {})
  }, [request])

  useEffect(() => {
    request('/api/outlets').then((os: Outlet[]) => {
      setOutlets(os)
      // A WAITER only ever works one outlet — the backend now enforces this
      // regardless (see readOutletScope), so default (and lock, below) the
      // picker to their own outlet rather than an arbitrary first result.
      const own = user?.outlet?.id ? os.find((o) => o.id === user.outlet!.id) : null
      const first = own || os.find((o) => !o.isEventsOnly)
      if (first) setOutletId((cur) => cur || first.id)
    }).catch(() => {})
  }, [request, user?.outlet?.id])

  const load = useCallback(async () => {
    if (!outletId) return
    setLoading(true)
    setExtraCasualIds([])
    try {
      const d = await request(`/api/schedule?outletId=${outletId}&weekStart=${format(weekStart, 'yyyy-MM-dd')}`)
      setData(d)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [request, outletId, weekStart])
  useEffect(() => { load() }, [load])

  // Casuals never come back from serviceStaff (auto-schedule candidates), so
  // track which ids are casual to badge them in the roster.
  const casualIds = useMemo(() => new Set((data?.casualStaff || []).map((c) => c.id)), [data])

  // Rows = service staff at outlet ∪ anyone already scheduled/marked this
  // week ∪ casuals a manager has picked to add to this week's view.
  const rows = useMemo(() => {
    if (!data) return [] as { id: string; name: string }[]
    const m = new Map<string, string>()
    for (const s of data.serviceStaff) m.set(s.id, s.name)
    for (const a of data.assignments) if (!m.has(a.staffId)) m.set(a.staffId, a.staffName)
    for (const u of data.unavailability) if (!m.has(u.staffId)) m.set(u.staffId, u.staffName)
    for (const id of extraCasualIds) {
      if (!m.has(id)) { const c = data.casualStaff.find((c) => c.id === id); if (c) m.set(id, c.name) }
    }
    return [...m.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [data, extraCasualIds])

  const availableCasuals = (data?.casualStaff || []).filter((c) => !rows.some((r) => r.id === c.id))

  const addCasualToWeek = () => {
    if (!addCasualId) return toast.error('Pick a casual worker')
    setExtraCasualIds((prev) => [...prev, addCasualId])
    setAddCasualId('')
    setAddCasualOpen(false)
  }

  const assignAt = (staffId: string, d: Date) => data?.assignments.filter((a) => a.staffId === staffId && dayKey(a.date) === dayKey(d)) || []
  const unavailAt = (staffId: string, d: Date) => data?.unavailability.filter((u) => u.staffId === staffId && dayKey(u.date) === dayKey(d)) || []

  const generate = async () => {
    if (!outletId) return
    setBusy(true)
    try {
      const r = await request('/api/schedule', { method: 'POST', body: JSON.stringify({ mode: 'generate', outletId, weekStart: format(weekStart, 'yyyy-MM-dd') }) })
      toast.success(`Generated ${r.created} shifts for ${r.staff} staff`)
      load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Generate failed') }
    finally { setBusy(false) }
  }

  const submitAdd = async () => {
    if (!addCell) return
    try {
      await request('/api/schedule', { method: 'POST', body: JSON.stringify({ staffId: addCell.staffId, outletId, date: format(addCell.date, 'yyyy-MM-dd'), shiftType: addForm.shiftType, role: addForm.role }) })
      toast.success('Assigned'); setAddCell(null); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const removeAssignment = async (id: string) => {
    try { await request(`/api/schedule/${id}`, { method: 'DELETE' }); load() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const cycleShift = async (a: Assignment) => {
    const next: ShiftType = a.shiftType === 'MORNING' ? 'EVENING' : 'MORNING'
    try { await request(`/api/schedule/${a.id}`, { method: 'PATCH', body: JSON.stringify({ shiftType: next }) }); load() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const submitAbsence = async () => {
    if (!absForm.staffId) return toast.error('Pick a staff member')
    try {
      await request('/api/schedule/unavailability', { method: 'POST', body: JSON.stringify({ staffId: absForm.staffId, date: absForm.date, shiftType: absForm.shiftType || null, reason: absForm.reason, note: absForm.note }) })
      toast.success('Marked unavailable'); setAbsOpen(false); setAbsForm({ ...absForm, staffId: '', note: '' }); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const removeAbsence = async (id: string) => {
    try { await request(`/api/schedule/unavailability?id=${id}`, { method: 'DELETE' }); load() }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const openConfig = () => { setCfgForm(data?.config || null); setCfgOpen(true) }
  const saveConfig = async () => {
    if (!cfgForm) return
    try {
      await request('/api/schedule/config', { method: 'PUT', body: JSON.stringify({ ...cfgForm, outletId }) })
      toast.success('Settings saved'); setCfgOpen(false); load()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  // Per-day headcount footer.
  const counts = weekDays.map((d) => {
    const all = data?.assignments.filter((a) => dayKey(a.date) === dayKey(d)) || []
    return { m: all.filter((a) => a.shiftType === 'MORNING').length, e: all.filter((a) => a.shiftType === 'EVENING').length }
  })

  const exportRows = (data?.assignments || []).map((a) => ({
    Date: format(parseISO(a.date), 'EEE dd MMM'), Shift: a.shiftType, Time: SHIFTS.find((s) => s.key === a.shiftType)?.time,
    Staff: a.staffName, Role: a.role, Source: a.source,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <CalendarClock className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Staff Scheduling</h1>
            <p className="text-sm text-gray-500">Weekly roster — two shifts a day. {SHIFTS.map((s) => `${s.label} ${s.time}`).join(' · ')}</p>
          </div>
        </div>

        {/* Controls */}
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            {canManage ? (
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium focus:border-indigo-500 focus:outline-none">
                {scheduleOutlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              // Non-manage roles (WAITER) are locked to their own outlet
              // server-side — showing a picker that has no effect would be
              // misleading, so just label the outlet instead.
              <span className="px-3 py-2 bg-gray-50 text-gray-700 rounded-xl text-sm font-medium">
                {outlets.find((o) => o.id === outletId)?.name || '—'}
              </span>
            )}

            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="p-1.5 rounded-lg hover:bg-white"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))} className="px-3 py-1 text-xs font-semibold rounded-lg hover:bg-white">This week</button>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="p-1.5 rounded-lg hover:bg-white"><ChevronRight className="w-4 h-4" /></button>
            </div>
            <span className="text-sm font-medium text-gray-600">{format(weekStart, 'dd MMM')} – {format(addDays(weekStart, 6), 'dd MMM yyyy')}</span>

            {canManage && (
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={generate} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-60">
                  <Wand2 className="w-4 h-4" />{busy ? 'Generating…' : 'Auto-generate'}
                </button>
                <button onClick={() => setAddCasualOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-amber-100 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-200 transition">
                  <UserMinus className="w-4 h-4 rotate-180" />Add casual worker
                </button>
                <button onClick={() => setAbsOpen(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                  <UserMinus className="w-4 h-4" />Mark unavailable
                </button>
                <button onClick={openConfig} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-200 transition">
                  <Settings2 className="w-4 h-4" />Settings
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            Auto-generate uses historical sales, fair rotation and expected-traffic weighting. Hover a shift to see why it was chosen.
            {canManage && ' Click an empty cell to add a shift, a chip to switch Morning/Evening, or ✕ to remove.'}
          </p>
        </Card>

        {/* Grid */}
        {loading ? (
          <Card><div className="py-16 text-center text-gray-400">Loading roster…</div></Card>
        ) : rows.length === 0 ? (
          <Card><div className="py-16 text-center text-gray-400">No service staff (role WAITER) at this outlet yet. Add them under Setup → Users, then auto-generate or assign manually.</div></Card>
        ) : (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-3 text-left font-semibold text-gray-600 sticky left-0 bg-gray-50 min-w-[140px]">Staff</th>
                  {weekDays.map((d, i) => {
                    const weekend = [5, 6].includes(d.getDay())
                    return (
                      <th key={i} className={`px-2 py-3 text-center font-semibold min-w-[120px] ${weekend ? 'text-indigo-700' : 'text-gray-600'}`}>
                        <div>{format(d, 'EEE')}</div>
                        <div className="text-[11px] font-normal text-gray-400">{format(d, 'dd MMM')}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((staff) => (
                  <tr key={staff.id} className="hover:bg-gray-50/50">
                    <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-white">
                      {staff.name}
                      {casualIds.has(staff.id) && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700">Casual</span>}
                    </td>
                    {weekDays.map((d, i) => {
                      const as = assignAt(staff.id, d)
                      const un = unavailAt(staff.id, d)
                      const wholeDayOff = un.some((u) => u.shiftType === null)
                      return (
                        <td key={i} className="px-1.5 py-1.5 align-top text-center">
                          <div className="flex flex-col gap-1 items-stretch">
                            {as.map((a) => {
                              const sh = SHIFTS.find((s) => s.key === a.shiftType)!
                              return (
                                <div key={a.id} title={a.note || ''} className={`group relative rounded-lg border px-2 py-1 text-[11px] font-semibold ${sh.chip}`}>
                                  <button disabled={!canManage} onClick={() => canManage && cycleShift(a)} className="block w-full text-center disabled:cursor-default">
                                    {sh.label}{a.role !== 'WAITER' ? ` · ${a.role.slice(0, 4)}` : ''}
                                    {a.source === 'MANUAL' && <span className="ml-0.5 text-[9px] opacity-60">✎</span>}
                                  </button>
                                  {canManage && (
                                    <button onClick={() => removeAssignment(a.id)} className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-sm">
                                      <X className="w-2.5 h-2.5 text-gray-500" />
                                    </button>
                                  )}
                                </div>
                              )
                            })}
                            {un.map((u) => (
                              <div key={u.id} className="group relative rounded-lg border border-gray-200 bg-gray-100 text-gray-500 px-2 py-1 text-[10px] font-medium" title={u.note || ''}>
                                {u.reason}{u.shiftType ? ` · ${u.shiftType === 'MORNING' ? 'AM' : 'PM'}` : ''}
                                {canManage && (
                                  <button onClick={() => removeAbsence(u.id)} className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition shadow-sm">
                                    <X className="w-2.5 h-2.5 text-gray-500" />
                                  </button>
                                )}
                              </div>
                            ))}
                            {canManage && !wholeDayOff && as.length < 2 && (
                              <button onClick={() => { setAddCell({ staffId: staff.id, staffName: staff.name, date: d }); setAddForm({ shiftType: 'EVENING', role: 'WAITER' }) }}
                                className="rounded-lg border border-dashed border-gray-200 text-gray-300 hover:text-indigo-500 hover:border-indigo-300 text-xs py-1 transition">+</button>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {/* Headcount footer */}
                <tr className="bg-gray-50 border-t-2 border-gray-200 text-[11px] font-semibold text-gray-500">
                  <td className="px-3 py-2 sticky left-0 bg-gray-50">Headcount (AM / PM)</td>
                  {counts.map((c, i) => (
                    <td key={i} className="px-2 py-2 text-center"><span className="text-amber-700">{c.m}</span> / <span className="text-indigo-700">{c.e}</span></td>
                  ))}
                </tr>
              </tbody>
            </table>
          </Card>
        )}

        {exportRows.length > 0 && <ExportBar rows={exportRows} filename={`schedule-${format(weekStart, 'yyyy-MM-dd')}`} title="Weekly Staff Schedule" />}
      </div>

      {/* Add-shift modal */}
      {addCell && (
        <Modal title={`Assign ${addCell.staffName} · ${format(addCell.date, 'EEE dd MMM')}`} onClose={() => setAddCell(null)}>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Shift</label>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {SHIFTS.map((s) => (
              <button key={s.key} onClick={() => setAddForm({ ...addForm, shiftType: s.key })}
                className={`px-3 py-2 rounded-xl text-sm font-semibold border-2 transition ${addForm.shiftType === s.key ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                {s.label}<div className="text-[10px] font-normal opacity-70">{s.time}</div>
              </button>
            ))}
          </div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Role</label>
          <select value={addForm.role} onChange={(e) => setAddForm({ ...addForm, role: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm mb-4 focus:border-indigo-500 focus:outline-none">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={submitAdd} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Assign</button>
        </Modal>
      )}

      {/* Add casual worker modal */}
      {addCasualOpen && (
        <Modal title="Add casual worker to this week" onClose={() => setAddCasualOpen(false)}>
          {availableCasuals.length === 0 ? (
            <p className="text-sm text-gray-500 mb-3">No available casual workers. Add one under Setup → Users (check &quot;Casual / temporary worker&quot;).</p>
          ) : (
            <>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Casual worker</label>
              <select value={addCasualId} onChange={(e) => setAddCasualId(e.target.value)} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm mb-4 focus:border-indigo-500 focus:outline-none">
                <option value="">Select…</option>
                {availableCasuals.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.role})</option>)}
              </select>
              <button onClick={addCasualToWeek} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Add to roster</button>
              <p className="text-[11px] text-gray-400 mt-2">Adds them to this week&apos;s grid so you can click + to assign a shift. They won&apos;t be included in auto-generate.</p>
            </>
          )}
        </Modal>
      )}

      {/* Mark unavailable modal */}
      {absOpen && (
        <Modal title="Mark staff unavailable" onClose={() => setAbsOpen(false)}>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Staff</label>
          <select value={absForm.staffId} onChange={(e) => setAbsForm({ ...absForm, staffId: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm mb-3 focus:border-indigo-500 focus:outline-none">
            <option value="">Select staff…</option>
            {(data?.allStaff || []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date</label>
              <input type="date" value={absForm.date} onChange={(e) => setAbsForm({ ...absForm, date: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
              <select value={absForm.reason} onChange={(e) => setAbsForm({ ...absForm, reason: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Scope</label>
          <select value={absForm.shiftType} onChange={(e) => setAbsForm({ ...absForm, shiftType: e.target.value })} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm mb-3 focus:border-indigo-500 focus:outline-none">
            <option value="">Whole day</option>
            <option value="MORNING">Morning only</option>
            <option value="EVENING">Evening only</option>
          </select>
          <input value={absForm.note} onChange={(e) => setAbsForm({ ...absForm, note: e.target.value })} placeholder="Note (optional)" className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm mb-4 focus:border-indigo-500 focus:outline-none" />
          <button onClick={submitAbsence} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Mark unavailable</button>
          <p className="text-[11px] text-gray-400 mt-2">Auto-generated shifts that clash with this absence are removed immediately.</p>
        </Modal>
      )}

      {/* Settings modal */}
      {cfgOpen && cfgForm && (
        <Modal title="Scheduler settings" onClose={() => setCfgOpen(false)}>
          <p className="text-xs text-gray-500 mb-3">Traffic weights bias how many staff each shift gets. Higher evening weight = more staff on the busier night shift.</p>
          {([
            ['morningWeight', 'Morning traffic weight'],
            ['eveningWeight', 'Evening traffic weight'],
            ['weekendMultiplier', 'Weekend multiplier (Fri/Sat)'],
            ['daysOffPerWeek', 'Rest days per staff / week'],
          ] as [keyof SchedConfig, string][]).map(([k, label]) => (
            <div key={k} className="mb-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
              <input type="number" step={k === 'daysOffPerWeek' ? 1 : 0.1} min={0} value={cfgForm[k] as number}
                onChange={(e) => setCfgForm({ ...cfgForm, [k]: Number(e.target.value) })}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          ))}
          <button onClick={saveConfig} className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition mt-1">Save settings</button>
        </Modal>
      )}
    </AppShell>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}
