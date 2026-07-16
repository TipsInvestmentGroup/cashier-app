import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getFloorPositions, setFloorPositions } from '@/lib/floor-positions-db'

/** MyPos floor role labels — Admin/Manager form pickers. Any authed user may read. */
export async function GET() {
  return NextResponse.json(await getFloorPositions())
}

/** Replace the ordered list — Admin only. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can change floor positions' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.positions)) return NextResponse.json({ error: 'positions must be an array' }, { status: 400 })
  const next = await setFloorPositions(body.positions)
  return NextResponse.json(next)
}
