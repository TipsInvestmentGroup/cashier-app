'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { ExportBar } from '@/components/ExportBar'
import { formatCurrency } from '@/lib/utils'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { PartyPopper, Plus, X, Trash2, Users, Wallet, TrendingUp } from 'lucide-react'

const MANAGE_ROLES = ['MANAGER', 'DIRECTOR', 'ADMIN']
const STATUSES = ['PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED']
const ROLES = ['SUPERVISOR', 'WAITER', 'BARTENDER', 'CASHIER', 'HOSTESS']
const EXPENSE_CATEGORIES = ['Transport', 'Equipment Hire', 'Food & Drinks', 'Decor', 'Staff Allowance', 'Other']
const STATUS_CHIP: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-700', CONFIRMED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-700',
}

interface EventRow { id: string; name: string; clientName?: string; location?: string; date: string; startTime?: string; endTime?: string; expectedGuests: number; status: string; salesTotal: number; totalExpenses: number; profit: number; staffCount: number; attendedCount: number }
interface StaffLite { id: string; name: string; role: string }
interface EventStaff { id: string; staffId: string; staffName: string; role: string; attended: boolean; salesAttributed: number; performanceNote?: string }
interface EventExpense { id: string; category: string; description?: string; amount: number }
interface EventDetail extends EventRow { notes?: string; staff: EventStaff[]; expenses: EventExpense[]; allStaff: StaffLite[]; report: { salesTotal: number; totalExpenses: number; profit: number; margin: number; staffCount: number; attended: number; staffSales: number } }

const EMPTY_FORM = { name: '', clientName: '', location: '', date: format(new Date(), 'yyyy-MM-dd'), startTime: '', endTime: '', expectedGuests: '', notes: '' }

export default function EventsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const canManage = MANAGE_ROLES.includes(user?.role || '')

  const [events, setEvents] = useState<EventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [detail, setDetail] = useState<EventDetail | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setEvents(await request(`/api/events${statusFilter ? `?status=${statusFilter}` : ''}`)) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [request, statusFilter])
  useEffect(() => { load() }, [load])

  const openDetail = async (id: string) => {
    try { setDetail(await request(`/api/events/${id}`)) }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }
  const refreshDetail = async () => { if (detail) setDetail(await request(`/api/events/${detail.id}`)) }

  const createEvent = async () => {
    if (!form.name.trim()) return toast.error('Event name is required')
    try {
      const ev = await request('/api/events', { method: 'POST', body: JSON.stringify({ ...form, expectedGuests: Number(form.expectedGuests) || 0 }) })
      toast.success('Event created'); setCreateOpen(false); setForm({ ...EMPTY_FORM }); await load(); openDetail(ev.id)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <PartyPopper className="w-7 h-7 text-indigo-600" />
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Events</h1>
            <p className="text-sm text-gray-500">External events & special functions — staffed temporarily, off the regular roster.</p>
          </div>
          {canManage && (
            <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition">
              <Plus className="w-4 h-4" />New event
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Status:</span>
          {['', ...STATUSES].map((s) => (
            <button key={s || 'all'} onClick={() => setStatusFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>

        {loading ? (
          <Card><div className="py-16 text-center text-gray-400">Loading events…</div></Card>
        ) : events.length === 0 ? (
          <Card><div className="py-16 text-center text-gray-400">No events yet.{canManage && ' Click “New event” to create one.'}</div></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map((e) => (
              <Card key={e.id} className="cursor-pointer hover:shadow-md transition" >
                <div onClick={() => openDetail(e.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-gray-900">{e.name}</div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CHIP[e.status]}`}>{e.status}</span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{e.clientName || 'No client'} · {format(parseISO(e.date), 'EEE dd MMM yyyy')}</div>
                  {e.location && <div className="text-xs text-gray-400">📍 {e.location}</div>}
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div><div className="text-[10px] text-gray-400 uppercase">Staff</div><div className="font-bold text-gray-800">{e.staffCount}</div></div>
                    <div><div className="text-[10px] text-gray-400 uppercase">Guests</div><div className="font-bold text-gray-800">{e.expectedGuests}</div></div>
                    <div><div className="text-[10px] text-gray-400 uppercase">Profit</div><div className={`font-bold ${e.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(e.profit)}</div></div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {createOpen && (
        <Modal title="New event" onClose={() => setCreateOpen(false)} wide>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Event name *"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Client"><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={inputCls} /></Field>
            <Field label="Date *"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} /></Field>
            <Field label="Location"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} /></Field>
            <Field label="Start time"><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputCls} /></Field>
            <Field label="End time"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputCls} /></Field>
            <Field label="Expected guests"><input type="number" min={0} value={form.expectedGuests} onChange={(e) => setForm({ ...form, expectedGuests: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={inputCls} /></Field>
          <button onClick={createEvent} className="w-full mt-2 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Create event</button>
        </Modal>
      )}

      {/* Detail modal */}
      {detail && (
        <EventDetailView detail={detail} canManage={canManage} onClose={() => setDetail(null)} request={request} refresh={refreshDetail} reload={load} />
      )}
    </AppShell>
  )
}

const inputCls = 'w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-2"><label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>{children}</div>
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={`bg-white w-full ${wide ? 'max-w-2xl' : 'max-w-sm'} rounded-2xl shadow-xl p-5 my-8`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function EventDetailView({ detail, canManage, onClose, request, refresh, reload }: {
  detail: EventDetail; canManage: boolean; onClose: () => void; request: any; refresh: () => Promise<void>; reload: () => Promise<void>
}) {
  const [addStaffId, setAddStaffId] = useState('')
  const [addRole, setAddRole] = useState('WAITER')
  const [exp, setExp] = useState({ category: 'Transport', description: '', amount: '' })
  const [salesEdit, setSalesEdit] = useState(String(detail.salesTotal || 0))

  const assignedIds = new Set(detail.staff.map((s) => s.staffId))
  const available = detail.allStaff.filter((s) => !assignedIds.has(s.id))

  const api = async (fn: () => Promise<unknown>, after: () => Promise<void> = refresh) => {
    try { await fn(); await after() } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const setStatus = (status: string) => api(() => request(`/api/events/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }), async () => { await refresh(); await reload() })
  const saveSales = () => api(() => request(`/api/events/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ salesTotal: Number(salesEdit) || 0 }) }), async () => { await refresh(); await reload() })
  const addStaff = () => { if (!addStaffId) return toast.error('Pick a staff member'); api(async () => { const r = await request(`/api/events/${detail.id}/staff`, { method: 'POST', body: JSON.stringify({ staffId: addStaffId, role: addRole }) }); if (r.removedShifts) toast.success(`Assigned — removed ${r.removedShifts} roster shift(s)`); setAddStaffId('') }) }
  const updateStaff = (assignId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/staff`, { method: 'PATCH', body: JSON.stringify({ assignId, ...patch }) }))
  const removeStaff = (assignId: string) => api(() => request(`/api/events/${detail.id}/staff?assignId=${assignId}`, { method: 'DELETE' }))
  const addExpense = () => { if (!(Number(exp.amount) > 0)) return toast.error('Enter an amount'); api(async () => { await request(`/api/events/${detail.id}/expenses`, { method: 'POST', body: JSON.stringify({ ...exp, amount: Number(exp.amount) }) }); setExp({ category: 'Transport', description: '', amount: '' }) }, async () => { await refresh(); await reload() }) }
  const removeExpense = (expenseId: string) => api(() => request(`/api/events/${detail.id}/expenses?expenseId=${expenseId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })
  const deleteEvent = async () => { if (!confirm(`Delete event "${detail.name}"? This cannot be undone.`)) return; try { await request(`/api/events/${detail.id}`, { method: 'DELETE' }); toast.success('Event deleted'); onClose(); await reload() } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') } }

  const r = detail.report

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-3xl rounded-2xl shadow-xl p-5 my-8 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{detail.name}</h2>
            <p className="text-sm text-gray-500">{detail.clientName || 'No client'} · {format(parseISO(detail.date), 'EEEE dd MMM yyyy')}{detail.startTime ? ` · ${detail.startTime}${detail.endTime ? `–${detail.endTime}` : ''}` : ''}</p>
            {detail.location && <p className="text-xs text-gray-400">📍 {detail.location} · {detail.expectedGuests} guests expected</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>

        {/* Status */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">Status:</span>
          {STATUSES.map((s) => (
            <button key={s} disabled={!canManage} onClick={() => setStatus(s)} className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition disabled:opacity-60 ${detail.status === s ? STATUS_CHIP[s] + ' ring-2 ring-offset-1 ring-indigo-300' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>{s}</button>
          ))}
        </div>

        {/* Financials */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <div className="text-[11px] text-gray-500 flex items-center gap-1"><Wallet className="w-3 h-3" />Event Sales</div>
            {canManage ? (
              <div className="flex gap-1 mt-1">
                <input value={salesEdit} onChange={(e) => setSalesEdit(e.target.value)} className="w-full px-2 py-1 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                <button onClick={saveSales} className="px-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold">Save</button>
              </div>
            ) : <div className="text-lg font-bold text-gray-900">{formatCurrency(r.salesTotal)}</div>}
          </Card>
          <Card><div className="text-[11px] text-gray-500">Expenses</div><div className="text-lg font-bold text-red-600">{formatCurrency(r.totalExpenses)}</div></Card>
          <Card><div className="text-[11px] text-gray-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" />Profit</div><div className={`text-lg font-bold ${r.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(r.profit)}</div></Card>
          <Card><div className="text-[11px] text-gray-500">Margin</div><div className="text-lg font-bold text-gray-900">{r.margin}%</div></Card>
        </div>

        {/* Staff */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center gap-2"><Users className="w-4 h-4" />Staff ({r.attended}/{r.staffCount} attended) · {formatCurrency(r.staffSales)} attributed sales</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Staff</th><th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-center">Attended</th><th className="px-3 py-2 text-right">Sales</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.staff.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{s.staffName}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={s.role} onChange={(e) => updateStaff(s.id, { role: e.target.value })} className="px-2 py-1 border border-gray-200 rounded-lg text-xs">
                          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      ) : s.role}
                    </td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={s.attended} disabled={!canManage} onChange={(e) => updateStaff(s.id, { attended: e.target.checked })} className="w-4 h-4 accent-indigo-600" /></td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? (
                        <input defaultValue={s.salesAttributed || ''} onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== s.salesAttributed) updateStaff(s.id, { salesAttributed: v }) }} placeholder="0" className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
                      ) : formatCurrency(s.salesAttributed)}
                    </td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeStaff(s.id)} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button></td>}
                  </tr>
                ))}
                {detail.staff.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="px-3 py-4 text-center text-gray-400 text-xs">No staff assigned yet</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <select value={addStaffId} onChange={(e) => setAddStaffId(e.target.value)} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                <option value="">Add staff…</option>
                {available.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role})</option>)}
              </select>
              <select value={addRole} onChange={(e) => setAddRole(e.target.value)} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
              <button onClick={addStaff} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Assign</button>
              <span className="text-[11px] text-gray-400">Assigning removes the staffer from their regular roster that day.</span>
            </div>
          )}
        </Card>

        {/* Expenses */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm">Expenses</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-50">
                {detail.expenses.map((x) => (
                  <tr key={x.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{x.category}</td>
                    <td className="px-3 py-2 text-gray-500">{x.description || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(x.amount)}</td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeExpense(x.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.expenses.length === 0 && <tr><td colSpan={canManage ? 4 : 3} className="px-3 py-4 text-center text-gray-400 text-xs">No expenses recorded</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} placeholder="Description" className="flex-1 min-w-[120px] px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input type="number" min={0} value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} placeholder="Amount" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addExpense} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add</button>
            </div>
          )}
        </Card>

        {/* Footer actions */}
        <div className="flex items-center gap-2">
          <ExportBar
            rows={detail.staff.map((s) => ({ Event: detail.name, Date: format(parseISO(detail.date), 'dd MMM yyyy'), Staff: s.staffName, Role: s.role, Attended: s.attended ? 'Yes' : 'No', 'Sales Attributed': s.salesAttributed }))}
            filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}`}
            title={`Event Report — ${detail.name}`}
          />
          {canManage && <button onClick={deleteEvent} className="ml-auto flex items-center gap-1.5 px-3 py-2 text-red-600 text-sm font-semibold hover:bg-red-50 rounded-xl transition"><Trash2 className="w-4 h-4" />Delete event</button>}
        </div>
      </div>
    </div>
  )
}
