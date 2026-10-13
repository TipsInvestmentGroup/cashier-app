import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requirePlatformAdmin, platformAudit } from '@/lib/platform-auth'
import { SLUG_RE, slugify } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * GET /api/platform/companies - the company DIRECTORY for the platform owner: identity, status and headcounts.
 * Counts only - this endpoint never returns any company's business data (sales, ledgers, staff names ...).
 */
export async function GET(req: NextRequest) {
  const admin = await requirePlatformAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const companies = await prisma.company.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, slug: true, status: true, legalName: true, createdAt: true,
      _count: { select: { memberships: true, outlets: true } },
    },
  })
  return NextResponse.json(companies.map(({ _count, ...c }) => ({ ...c, memberCount: _count.memberships, outletCount: _count.outlets })))
}

/**
 * POST /api/platform/companies - register a new, empty company. body: { name, slug?, legalName?, tin?, vrn? }
 * Creates only the company record (ACTIVE). Provisioning its first administrator, outlets and baseline data
 * is the onboarding flow (a later phase); until then a company has no users and nobody can sign in to it.
 */
export async function POST(req: NextRequest) {
  const admin = await requirePlatformAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (name.length < 2) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const slug = String(body.slug || slugify(name)).trim().toLowerCase()
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'slug must be 1-40 characters: lower-case letters, digits and hyphens' }, { status: 400 })

  try {
    const company = await prisma.company.create({
      data: { name, slug, status: 'ACTIVE', legalName: body.legalName || null, tin: body.tin || null, vrn: body.vrn || null },
      select: { id: true, name: true, slug: true, status: true },
    })
    await platformAudit(admin.adminId, 'CREATE_COMPANY', 'Company', company.id, `Created ${company.name} (${company.slug})`)
    return NextResponse.json(company, { status: 201 })
  } catch (err: unknown) {
    const dup = err instanceof Error && err.message.includes('Unique')
    return NextResponse.json({ error: dup ? 'A company with that name or code already exists' : 'Could not create company' }, { status: dup ? 409 : 400 })
  }
}
