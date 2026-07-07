import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** GET /api/public/bookings/[bookingNumber] — no auth; lookup by the (unguessable) booking number, e.g. for reloading a confirmation page. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ bookingNumber: string }> }) {
  const { bookingNumber } = await params

  const booking = bookingNumber.startsWith('TBL-')
    ? await db.tableBooking.findUnique({ where: { bookingNumber } })
    : await db.ticketBooking.findUnique({ where: { bookingNumber } })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const qrDataUrl = await QRCode.toDataURL(booking.bookingNumber)
  return NextResponse.json({ booking, qrDataUrl })
}
