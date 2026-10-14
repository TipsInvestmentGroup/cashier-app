import { NextRequest, NextResponse } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { limitEveryRequest } from '@/lib/rate-limit'
import { resolvePickerCompany } from '@/lib/tenant'

/**
 * GET /api/auth/pin-login/outlets — public (pre-login). Feeds the MyPOS
 * outlet picker (step 1 of staff sign-in) — just enough to render a tappable
 * outlet tile, never anything sensitive.
 */
export async function GET(req: NextRequest) {
  const limited = limitEveryRequest(req, 'pin-outlets', { limit: 120, windowMs: 60 * 1000 })
  if (limited) return limited

  // Which company is this terminal for? (see resolvePickerCompany) - never list another company's outlets.
  const pc = await resolvePickerCompany(req.nextUrl.searchParams.get('company'))
  if (pc.mode === 'required') return NextResponse.json({ error: 'Enter your company code', needsCompany: true }, { status: 400 })
  if (pc.mode === 'none') return NextResponse.json([])

  const outlets = await prisma.outlet.findMany({
    where: {
      isActive: true,
      ...(pc.mode === 'company' ? (pc.isOriginal ? { OR: [{ companyId: pc.companyId }, { companyId: null }] } : { companyId: pc.companyId }) : {}),
    },
    select: { id: true, name: true, isEventsOnly: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(outlets)
}
