import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  isOwner, getDeptManagerEmail, setDeptManagerEmail,
  canManageDepartments, canApprovePetty, canRequestPetty,
  DEPT_FIXED_MANAGERS, PETTY_APPROVERS,
} from '@/lib/petty-access'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/**
 * Petty-cash access config. Any authed user may read it (the cash-request form
 * needs the approver list); only the owner may change the 4th dept manager.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deptManagerEmail = await getDeptManagerEmail()

  // Names of the configured approvers (for the "Approved By" dropdown).
  const approvers = await prisma.user.findMany({
    where: { email: { in: PETTY_APPROVERS }, isActive: true },
    select: { name: true, email: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    owner: OWNER_EMAIL,
    deptFixedManagers: DEPT_FIXED_MANAGERS,
    deptManagerEmail,
    approvers,
    approverEmails: PETTY_APPROVERS,
    isOwner: isOwner(user.email),
    canManageDepartments: await canManageDepartments(user.email),
    canApprove: canApprovePetty(user.email),
    canRequest: canRequestPetty(user.email),
  })
}

/** Owner sets/changes the 4th departments/functions manager. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change this access' }, { status: 403 })

  const { email } = await req.json().catch(() => ({}))
  await setDeptManagerEmail((email || '').toLowerCase())
  return NextResponse.json({ ok: true, deptManagerEmail: (email || '').toLowerCase() })
}
