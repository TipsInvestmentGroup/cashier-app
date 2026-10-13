import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { limitEveryRequest } from '@/lib/rate-limit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** GET /api/public/bookings/[bookingNumber] — no auth; lookup by the booking number, e.g. for reloading a confirmation page.
 *  Numbers carry a CSPRNG suffix (lib/bookings.ts) and lookups are rate limited so they can't be enumerated. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ bookingNumber: string }> }) {
  const limited = limitEveryRequest(req, 'public-booking-lookup', { limit: 20, windowMs: 60 * 1000 })
  if (limited) return limited
  const { bookingNumber } = await params

  const booking = bookingNumber.startsWith('TBL-')
    ? await db.tableBooking.findUnique({ where: { bookingNumber } })
    : await db.ticketBooking.findUnique({ where: { bookingNumber } })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const qrDataUrl = await QRCode.toDataURL(booking.bookingNumber)
  return NextResponse.json({ booking, qrDataUrl })
}
