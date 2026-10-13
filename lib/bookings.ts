// Shared booking creation logic for events' ticket & table booking. Called
// from both the public (unauthenticated) booking routes and the admin
// (manual/walk-in) routes so the capacity checks only live in one place.
// Every function here must run inside prisma.$transaction — see callers.
import { randomInt } from 'crypto'
import { format } from 'date-fns'
import { roundMoney } from './utils'

// Unambiguous characters only (no 0/O, 1/I/L) so a number read out over the phone isn't misheard.
const BOOKING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * `TKT|TBL-yyyymmdd-XXXXXXXX`. The suffix is 8 characters from a CSPRNG (~31^8 = 8.5e11 values).
 * It used to be a 4-digit Math.random() number (9,000 values per day), which made bookings
 * enumerable through the unauthenticated lookup (/api/public/bookings/[number] returns the guest's
 * name and phone) and prone to unique-constraint collisions. Existing numbers stay valid.
 */
export function generateBookingNumber(prefix: 'TKT' | 'TBL'): string {
  const dateStr = format(new Date(), 'yyyyMMdd')
  let rand = ''
  for (let i = 0; i < 8; i++) rand += BOOKING_ALPHABET[randomInt(BOOKING_ALPHABET.length)]
  return `${prefix}-${dateStr}-${rand}`
}

export interface CreateTicketBookingInput {
  eventId: string
  ticketTypeId: string
  fullName: string
  phone: string
  email?: string | null
  quantity: number
}

/** Throws 'TICKET_TYPE_NOT_FOUND' or 'SOLD_OUT' — callers map these to HTTP responses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createTicketBooking(tx: any, input: CreateTicketBookingInput) {
  const ticketType = await tx.eventTicketType.findUnique({ where: { id: input.ticketTypeId } })
  if (!ticketType || ticketType.eventId !== input.eventId) throw new Error('TICKET_TYPE_NOT_FOUND')

  const quantity = Math.max(1, Math.round(input.quantity) || 1)

  if (ticketType.quantityAvailable != null) {
    const sold = await tx.ticketBooking.aggregate({
      where: { ticketTypeId: input.ticketTypeId, bookingStatus: { not: 'CANCELLED' } },
      _sum: { quantity: true },
    })
    const soldSoFar = sold._sum.quantity || 0
    if (soldSoFar + quantity > ticketType.quantityAvailable) throw new Error('SOLD_OUT')
  }

  return tx.ticketBooking.create({
    data: {
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      bookingNumber: generateBookingNumber('TKT'),
      fullName: input.fullName.trim(),
      phone: input.phone.trim(),
      email: input.email?.trim() || null,
      quantity,
      totalAmount: roundMoney(ticketType.price * quantity),
    },
  })
}

export interface CreateTableBookingInput {
  eventId: string
  tableId: string
  name: string
  phone: string
  guests: number
  depositPaid?: number
  specialRequests?: string | null
}

/** Throws 'TABLE_NOT_FOUND' or 'TABLE_UNAVAILABLE' — callers map these to HTTP responses. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createTableBooking(tx: any, input: CreateTableBookingInput) {
  const table = await tx.eventTable.findUnique({ where: { id: input.tableId } })
  if (!table || table.eventId !== input.eventId) throw new Error('TABLE_NOT_FOUND')
  if (table.status !== 'AVAILABLE') throw new Error('TABLE_UNAVAILABLE')

  const booking = await tx.tableBooking.create({
    data: {
      eventId: input.eventId,
      tableId: input.tableId,
      bookingNumber: generateBookingNumber('TBL'),
      name: input.name.trim(),
      phone: input.phone.trim(),
      guests: Math.max(1, Math.round(input.guests) || 1),
      totalAmount: roundMoney(table.price),
      depositPaid: roundMoney(input.depositPaid || 0),
      specialRequests: input.specialRequests?.trim() || null,
    },
  })
  await tx.eventTable.update({ where: { id: input.tableId }, data: { status: 'RESERVED' } })
  return booking
}
