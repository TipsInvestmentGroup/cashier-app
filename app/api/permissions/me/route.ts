import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { myPermissions } from '@/lib/rbac'

/** The caller's own effective Add/Edit/Delete permissions across all resources. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const perms = await myPermissions(user.email, user.userId)
  return NextResponse.json(perms)
}
