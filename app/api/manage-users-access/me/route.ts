import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveManageUsersPermission, MANAGE_USERS_RESOURCES } from '@/lib/rbac'

/** The caller's own effective Add/Edit/Delete access to the User Management screen. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [canAdd, canEdit, canDelete] = await Promise.all([
    resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.ADD_USER),
    resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.EDIT_USER),
    resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.DELETE_USER),
  ])
  return NextResponse.json({ canAdd, canEdit, canDelete })
}
