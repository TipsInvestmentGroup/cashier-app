import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { isOwner, canManageDepartments, canApprovePetty, canRequestPetty } from '@/lib/petty-access'
import { getDeptManagers, setDeptManagers, getPettyApprovers } from '@/lib/approvals'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/**
 * Petty-cash access config. Any authed user may read it (the cash-request form
 * needs the approver list); only the owner may change the departments/functions managers.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [deptManagers, pettyApproverEmails] = await Promise.all([getDeptManagers(), getPettyApprovers()])

  // Names of the configured approvers (for the "Approved By" dropdown).
  const approvers = await prisma.user.findMany({
    where: { email: { in: pettyApproverEmails }, isActive: true },
    select: { name: true, email: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    owner: OWNER_EMAIL,
    deptManagers,
    approvers,
    approverEmails: pettyApproverEmails,
    isOwner: isOwner(user.email),
    canManageDepartments: await canManageDepartments(user.email),
    canApprove: await canApprovePetty(user.email),
    canRequest: await canRequestPetty(user.email),
  })
}

/** Owner sets/replaces the full list of departments/functions managers. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change this access' }, { status: 403 })

  const { emails } = await req.json().catch(() => ({}))
  await setDeptManagers(Array.isArray(emails) ? emails : [])
  return NextResponse.json({ ok: true, deptManagers: await getDeptManagers() })
}
