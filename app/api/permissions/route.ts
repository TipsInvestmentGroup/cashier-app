import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isOwner, listPermissions, setPermission, RESOURCES, Resource } from '@/lib/rbac'
import { prisma } from '@/lib/prisma'

const VALID_RESOURCES = Object.values(RESOURCES) as string[]

/** Owner-only: list every grant for a resource. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can view access grants' }, { status: 403 })

  const resource = new URL(req.url).searchParams.get('resource')
  if (!resource || !VALID_RESOURCES.includes(resource)) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })

  const grants = await listPermissions(resource as Resource)
  return NextResponse.json(grants)
}

/** Owner-only: grant or revoke a user's Add/Edit/Delete access for a resource. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change access grants' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { resource, userId, canAdd, canEdit, canDelete, canSettle, canUnsettle } = body
  if (!resource || !VALID_RESOURCES.includes(resource)) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const grant = await setPermission(resource as Resource, userId, { canAdd: !!canAdd, canEdit: !!canEdit, canDelete: !!canDelete, canSettle: !!canSettle, canUnsettle: !!canUnsettle })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'UserPermission', entityId: grant.id, details: `Set ${resource} access for user ${userId}: add=${!!canAdd} edit=${!!canEdit} delete=${!!canDelete} settle=${!!canSettle} unsettle=${!!canUnsettle}` },
  })
  return NextResponse.json(grant)
}
