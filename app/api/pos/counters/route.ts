import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/pos/counters?outletId= — the outlet's active counters, in a
 * stable display order. Outlets can have different physical setups (e.g.
 * Mikocheni's Main Bar + VIP + Shisha + Kitchen vs another outlet's
 * Main/Bar/Shisha/Kitchen), so counter lists must never be hardcoded
 * client-side — that broke the moment a second outlet's layout diverged.
 */
const ORDER: Record<string, number> = { MAIN: 0, VIP: 1, SHISHA: 2, KITCHEN: 3, BAR: 4 }

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  // ?all=1 (Admin): include inactive counters + ids, for layout management.
  const wantAll = req.nextUrl.searchParams.get('all') === '1' && payload.role === 'ADMIN'
  const counters = await prisma.posCounter.findMany({
    where: wantAll ? { outletId } : { outletId, isActive: true },
    select: wantAll
      ? { id: true, code: true, label: true, serviceModel: true, isActive: true }
      : { code: true, label: true, serviceModel: true },
  })
  counters.sort((a, b) => (ORDER[a.code] ?? 99) - (ORDER[b.code] ?? 99))

  return NextResponse.json(counters)
}

/** Add a counter to an outlet's layout — Admin only. Replaces what the old
 *  name-keyed /api/pos/setup layouts did implicitly. */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can manage counters' }, { status: 403 })

  const { outletId, code, label, serviceModel } = await req.json().catch(() => ({}))
  const cleanCode = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '')
  if (!outletId || !cleanCode || !String(label || '').trim()) {
    return NextResponse.json({ error: 'Outlet, code and label are required' }, { status: 400 })
  }
  if (serviceModel !== 'PREP' && serviceModel !== 'DIRECT') {
    return NextResponse.json({ error: 'serviceModel must be PREP or DIRECT' }, { status: 400 })
  }
  const existing = await prisma.posCounter.findFirst({ where: { outletId, code: cleanCode } })
  if (existing) return NextResponse.json({ error: `Counter ${cleanCode} already exists for this outlet` }, { status: 409 })

  const counter = await prisma.posCounter.create({
    data: { outletId, code: cleanCode, label: String(label).trim(), serviceModel },
  })
  return NextResponse.json(counter, { status: 201 })
}

/** Update a counter's label/serviceModel/isActive — Admin only. Deactivating
 *  (never deleting) is how a layout merges counters while keeping history. */
export async function PUT(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (payload.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can manage counters' }, { status: 403 })

  const { id, label, serviceModel, isActive } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'Counter id is required' }, { status: 400 })
  const existing = await prisma.posCounter.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Counter not found' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (label !== undefined) {
    if (!String(label).trim()) return NextResponse.json({ error: 'Label cannot be empty' }, { status: 400 })
    data.label = String(label).trim()
  }
  if (serviceModel !== undefined) {
    if (serviceModel !== 'PREP' && serviceModel !== 'DIRECT') return NextResponse.json({ error: 'serviceModel must be PREP or DIRECT' }, { status: 400 })
    data.serviceModel = serviceModel
  }
  if (isActive !== undefined) data.isActive = !!isActive

  const counter = await prisma.posCounter.update({ where: { id }, data })
  return NextResponse.json(counter)
}
