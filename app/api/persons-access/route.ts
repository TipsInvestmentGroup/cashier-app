import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isOwner, canManagePersons } from '@/lib/persons-access'
import { getPersonsManagers, setPersonsManagers } from '@/lib/approvals'
import { ownerEmail } from '@/lib/owner'
import { legacyAuthorityApplies, sessionOwnerEmail } from '@/lib/tenant'

const OWNER_EMAIL = ownerEmail()

/** Who can edit/delete persons: owner + the configured persons managers. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const managers = await getPersonsManagers()
  return NextResponse.json({ owner: (await legacyAuthorityApplies()) ? OWNER_EMAIL : await sessionOwnerEmail(), managers, canManage: await canManagePersons(user.email) })
}

/** Owner sets/replaces the full list of persons managers. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change persons access' }, { status: 403 })
  if (!(await legacyAuthorityApplies())) return NextResponse.json({ error: 'Persons access is not configurable for this company yet' }, { status: 403 })

  const { emails } = await req.json().catch(() => ({}))
  await setPersonsManagers(Array.isArray(emails) ? emails : [])
  return NextResponse.json({ ok: true, managers: await getPersonsManagers() })
}
