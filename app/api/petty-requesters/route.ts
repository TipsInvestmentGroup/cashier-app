import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isOwner, getPettyRequesters, setPettyRequesters } from '@/lib/petty-access'

/** Who may submit petty-cash requests. Any authed user can read; only the owner can change. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ requesters: await getPettyRequesters(), isOwner: isOwner(user.email) })
}

/** Owner sets the full list of allowed requester emails. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change request access' }, { status: 403 })

  const { emails } = await req.json().catch(() => ({}))
  await setPettyRequesters(Array.isArray(emails) ? emails : [])
  return NextResponse.json({ ok: true, requesters: await getPettyRequesters() })
}
