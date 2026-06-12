import { prisma } from '@/lib/prisma'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
export const FIXED_MANAGER_EMAIL = 'r.mlay@tips.co.tz'
const SETTING_KEY = 'personsManagerEmail'

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** The owner-configurable third person-manager email. */
export async function getPersonsManagerEmail(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  return (s?.value || '').toLowerCase()
}

export async function setPersonsManagerEmail(email: string) {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: email || null },
    create: { key: SETTING_KEY, value: email || null },
  })
}

/** Owner, the fixed manager (r.mlay), or the owner-chosen third manager. */
export async function canManagePersons(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  if (e === FIXED_MANAGER_EMAIL.toLowerCase()) return true
  const dyn = await getPersonsManagerEmail()
  return !!dyn && e === dyn
}
