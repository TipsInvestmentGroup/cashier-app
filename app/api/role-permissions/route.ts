import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import {
  isOwner, listRolePermissions, setRolePermission,
  BUSINESS_DAY_RESOURCES, RECONCILIATION_STAGE_RESOURCES, WRITE_OFF_RESOURCES, MANAGE_USERS_RESOURCES,
  type BooleanResource,
} from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

type GrantableResource = BooleanResource

const VALID_RESOURCES = [
  ...Object.values(BUSINESS_DAY_RESOURCES),
  ...Object.values(RECONCILIATION_STAGE_RESOURCES),
  ...Object.values(WRITE_OFF_RESOURCES),
  ...Object.values(MANAGE_USERS_RESOURCES),
] as string[]

/** Owner-only: list every role default for a resource. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can view role defaults' }, { status: 403 })

  const resource = new URL(req.url).searchParams.get('resource')
  if (!resource || !VALID_RESOURCES.includes(resource)) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })

  const rows = await listRolePermissions(resource as GrantableResource)
  return NextResponse.json(rows)
}

/** Owner-only: set a role's default (allowed true/false) for a resource. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change role defaults' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { resource, role, allowed } = body
  if (!resource || !VALID_RESOURCES.includes(resource)) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  if (!role) return NextResponse.json({ error: 'role is required' }, { status: 400 })

  const row = await setRolePermission(role, resource as GrantableResource, !!allowed)
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'RolePermission', entityId: row.id, details: `Set ${resource} default for role ${role}: allowed=${!!allowed}` },
  })
  return NextResponse.json(row)
}
