import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin, platformAudit } from '@/lib/platform-auth'
import { COMPANY_STATUS, SLUG_RE } from '@/lib/tenant'

/**
 * PATCH /api/platform/companies/[id] - body: { status?, name?, slug? }
 * Suspending a company takes effect immediately for every one of its signed-in users (the API gate
 * answers 403 COMPANY_SUSPENDED); reactivating restores access. Nothing is deleted.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: { status?: string; name?: string; slug?: string } = {}
  if (body.status !== undefined) {
    if (!Object.values(COMPANY_STATUS).includes(body.status)) return NextResponse.json({ error: 'status must be ACTIVE, SUSPENDED or ARCHIVED' }, { status: 400 })
    data.status = body.status
  }
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (name.length < 2) return NextResponse.json({ error: 'name is too short' }, { status: 400 })
    data.name = name
  }
  if (body.slug !== undefined) {
    const slug = String(body.slug).trim().toLowerCase()
    if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'slug must be 1-40 characters: lower-case letters, digits and hyphens' }, { status: 400 })
    data.slug = slug
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const company = await prisma.company.update({ where: { id }, data, select: { id: true, name: true, slug: true, status: true } })
    await platformAudit(admin.adminId, 'UPDATE_COMPANY', 'Company', id, JSON.stringify(data))
    return NextResponse.json(company)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('Unique')) return NextResponse.json({ error: 'A company with that name or code already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  }
}
