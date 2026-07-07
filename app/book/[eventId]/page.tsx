'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import toast from 'react-hot-toast'
import { Ticket, Armchair, PartyPopper } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { NumberField } from '@/components/ui/NumberField'

// Deliberately outside AppShell/auth — this is the one page in the app a
// logged-out customer is meant to reach, via a link a manager shares from
// the event detail modal (see the "Copy public booking link" button).

interface PublicTicketType { id: string; name: string; price: number; remaining: number | null }
interface PublicTable { id: string; name: string; tableType?: string; capacity: number; price: number; status: string }
interface PublicEvent { id: string; name: string; description?: string; eventType?: string; location?: string; date: string; startTime?: string; endTime?: string; ticketTypes: PublicTicketType[]; tables: PublicTable[] }
interface BookingResult { booking: { bookingNumber: string; totalAmount?: number; depositPaid?: number }; qrDataUrl: string }

const inputCls = 'w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function PublicBookingPage() {
  const { eventId } = useParams<{ eventId: string }>()
  const [event, setEvent] = useState<PublicEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<'tickets' | 'table'>('tickets')
  const [result, setResult] = useState<BookingResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [ticketForm, setTicketForm] = useState({ ticketTypeId: '', fullName: '', phone: '', email: '', quantity: '1' })
  const [tableForm, setTableForm] = useState({ tableId: '', name: '', phone: '', guests: '2', depositPaid: '', specialRequests: '' })

  useEffect(() => {
    fetch(`/api/public/events/${eventId}`)
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json() })
      .then(setEvent)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [eventId])

  const bookTicket = async () => {
    if (!ticketForm.ticketTypeId) return toast.error('Pick a ticket type')
    if (!ticketForm.fullName.trim() || !ticketForm.phone.trim()) return toast.error('Full name and phone are required')
    setSubmitting(true)
    try {
      const r = await postJson(`/api/public/events/${eventId}/tickets`, { ...ticketForm, quantity: Number(ticketForm.quantity) || 1 })
      setResult(r)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Booking failed') }
    finally { setSubmitting(false) }
  }

  const bookTable = async () => {
    if (!tableForm.tableId) return toast.error('Pick a table')
    if (!tableForm.name.trim() || !tableForm.phone.trim()) return toast.error('Name and phone are required')
    setSubmitting(true)
    try {
      const r = await postJson(`/api/public/events/${eventId}/tables`, { ...tableForm, guests: Number(tableForm.guests) || 1, depositPaid: Number(tableForm.depositPaid) || 0 })
      setResult(r)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Booking failed') }
    finally { setSubmitting(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 p-4">
      <div className="w-full max-w-lg">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white text-center">
            <PartyPopper className="w-10 h-10 mx-auto mb-2" />
            <h1 className="text-2xl font-bold">{loading ? 'Loading…' : event?.name || 'Event booking'}</h1>
            {event && <p className="text-indigo-200 text-sm mt-1">{format(parseISO(event.date), 'EEEE dd MMM yyyy')}{event.startTime ? ` · ${event.startTime}` : ''}{event.location ? ` · ${event.location}` : ''}</p>}
          </div>

          <div className="p-8">
            {loading ? (
              <div className="text-center text-gray-400 py-10">Loading event…</div>
            ) : notFound || !event ? (
              <div className="text-center text-gray-500 py-10">This event isn&apos;t open for booking right now.</div>
            ) : result ? (
              <div className="text-center space-y-4">
                <h2 className="text-lg font-bold text-gray-900">Booking confirmed</h2>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.qrDataUrl} alt="Booking QR code" className="w-40 h-40 mx-auto" />
                <div className="font-mono text-sm text-gray-600">{result.booking.bookingNumber}</div>
                {result.booking.totalAmount !== undefined && <div className="text-sm text-gray-500">Amount due: {formatCurrency(result.booking.totalAmount)}</div>}
                <div className="text-xs text-gray-400 px-4">Booking status: PENDING — you&apos;ll be contacted to confirm payment. Show this QR code / booking number at the door.</div>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mb-6">
                  <button onClick={() => setTab('tickets')} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition ${tab === 'tickets' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}><Ticket className="w-4 h-4" />Buy Tickets</button>
                  <button onClick={() => setTab('table')} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold transition ${tab === 'table' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}><Armchair className="w-4 h-4" />Reserve Table</button>
                </div>

                {tab === 'tickets' ? (
                  <div className="space-y-3">
                    {event.ticketTypes.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No tickets available for this event yet.</p>
                    ) : (
                      <>
                        <select value={ticketForm.ticketTypeId} onChange={(e) => setTicketForm({ ...ticketForm, ticketTypeId: e.target.value })} className={inputCls}>
                          <option value="">Select ticket type…</option>
                          {event.ticketTypes.map((tt) => (
                            <option key={tt.id} value={tt.id} disabled={tt.remaining === 0}>
                              {tt.name} — {formatCurrency(tt.price)}{tt.remaining != null ? ` (${tt.remaining} left)` : ''}
                            </option>
                          ))}
                        </select>
                        <NumberField value={ticketForm.quantity} onChange={(v) => setTicketForm({ ...ticketForm, quantity: v })} placeholder="Number of tickets" className={inputCls} />
                        <input value={ticketForm.fullName} onChange={(e) => setTicketForm({ ...ticketForm, fullName: e.target.value })} placeholder="Full name" className={inputCls} />
                        <input value={ticketForm.phone} onChange={(e) => setTicketForm({ ...ticketForm, phone: e.target.value })} placeholder="Phone number" className={inputCls} />
                        <input value={ticketForm.email} onChange={(e) => setTicketForm({ ...ticketForm, email: e.target.value })} placeholder="Email (optional)" className={inputCls} />
                        <button onClick={bookTicket} disabled={submitting} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">{submitting ? 'Booking…' : 'Book Tickets'}</button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {event.tables.filter((t) => t.status === 'AVAILABLE').length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">No tables available for this event right now.</p>
                    ) : (
                      <>
                        <select value={tableForm.tableId} onChange={(e) => setTableForm({ ...tableForm, tableId: e.target.value })} className={inputCls}>
                          <option value="">Select a table…</option>
                          {event.tables.filter((t) => t.status === 'AVAILABLE').map((t) => (
                            <option key={t.id} value={t.id}>{t.name}{t.tableType ? ` (${t.tableType})` : ''} — seats {t.capacity} — {formatCurrency(t.price)}</option>
                          ))}
                        </select>
                        <NumberField value={tableForm.guests} onChange={(v) => setTableForm({ ...tableForm, guests: v })} placeholder="Number of guests" className={inputCls} />
                        <input value={tableForm.name} onChange={(e) => setTableForm({ ...tableForm, name: e.target.value })} placeholder="Name" className={inputCls} />
                        <input value={tableForm.phone} onChange={(e) => setTableForm({ ...tableForm, phone: e.target.value })} placeholder="Phone number" className={inputCls} />
                        <NumberField value={tableForm.depositPaid} onChange={(v) => setTableForm({ ...tableForm, depositPaid: v })} placeholder="Deposit you're paying (optional)" className={inputCls} />
                        <textarea value={tableForm.specialRequests} onChange={(e) => setTableForm({ ...tableForm, specialRequests: e.target.value })} placeholder="Special requests (optional)" rows={2} className={inputCls} />
                        <button onClick={bookTable} disabled={submitting} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">{submitting ? 'Booking…' : 'Reserve Table'}</button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
