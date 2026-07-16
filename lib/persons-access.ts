import { getPersonsManagers } from '@/lib/approvals'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

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
