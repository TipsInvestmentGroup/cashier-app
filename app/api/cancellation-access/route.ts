import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getCancellationApprovers } from '@/lib/approvals'
import { canFileRequest } from '@/lib/request-access'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/** Computed booleans only — the approver/requester email lists themselves stay server-side. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const e = (user.email || '').toLowerCase()
  const isOwner = !!OWNER_EMAIL && e === OWNER_EMAIL
  const canApprove = isOwner || (await getCancellationApprovers()).includes(e)
  const canCreate = await canFileRequest(user.role, user.email)

  return NextResponse.json({ canApprove, canCreate })
}
