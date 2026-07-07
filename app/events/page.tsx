'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/Card'
import { NumberField, InlineNumberField } from '@/components/ui/NumberField'
import { ExportBar } from '@/components/ExportBar'
import { formatCurrency, STATUS_COLORS } from '@/lib/utils'
import { EVENT_TYPES, EVENT_EXPENSE_CATEGORIES, EXPENSE_PAYMENT_STATUSES, SPONSORSHIP_TYPES, SPONSOR_AGREEMENT_STATUSES, EVENT_TARGET_TYPES } from '@/lib/scheduling'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { PartyPopper, Plus, X, Trash2, Users, Wallet, TrendingUp, Gift, Package, Target, Ticket, Armchair, Copy, Pencil } from 'lucide-react'

const MANAGE_ROLES = ['MANAGER', 'DIRECTOR', 'ADMIN']
const STATUSES = ['PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED']
const ROLES = ['SUPERVISOR', 'WAITER', 'BARTENDER', 'CASHIER', 'HOSTESS']
const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED']
const TABLE_STATUSES = ['AVAILABLE', 'RESERVED', 'OCCUPIED']
const BOOKING_STATUS_CHIP: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600', CONFIRMED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-red-100 text-red-700',
}
const TABLE_STATUS_CHIP: Record<string, string> = {
  AVAILABLE: 'bg-green-100 text-green-700', RESERVED: 'bg-yellow-100 text-yellow-700', OCCUPIED: 'bg-red-100 text-red-700',
}
const STATUS_CHIP: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-700', CONFIRMED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-700',
}
const AGREEMENT_CHIP: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600', SIGNED: 'bg-blue-100 text-blue-700', FULFILLED: 'bg-green-100 text-green-700',
}

interface EventRow { id: string; name: string; clientName?: string; location?: string; date: string; startTime?: string; endTime?: string; expectedGuests: number; status: string; salesTotal: number; totalExpenses: number; profit: number; staffCount: number; attendedCount: number }
interface StaffLite { id: string; name: string; role: string }
interface ProductLite { id: string; name: string; category?: string; sellingPrice: number; unitMeasure: string }
interface EventStaff { id: string; staffId: string; staffName: string; role: string; attended: boolean; salesAttributed: number; performanceNote?: string }
interface EventExpense { id: string; category: string; description?: string; estimatedCost: number; amount: number; supplier?: string; paymentStatus: string }
interface EventSponsor { id: string; sponsorName: string; contactPerson?: string; phone?: string; email?: string; sponsorshipType: string; sponsorshipValue: number; itemsProvided?: string; agreementStatus: string; notes?: string }
interface EventProductRow { id: string; productId: string; productName: string; eventPrice?: number | null; expectedQuantity: number; procurementQuantity: number; stockAllocated: number; stockReturned: number; quantitySold: number; product?: { category?: string; sellingPrice: number } }
interface EventTargetRow { id: string; type: string; name: string; targetValue: number; actualValue: number; unit?: string; achievementPct: number; shortage: number; surplus: number }
interface TicketTypeRow { id: string; name: string; price: number; quantityAvailable?: number | null }
interface TicketBookingRow { id: string; ticketTypeId: string; bookingNumber: string; fullName: string; phone: string; email?: string; quantity: number; totalAmount: number; paymentStatus: string; bookingStatus: string; checkedIn: boolean }
interface EventTableRow { id: string; name: string; tableType?: string; capacity: number; price: number; status: string }
interface TableBookingRow { id: string; tableId: string; bookingNumber: string; name: string; phone: string; guests: number; totalAmount: number; depositPaid: number; specialRequests?: string; bookingStatus: string }
interface EventDetail extends EventRow {
  description?: string; eventType?: string; notes?: string
  staff: EventStaff[]; expenses: EventExpense[]; sponsors: EventSponsor[]; products: EventProductRow[]; targets: EventTargetRow[]
  ticketTypes: TicketTypeRow[]; tickets: TicketBookingRow[]; tables: EventTableRow[]; tableBookings: TableBookingRow[]
  allStaff: StaffLite[]; allProducts: ProductLite[]
  report: {
    salesTotal: number; manualSalesTotal: number; posSalesTotal: number; posOrderCount: number
    sponsorshipTotal: number; grossRevenue: number; totalExpenses: number; profit: number; margin: number; staffCount: number; attended: number; staffSales: number
    budget: { totalEstimated: number; totalActual: number; variance: number }
    tickets: { sold: number; remaining: number | null; revenue: number; checkedIn: number; noShows: number }
    tables: { available: number; reserved: number; occupied: number; totalDeposits: number; totalBalance: number }
  }
}

const EMPTY_FORM = { name: '', description: '', eventType: '', clientName: '', location: '', date: format(new Date(), 'yyyy-MM-dd'), startTime: '', endTime: '', expectedGuests: '', notes: '' }

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
            <Field label="Event type">
              <select value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })} className={inputCls}>
                <option value="">Select type…</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Client"><input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className={inputCls} /></Field>
            <Field label="Date *"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} /></Field>
            <Field label="Location / Venue"><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} /></Field>
            <Field label="Start time"><input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className={inputCls} /></Field>
            <Field label="End time"><input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className={inputCls} /></Field>
            <Field label="Expected guests"><NumberField value={form.expectedGuests} onChange={(v) => setForm({ ...form, expectedGuests: v })} className={inputCls} /></Field>
          </div>
          <Field label="Description"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} /></Field>
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
  const [exp, setExp] = useState({ category: EVENT_EXPENSE_CATEGORIES[0] as string, description: '', estimatedCost: '', amount: '', supplier: '', paymentStatus: 'UNPAID' as string })
  const [sponsor, setSponsor] = useState({ sponsorName: '', contactPerson: '', phone: '', email: '', sponsorshipType: 'CASH' as string, sponsorshipValue: '', itemsProvided: '', agreementStatus: 'PENDING' as string })
  const [addProductId, setAddProductId] = useState('')
  const [productForm, setProductForm] = useState({ eventPrice: '', expectedQuantity: '', procurementQuantity: '' })
  const [target, setTarget] = useState({ type: 'SALES' as string, name: '', targetValue: '', unit: '' })
  const [ticketType, setTicketType] = useState({ name: '', price: '', quantityAvailable: '' })
  const [table, setTable] = useState({ name: '', tableType: '', capacity: '4', price: '' })
  const [salesEdit, setSalesEdit] = useState(String(detail.salesTotal || 0))
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({
    name: detail.name, eventType: detail.eventType || '', clientName: detail.clientName || '',
    date: format(parseISO(detail.date), 'yyyy-MM-dd'), location: detail.location || '',
    startTime: detail.startTime || '', endTime: detail.endTime || '',
    expectedGuests: String(detail.expectedGuests || ''), description: detail.description || '', notes: detail.notes || '',
  })

  const assignedIds = new Set(detail.staff.map((s) => s.staffId))
  const available = detail.allStaff.filter((s) => !assignedIds.has(s.id))
  const authorizedIds = new Set(detail.products.map((p) => p.productId))
  const availableProducts = detail.allProducts.filter((p) => !authorizedIds.has(p.id))

  const api = async (fn: () => Promise<unknown>, after: () => Promise<void> = refresh) => {
    try { await fn(); await after() } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') }
  }

  const setStatus = (status: string) => api(() => request(`/api/events/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }), async () => { await refresh(); await reload() })
  const saveSales = () => api(() => request(`/api/events/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ salesTotal: Number(salesEdit) || 0 }) }), async () => { await refresh(); await reload() })
  const addStaff = () => { if (!addStaffId) return toast.error('Pick a staff member'); api(async () => { const r = await request(`/api/events/${detail.id}/staff`, { method: 'POST', body: JSON.stringify({ staffId: addStaffId, role: addRole }) }); if (r.removedShifts) toast.success(`Assigned — removed ${r.removedShifts} roster shift(s)`); setAddStaffId('') }) }
  const updateStaff = (assignId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/staff`, { method: 'PATCH', body: JSON.stringify({ assignId, ...patch }) }))
  const removeStaff = (assignId: string) => api(() => request(`/api/events/${detail.id}/staff?assignId=${assignId}`, { method: 'DELETE' }))

  const addExpense = () => {
    if (!(Number(exp.amount) > 0) && !(Number(exp.estimatedCost) > 0)) return toast.error('Enter an estimated or actual amount')
    api(async () => {
      await request(`/api/events/${detail.id}/expenses`, { method: 'POST', body: JSON.stringify({ ...exp, estimatedCost: Number(exp.estimatedCost) || 0, amount: Number(exp.amount) || 0 }) })
      setExp({ category: EVENT_EXPENSE_CATEGORIES[0], description: '', estimatedCost: '', amount: '', supplier: '', paymentStatus: 'UNPAID' })
    }, async () => { await refresh(); await reload() })
  }
  const updateExpense = (expenseId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/expenses`, { method: 'PATCH', body: JSON.stringify({ expenseId, ...patch }) }), async () => { await refresh(); await reload() })
  const removeExpense = (expenseId: string) => api(() => request(`/api/events/${detail.id}/expenses?expenseId=${expenseId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })

  const addSponsor = () => {
    if (!sponsor.sponsorName.trim()) return toast.error('Sponsor name is required')
    api(async () => {
      await request(`/api/events/${detail.id}/sponsors`, { method: 'POST', body: JSON.stringify({ ...sponsor, sponsorshipValue: Number(sponsor.sponsorshipValue) || 0 }) })
      setSponsor({ sponsorName: '', contactPerson: '', phone: '', email: '', sponsorshipType: 'CASH', sponsorshipValue: '', itemsProvided: '', agreementStatus: 'PENDING' })
    }, async () => { await refresh(); await reload() })
  }
  const updateSponsor = (sponsorId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/sponsors`, { method: 'PATCH', body: JSON.stringify({ sponsorId, ...patch }) }), async () => { await refresh(); await reload() })
  const removeSponsor = (sponsorId: string) => api(() => request(`/api/events/${detail.id}/sponsors?sponsorId=${sponsorId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })

  const addProduct = () => {
    if (!addProductId) return toast.error('Pick a product')
    api(async () => {
      await request(`/api/events/${detail.id}/products`, {
        method: 'POST',
        body: JSON.stringify({ productId: addProductId, eventPrice: productForm.eventPrice, expectedQuantity: Number(productForm.expectedQuantity) || 0, procurementQuantity: Number(productForm.procurementQuantity) || 0 }),
      })
      setAddProductId(''); setProductForm({ eventPrice: '', expectedQuantity: '', procurementQuantity: '' })
    })
  }
  const updateProduct = (eventProductId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/products`, { method: 'PATCH', body: JSON.stringify({ eventProductId, ...patch }) }))
  const removeProduct = (eventProductId: string) => api(() => request(`/api/events/${detail.id}/products?eventProductId=${eventProductId}`, { method: 'DELETE' }))

  const addTarget = () => {
    if (!target.name.trim()) return toast.error('Target name is required')
    api(async () => {
      await request(`/api/events/${detail.id}/targets`, { method: 'POST', body: JSON.stringify({ ...target, targetValue: Number(target.targetValue) || 0 }) })
      setTarget({ type: 'SALES', name: '', targetValue: '', unit: '' })
    })
  }
  const updateTarget = (targetId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/targets`, { method: 'PATCH', body: JSON.stringify({ targetId, ...patch }) }))
  const removeTarget = (targetId: string) => api(() => request(`/api/events/${detail.id}/targets?targetId=${targetId}`, { method: 'DELETE' }))

  const addTicketType = () => {
    if (!ticketType.name.trim()) return toast.error('Ticket type name is required')
    api(async () => {
      await request(`/api/events/${detail.id}/ticket-types`, { method: 'POST', body: JSON.stringify({ ...ticketType, price: Number(ticketType.price) || 0, quantityAvailable: ticketType.quantityAvailable === '' ? null : Number(ticketType.quantityAvailable) }) })
      setTicketType({ name: '', price: '', quantityAvailable: '' })
    }, async () => { await refresh(); await reload() })
  }
  const removeTicketType = (ticketTypeId: string) => api(() => request(`/api/events/${detail.id}/ticket-types?ticketTypeId=${ticketTypeId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })
  const updateTicketBooking = (bookingId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/tickets`, { method: 'PATCH', body: JSON.stringify({ bookingId, ...patch }) }), async () => { await refresh(); await reload() })
  const cancelTicketBooking = (bookingId: string) => api(() => request(`/api/events/${detail.id}/tickets?bookingId=${bookingId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })

  const addTable = () => {
    if (!table.name.trim()) return toast.error('Table name is required')
    api(async () => {
      await request(`/api/events/${detail.id}/tables`, { method: 'POST', body: JSON.stringify({ ...table, capacity: Number(table.capacity) || 4, price: Number(table.price) || 0 }) })
      setTable({ name: '', tableType: '', capacity: '4', price: '' })
    }, async () => { await refresh(); await reload() })
  }
  const updateTableStatus = (tableId: string, status: string) => api(() => request(`/api/events/${detail.id}/tables`, { method: 'PATCH', body: JSON.stringify({ tableId, status }) }), async () => { await refresh(); await reload() })
  const removeTable = (tableId: string) => api(() => request(`/api/events/${detail.id}/tables?tableId=${tableId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })
  const updateTableBooking = (bookingId: string, patch: Record<string, unknown>) => api(() => request(`/api/events/${detail.id}/table-bookings`, { method: 'PATCH', body: JSON.stringify({ bookingId, ...patch }) }), async () => { await refresh(); await reload() })
  const cancelTableBooking = (bookingId: string) => api(() => request(`/api/events/${detail.id}/table-bookings?bookingId=${bookingId}`, { method: 'DELETE' }), async () => { await refresh(); await reload() })

  const copyBookingLink = () => { navigator.clipboard.writeText(`${window.location.origin}/book/${detail.id}`); toast.success('Booking link copied') }

  // Re-sync the edit form from the latest detail each time it's opened —
  // detail can change from under us (e.g. another admin's edit, or our own
  // refresh() after some other action) while this modal stays mounted.
  const openEdit = () => {
    setEditForm({
      name: detail.name, eventType: detail.eventType || '', clientName: detail.clientName || '',
      date: format(parseISO(detail.date), 'yyyy-MM-dd'), location: detail.location || '',
      startTime: detail.startTime || '', endTime: detail.endTime || '',
      expectedGuests: String(detail.expectedGuests || ''), description: detail.description || '', notes: detail.notes || '',
    })
    setEditOpen(true)
  }
  const saveEventDetails = () => {
    if (!editForm.name.trim()) return toast.error('Event name is required')
    api(async () => {
      await request(`/api/events/${detail.id}`, { method: 'PATCH', body: JSON.stringify({ ...editForm, expectedGuests: Number(editForm.expectedGuests) || 0 }) })
      setEditOpen(false)
      toast.success('Event details updated')
    }, async () => { await refresh(); await reload() })
  }

  const deleteEvent = async () => { if (!confirm(`Delete event "${detail.name}"? This cannot be undone.`)) return; try { await request(`/api/events/${detail.id}`, { method: 'DELETE' }); toast.success('Event deleted'); onClose(); await reload() } catch (err) { toast.error(err instanceof Error ? err.message : 'Error') } }

  const r = detail.report
  const salesTargets = detail.targets.filter((t) => t.type === 'SALES')
  const procurementTargets = detail.targets.filter((t) => t.type === 'PROCUREMENT')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-3xl rounded-2xl shadow-xl p-5 my-8 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900">{detail.name}</h2>
              {detail.eventType && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{detail.eventType}</span>}
            </div>
            <p className="text-sm text-gray-500">{detail.clientName || 'No client'} · {format(parseISO(detail.date), 'EEEE dd MMM yyyy')}{detail.startTime ? ` · ${detail.startTime}${detail.endTime ? `–${detail.endTime}` : ''}` : ''}</p>
            {detail.location && <p className="text-xs text-gray-400">📍 {detail.location} · {detail.expectedGuests} guests expected</p>}
            {detail.description && <p className="text-xs text-gray-500 mt-1">{detail.description}</p>}
            {canManage && (
              <div className="flex items-center gap-3 mt-1.5">
                <button onClick={openEdit} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  <Pencil className="w-3 h-3" />Edit details
                </button>
                <button onClick={copyBookingLink} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
                  <Copy className="w-3 h-3" />Copy public booking link
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>

        {/* Edit event details */}
        {editOpen && (
          <Modal title="Edit event details" onClose={() => setEditOpen(false)} wide>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Event name *"><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inputCls} /></Field>
              <Field label="Event type">
                <select value={editForm.eventType} onChange={(e) => setEditForm({ ...editForm, eventType: e.target.value })} className={inputCls}>
                  <option value="">Select type…</option>
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Client"><input value={editForm.clientName} onChange={(e) => setEditForm({ ...editForm, clientName: e.target.value })} className={inputCls} /></Field>
              <Field label="Date *"><input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} className={inputCls} /></Field>
              <Field label="Location / Venue"><input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className={inputCls} /></Field>
              <Field label="Start time"><input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} className={inputCls} /></Field>
              <Field label="End time"><input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} className={inputCls} /></Field>
              <Field label="Expected guests"><NumberField value={editForm.expectedGuests} onChange={(v) => setEditForm({ ...editForm, expectedGuests: v })} className={inputCls} /></Field>
            </div>
            <Field label="Description"><textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={2} className={inputCls} /></Field>
            <Field label="Notes"><textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className={inputCls} /></Field>
            <button onClick={saveEventDetails} className="w-full mt-2 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">Save changes</button>
          </Modal>
        )}

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
            {r.posOrderCount > 0 ? (
              <>
                <div className="text-lg font-bold text-gray-900">{formatCurrency(r.posSalesTotal)}</div>
                <div className="text-[10px] text-gray-400">auto from {r.posOrderCount} POS order{r.posOrderCount === 1 ? '' : 's'}</div>
              </>
            ) : canManage ? (
              <div className="flex gap-1 mt-1">
                <NumberField value={salesEdit} onChange={setSalesEdit} className="w-full px-2 py-1 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                <button onClick={saveSales} className="px-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold">Save</button>
              </div>
            ) : <div className="text-lg font-bold text-gray-900">{formatCurrency(r.salesTotal)}</div>}
          </Card>
          <Card><div className="text-[11px] text-gray-500 flex items-center gap-1"><Gift className="w-3 h-3" />Sponsorship</div><div className="text-lg font-bold text-gray-900">{formatCurrency(r.sponsorshipTotal)}</div></Card>
          <Card><div className="text-[11px] text-gray-500">Gross Revenue</div><div className="text-lg font-bold text-gray-900">{formatCurrency(r.grossRevenue)}</div></Card>
          <Card><div className="text-[11px] text-gray-500">Actual Expenses</div><div className="text-lg font-bold text-red-600">{formatCurrency(r.totalExpenses)}</div></Card>
          <Card><div className="text-[11px] text-gray-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" />Net Profit</div><div className={`text-lg font-bold ${r.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(r.profit)}</div></Card>
          <Card><div className="text-[11px] text-gray-500">Margin</div><div className="text-lg font-bold text-gray-900">{r.margin}%</div></Card>
          <Card><div className="text-[11px] text-gray-500">Budget (Est. vs Actual)</div><div className="text-sm font-semibold text-gray-800">{formatCurrency(r.budget.totalEstimated)} vs {formatCurrency(r.budget.totalActual)}</div></Card>
          <Card><div className="text-[11px] text-gray-500">Budget Variance</div><div className={`text-lg font-bold ${r.budget.variance >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(r.budget.variance)}</div></Card>
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
                        <InlineNumberField key={`${s.id}-${s.salesAttributed}`} defaultValue={s.salesAttributed} onCommit={(v) => { const n = Number(v) || 0; if (n !== s.salesAttributed) updateStaff(s.id, { salesAttributed: n }) }} placeholder="0" className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
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

        {/* Budget / Cost lines */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center justify-between">
            <span>Budget & Costs</span>
            <ExportBar
              rows={detail.expenses.map((x) => ({ Category: x.category, Description: x.description || '', Estimated: x.estimatedCost, Actual: x.amount, Variance: x.estimatedCost - x.amount, Supplier: x.supplier || '', 'Payment Status': x.paymentStatus }))}
              filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}-budget`}
              title={`Budget Variance Report — ${detail.name}`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Category</th><th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Estimated</th><th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-left">Supplier</th><th className="px-3 py-2 text-left">Payment</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.expenses.map((x) => (
                  <tr key={x.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-700">{x.category}</td>
                    <td className="px-3 py-2 text-gray-500">{x.description || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600">
                      {canManage ? (
                        <InlineNumberField key={`${x.id}-est-${x.estimatedCost}`} defaultValue={x.estimatedCost} onCommit={(v) => updateExpense(x.id, { estimatedCost: Number(v) || 0 })} className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
                      ) : formatCurrency(x.estimatedCost)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">
                      {canManage ? (
                        <InlineNumberField key={`${x.id}-act-${x.amount}`} defaultValue={x.amount} onCommit={(v) => updateExpense(x.id, { amount: Number(v) || 0 })} className="w-24 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
                      ) : formatCurrency(x.amount)}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{x.supplier || '—'}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={x.paymentStatus} onChange={(e) => updateExpense(x.id, { paymentStatus: e.target.value })} className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border-0 ${STATUS_COLORS[x.paymentStatus] || ''}`}>
                          {EXPENSE_PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${STATUS_COLORS[x.paymentStatus] || ''}`}>{x.paymentStatus}</span>}
                    </td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeExpense(x.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.expenses.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-4 text-center text-gray-400 text-xs">No budget lines recorded</td></tr>}
              </tbody>
              {detail.expenses.length > 0 && (
                <tfoot><tr className="bg-gray-50 font-semibold text-gray-800">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.budget.totalEstimated)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.budget.totalActual)}</td>
                  <td className="px-3 py-2" colSpan={canManage ? 3 : 2}>Variance: <span className={r.budget.variance >= 0 ? 'text-green-700' : 'text-red-600'}>{formatCurrency(r.budget.variance)}</span></td>
                </tr></tfoot>
              )}
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {EVENT_EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} placeholder="Description" className="flex-1 min-w-[100px] px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={exp.estimatedCost} onChange={(v) => setExp({ ...exp, estimatedCost: v })} placeholder="Estimated" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={exp.amount} onChange={(v) => setExp({ ...exp, amount: v })} placeholder="Actual" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={exp.supplier} onChange={(e) => setExp({ ...exp, supplier: e.target.value })} placeholder="Supplier" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <select value={exp.paymentStatus} onChange={(e) => setExp({ ...exp, paymentStatus: e.target.value })} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {EXPENSE_PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button onClick={addExpense} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add</button>
            </div>
          )}
        </Card>

        {/* Sponsors */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Gift className="w-4 h-4" />Sponsors · {formatCurrency(r.sponsorshipTotal)} total</span>
            <ExportBar
              rows={detail.sponsors.map((s) => ({ Sponsor: s.sponsorName, Contact: s.contactPerson || '', Phone: s.phone || '', Type: s.sponsorshipType, Value: s.sponsorshipValue, 'Items/Services': s.itemsProvided || '', Agreement: s.agreementStatus }))}
              filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}-sponsors`}
              title={`Sponsors Report — ${detail.name}`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Sponsor</th><th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Value</th>
                <th className="px-3 py-2 text-left">Agreement</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.sponsors.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{s.sponsorName}</td>
                    <td className="px-3 py-2 text-gray-500">{s.contactPerson || '—'}{s.phone ? ` · ${s.phone}` : ''}</td>
                    <td className="px-3 py-2 text-gray-600">{s.sponsorshipType}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(s.sponsorshipValue)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={s.agreementStatus} onChange={(e) => updateSponsor(s.id, { agreementStatus: e.target.value })} className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border-0 ${AGREEMENT_CHIP[s.agreementStatus] || ''}`}>
                          {SPONSOR_AGREEMENT_STATUSES.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      ) : <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${AGREEMENT_CHIP[s.agreementStatus] || ''}`}>{s.agreementStatus}</span>}
                    </td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeSponsor(s.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.sponsors.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-4 text-center text-gray-400 text-xs">No sponsors recorded</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <input value={sponsor.sponsorName} onChange={(e) => setSponsor({ ...sponsor, sponsorName: e.target.value })} placeholder="Sponsor name" className="w-36 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={sponsor.contactPerson} onChange={(e) => setSponsor({ ...sponsor, contactPerson: e.target.value })} placeholder="Contact person" className="w-32 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={sponsor.phone} onChange={(e) => setSponsor({ ...sponsor, phone: e.target.value })} placeholder="Phone" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <select value={sponsor.sponsorshipType} onChange={(e) => setSponsor({ ...sponsor, sponsorshipType: e.target.value })} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {SPONSORSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <NumberField value={sponsor.sponsorshipValue} onChange={(v) => setSponsor({ ...sponsor, sponsorshipValue: v })} placeholder="Value" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={sponsor.itemsProvided} onChange={(e) => setSponsor({ ...sponsor, itemsProvided: e.target.value })} placeholder="Items/services" className="flex-1 min-w-[100px] px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addSponsor} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add</button>
            </div>
          )}
        </Card>

        {/* Authorized Products */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center gap-2"><Package className="w-4 h-4" />Authorized Products</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Product</th><th className="px-3 py-2 text-right">Event Price</th>
                <th className="px-3 py-2 text-right">Expected Qty</th><th className="px-3 py-2 text-right">Procurement Qty</th>
                <th className="px-3 py-2 text-right">Stock Alloc.</th><th className="px-3 py-2 text-right">Stock Ret.</th>
                <th className="px-3 py-2 text-right">Qty Sold</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.products.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-800">{p.productName}{p.product?.category ? <span className="text-gray-400 text-xs"> · {p.product.category}</span> : ''}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? (
                        <InlineNumberField key={`${p.id}-price-${p.eventPrice}`} defaultValue={p.eventPrice ?? ''} placeholder={String(p.product?.sellingPrice ?? '')} onCommit={(v) => updateProduct(p.id, { eventPrice: v })} className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
                      ) : formatCurrency(p.eventPrice ?? p.product?.sellingPrice ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? <InlineNumberField key={`${p.id}-exp-${p.expectedQuantity}`} defaultValue={p.expectedQuantity} onCommit={(v) => updateProduct(p.id, { expectedQuantity: Number(v) || 0 })} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : p.expectedQuantity}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? <InlineNumberField key={`${p.id}-proc-${p.procurementQuantity}`} defaultValue={p.procurementQuantity} onCommit={(v) => updateProduct(p.id, { procurementQuantity: Number(v) || 0 })} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : p.procurementQuantity}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? <InlineNumberField key={`${p.id}-alloc-${p.stockAllocated}`} defaultValue={p.stockAllocated} onCommit={(v) => updateProduct(p.id, { stockAllocated: Number(v) || 0 })} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : p.stockAllocated}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? <InlineNumberField key={`${p.id}-ret-${p.stockReturned}`} defaultValue={p.stockReturned} onCommit={(v) => updateProduct(p.id, { stockReturned: Number(v) || 0 })} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : p.stockReturned}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? <InlineNumberField key={`${p.id}-sold-${p.quantitySold}`} defaultValue={p.quantitySold} onCommit={(v) => updateProduct(p.id, { quantitySold: Number(v) || 0 })} className="w-16 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : p.quantitySold}
                    </td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeProduct(p.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.products.length === 0 && <tr><td colSpan={canManage ? 8 : 7} className="px-3 py-4 text-center text-gray-400 text-xs">No authorized products yet</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <select value={addProductId} onChange={(e) => setAddProductId(e.target.value)} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                <option value="">Authorize product…</option>
                {availableProducts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.category ? ` (${p.category})` : ''}</option>)}
              </select>
              <NumberField value={productForm.eventPrice} onChange={(v) => setProductForm({ ...productForm, eventPrice: v })} placeholder="Event price" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={productForm.expectedQuantity} onChange={(v) => setProductForm({ ...productForm, expectedQuantity: v })} placeholder="Expected qty" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={productForm.procurementQuantity} onChange={(v) => setProductForm({ ...productForm, procurementQuantity: v })} placeholder="Procurement qty" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addProduct} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Authorize</button>
            </div>
          )}
        </Card>

        {/* Targets */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Target className="w-4 h-4" />Sales & Procurement Targets</span>
            <ExportBar
              rows={detail.targets.map((t) => ({ Type: t.type, Target: t.name, 'Target Value': t.targetValue, 'Actual Value': t.actualValue, Unit: t.unit || '', 'Achievement %': t.achievementPct, Shortage: t.shortage, Surplus: t.surplus }))}
              filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}-targets`}
              title={`Targets Achievement Report — ${detail.name}`}
            />
          </div>
          {[{ label: 'Sales Targets', rows: salesTargets }, { label: 'Procurement Targets', rows: procurementTargets }].map(({ label, rows }) => (
            <div key={label} className="overflow-x-auto">
              <div className="px-3 pt-3 text-xs font-semibold text-gray-500">{label}</div>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-right">Target Value</th>
                  <th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Achievement</th>
                  <th className="px-3 py-2 text-right">Shortage/Surplus</th>
                  {canManage && <th className="px-3 py-2"></th>}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-800">{t.name}{t.unit ? <span className="text-gray-400 text-xs"> ({t.unit})</span> : ''}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{t.targetValue.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        {canManage ? <InlineNumberField key={`${t.id}-${t.actualValue}`} defaultValue={t.actualValue} onCommit={(v) => updateTarget(t.id, { actualValue: Number(v) || 0 })} className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" /> : t.actualValue.toLocaleString()}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold ${t.achievementPct >= 100 ? 'text-green-700' : 'text-red-600'}`}>{t.achievementPct}%</td>
                      <td className="px-3 py-2 text-right">{t.surplus > 0 ? <span className="text-green-700">+{t.surplus.toLocaleString()}</span> : t.shortage > 0 ? <span className="text-red-600">-{t.shortage.toLocaleString()}</span> : '—'}</td>
                      {canManage && <td className="px-3 py-2 text-right"><button onClick={() => removeTarget(t.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="px-3 py-3 text-center text-gray-400 text-xs">No {label.toLowerCase()} set</td></tr>}
                </tbody>
              </table>
            </div>
          ))}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <select value={target.type} onChange={(e) => setTarget({ ...target, type: e.target.value })} className="px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none">
                {EVENT_TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input value={target.name} onChange={(e) => setTarget({ ...target, name: e.target.value })} placeholder="Target name (e.g. Revenue Target)" className="flex-1 min-w-[140px] px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={target.targetValue} onChange={(v) => setTarget({ ...target, targetValue: v })} placeholder="Target value" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={target.unit} onChange={(e) => setTarget({ ...target, unit: e.target.value })} placeholder="Unit" className="w-20 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addTarget} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add</button>
            </div>
          )}
        </Card>

        {/* Ticket Types & Bookings */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Ticket className="w-4 h-4" />Ticket Types & Bookings · {r.tickets.sold} sold{r.tickets.remaining != null ? ` · ${r.tickets.remaining} remaining` : ''} · {formatCurrency(r.tickets.revenue)} revenue · {r.tickets.checkedIn} checked in</span>
            <ExportBar
              rows={detail.tickets.map((t) => ({ Booking: t.bookingNumber, Name: t.fullName, Phone: t.phone, Qty: t.quantity, Amount: t.totalAmount, Payment: t.paymentStatus, Status: t.bookingStatus, 'Checked In': t.checkedIn ? 'Yes' : 'No' }))}
              filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}-tickets`}
              title={`Ticket Report — ${detail.name}`}
            />
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-gray-100">
            {detail.ticketTypes.map((tt) => (
              <span key={tt.id} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-700">
                {tt.name} · {formatCurrency(tt.price)}{tt.quantityAvailable != null ? ` · cap ${tt.quantityAvailable}` : ''}
                {canManage && <button onClick={() => removeTicketType(tt.id)} className="text-gray-400 hover:text-red-600"><X className="w-3 h-3" /></button>}
              </span>
            ))}
            {detail.ticketTypes.length === 0 && <span className="text-xs text-gray-400">No ticket types defined yet</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Booking</th><th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Payment</th><th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-center">Checked In</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{t.bookingNumber}</td>
                    <td className="px-3 py-2"><div className="font-medium text-gray-800">{t.fullName}</div><div className="text-gray-400 text-[11px]">{t.phone}</div></td>
                    <td className="px-3 py-2 text-right">{t.quantity}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(t.totalAmount)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={t.paymentStatus} onChange={(e) => updateTicketBooking(t.id, { paymentStatus: e.target.value })} className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border-0 ${STATUS_COLORS[t.paymentStatus] || ''}`}>
                          {EXPENSE_PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      ) : <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${STATUS_COLORS[t.paymentStatus] || ''}`}>{t.paymentStatus}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={t.bookingStatus} onChange={(e) => updateTicketBooking(t.id, { bookingStatus: e.target.value })} className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border-0 ${BOOKING_STATUS_CHIP[t.bookingStatus] || ''}`}>
                          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${BOOKING_STATUS_CHIP[t.bookingStatus] || ''}`}>{t.bookingStatus}</span>}
                    </td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={t.checkedIn} disabled={!canManage} onChange={(e) => updateTicketBooking(t.id, { checkedIn: e.target.checked })} className="w-4 h-4 accent-indigo-600" /></td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => cancelTicketBooking(t.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.tickets.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-4 text-center text-gray-400 text-xs">No ticket bookings yet</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <input value={ticketType.name} onChange={(e) => setTicketType({ ...ticketType, name: e.target.value })} placeholder="Type name (e.g. VIP)" className="w-32 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={ticketType.price} onChange={(v) => setTicketType({ ...ticketType, price: v })} placeholder="Price" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={ticketType.quantityAvailable} onChange={(v) => setTicketType({ ...ticketType, quantityAvailable: v })} placeholder="Cap (blank = unlimited)" className="w-40 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addTicketType} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add type</button>
            </div>
          )}
        </Card>

        {/* Tables & Table Bookings */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-gray-800 text-sm flex items-center justify-between">
            <span className="flex items-center gap-2"><Armchair className="w-4 h-4" />Tables & Table Bookings · {r.tables.available} available · {r.tables.reserved} reserved · {r.tables.occupied} occupied</span>
            <ExportBar
              rows={detail.tableBookings.map((b) => ({ Booking: b.bookingNumber, Name: b.name, Phone: b.phone, Guests: b.guests, Amount: b.totalAmount, Deposit: b.depositPaid, Balance: b.totalAmount - b.depositPaid, Status: b.bookingStatus }))}
              filename={`event-${detail.name.replace(/\s+/g, '-').toLowerCase()}-tables`}
              title={`Table Report — ${detail.name}`}
            />
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-gray-100">
            {detail.tables.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 rounded-lg text-xs text-gray-700">
                {t.name} · seats {t.capacity} · {formatCurrency(t.price)}
                {canManage ? (
                  <select value={t.status} onChange={(e) => updateTableStatus(t.id, e.target.value)} className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border-0 ${TABLE_STATUS_CHIP[t.status] || ''}`}>
                    {TABLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                ) : <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${TABLE_STATUS_CHIP[t.status] || ''}`}>{t.status}</span>}
                {canManage && <button onClick={() => removeTable(t.id)} className="text-gray-400 hover:text-red-600"><X className="w-3 h-3" /></button>}
              </span>
            ))}
            {detail.tables.length === 0 && <span className="text-xs text-gray-400">No tables defined yet</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                <th className="px-3 py-2 text-left">Booking</th><th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-right">Guests</th><th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Deposit</th><th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {detail.tableBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">{b.bookingNumber}</td>
                    <td className="px-3 py-2"><div className="font-medium text-gray-800">{b.name}</div><div className="text-gray-400 text-[11px]">{b.phone}</div></td>
                    <td className="px-3 py-2 text-right">{b.guests}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(b.totalAmount)}</td>
                    <td className="px-3 py-2 text-right">
                      {canManage ? (
                        <InlineNumberField key={`${b.id}-${b.depositPaid}`} defaultValue={b.depositPaid} onCommit={(v) => updateTableBooking(b.id, { depositPaid: Number(v) || 0 })} className="w-20 px-2 py-1 border border-gray-200 rounded-lg text-xs text-right" />
                      ) : formatCurrency(b.depositPaid)}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(b.totalAmount - b.depositPaid)}</td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <select value={b.bookingStatus} onChange={(e) => updateTableBooking(b.id, { bookingStatus: e.target.value })} className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border-0 ${BOOKING_STATUS_CHIP[b.bookingStatus] || ''}`}>
                          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold ${BOOKING_STATUS_CHIP[b.bookingStatus] || ''}`}>{b.bookingStatus}</span>}
                    </td>
                    {canManage && <td className="px-3 py-2 text-right"><button onClick={() => cancelTableBooking(b.id)} className="text-gray-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button></td>}
                  </tr>
                ))}
                {detail.tableBookings.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="px-3 py-4 text-center text-gray-400 text-xs">No table bookings yet</td></tr>}
              </tbody>
            </table>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <input value={table.name} onChange={(e) => setTable({ ...table, name: e.target.value })} placeholder="Table name" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <input value={table.tableType} onChange={(e) => setTable({ ...table, tableType: e.target.value })} placeholder="Type (e.g. VIP)" className="w-28 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={table.capacity} onChange={(v) => setTable({ ...table, capacity: v })} placeholder="Capacity" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <NumberField value={table.price} onChange={(v) => setTable({ ...table, price: v })} placeholder="Price" className="w-24 px-3 py-1.5 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={addTable} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700">Add table</button>
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
