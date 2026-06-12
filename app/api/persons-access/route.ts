import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isOwner, getPersonsManagerEmail, setPersonsManagerEmail, FIXED_MANAGER_EMAIL } from '@/lib/persons-access'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/** Who can edit/delete persons: owner + fixed manager + the owner-chosen third manager. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const managerEmail = await getPersonsManagerEmail()
  return NextResponse.json({ owner: OWNER_EMAIL, fixedManager: FIXED_MANAGER_EMAIL, managerEmail })
}

/** Owner sets/changes the third authorized manager. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change persons access' }, { status: 403 })

  const { email } = await req.json().catch(() => ({}))
  await setPersonsManagerEmail((email || '').toLowerCase())
  return NextResponse.json({ ok: true, managerEmail: (email || '').toLowerCase() })
}
