import { getPersonsManagers } from '@/lib/approvals'
import { ownerEmail } from '@/lib/owner'

const OWNER_EMAIL = ownerEmail()

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** Owner or any configured persons manager (see lib/approvals.ts). */
export async function canManagePersons(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  return (await getPersonsManagers()).includes(e)
}
