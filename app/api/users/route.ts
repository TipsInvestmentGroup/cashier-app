import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { memberOfCompanyWhere, outletInCompany, requireTenant, upsertMembership } from '@/lib/tenant'
import { isCompanyOwner } from '@/lib/owner'
import { VALID_ROLES } from '@/lib/shared-constants'
import { resolveManageUsersPermission, MANAGE_USERS_RESOURCES } from '@/lib/rbac'

const PIN_RE = /^\d{4}$/

export async function GET(req: NextRequest) {
  const user = await requireTenant(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER', 'DIRECTOR'].includes(user.role) && !isCompanyOwner(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Only the CALLER'S COMPANY's people (this used to return every user in the database). Role / outlet /
  // position / active-ness are the ones held in THIS company (membership), falling back to the legacy
  // user columns for anyone not yet backfilled.
  const [users, outlets] = await Promise.all([
    prisma.user.findMany({
      where: await memberOfCompanyWhere(prisma, user.companyId),
      select: {
        id: true, name: true, email: true, role: true, position: true, pin: true, outletId: true, isActive: true, isCasual: true, createdAt: true,
        memberships: { where: { companyId: user.companyId }, select: { role: true, outletId: true, position: true, isActive: true } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.outlet.findMany({ where: { companyId: user.companyId } }),
  ])
  const outletById = new Map(outlets.map((o) => [o.id, o]))
  // Never expose the pin hash — just whether one is set.
  const safe = users.map(({ pin, memberships, outletId, ...u }) => {
    const m = memberships[0]
    const oid = m ? m.outletId : outletId
    return {
      ...u,
      role: m?.role ?? u.role,
      position: m ? m.position : u.position,
      outlet: oid ? outletById.get(oid) ?? null : null,
      isActive: m ? m.isActive && u.isActive : u.isActive,
      hasPin: !!pin,
    }
  })

  return NextResponse.json(safe)
}

export async function POST(req: NextRequest) {
  const user = await requireTenant(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.ADD_USER))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, role, outletId, pin, position, isCasual } = await req.json()
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  const casual = !!isCasual
  // Casual/temporary workers don't log in themselves, so email+password aren't
  // collected from the form — auto-fill a unique placeholder so the (required,
  // unique) columns are still satisfied.
  if (!casual && !email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!casual && !password) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  const finalEmail = email || `casual-${randomBytes(6).toString('hex')}@internal.local`
  const hashed = await hashPassword(password || randomBytes(12).toString('hex'))

  // The new person joins the CALLER'S company, and may only be placed at one of its outlets.
  if (!(await outletInCompany(prisma, outletId || null, user.companyId))) {
    return NextResponse.json({ error: 'That outlet does not belong to your company' }, { status: 400 })
  }

  try {
    const newUser = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name, email: finalEmail, password: hashed, role, outletId: outletId || null,
          position: position || null,
          pin: pin ? await hashPassword(String(pin)) : null,
          isCasual: casual,
        },
        select: { id: true, name: true, email: true, role: true, position: true, outlet: true, isCasual: true },
      })
      await upsertMembership(tx, { userId: created.id, companyId: user.companyId, role, outletId: outletId || null, position: position || null })
      return created
    })
    return NextResponse.json(newUser, { status: 201 })
  } catch (err: unknown) {
    const dup = err instanceof Error && err.message.includes('Unique')
    return NextResponse.json({ error: dup ? 'That email is already registered' : 'Could not create user' }, { status: dup ? 409 : 400 })
  }
}
