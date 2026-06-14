import { prisma } from '@/lib/prisma'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

// Fixed users who can always manage Departments & Functions (besides the owner)
// and who are the petty-cash approvers.
export const DEPT_FIXED_MANAGERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
export const PETTY_APPROVERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
// Accounts allowed to SUBMIT a petty-cash request.
export const PETTY_REQUESTERS = [
  'bonzon@tips.co.tz',
  'shabinam@tips.co.tz',
  'alphonce.mvungi@tips.co.tz',
  'triphillus@tips.co.tz',
  'john.onesmo@tips.co.tz',
]
const SETTING_KEY = 'departmentsManagerEmail'

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** The owner-configurable 4th departments/functions manager email. */
export async function getDeptManagerEmail(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  return (s?.value || '').toLowerCase()
}

export async function setDeptManagerEmail(email: string) {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: email || null },
    create: { key: SETTING_KEY, value: email || null },
  })
}

/** Owner, the two fixed managers, or the owner-chosen 4th manager. */
export async function canManageDepartments(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  if (DEPT_FIXED_MANAGERS.includes(e)) return true
  const dyn = await getDeptManagerEmail()
  return !!dyn && e === dyn
}

/** Only the two approvers (owner has override). */
export function canApprovePetty(email?: string): boolean {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  return PETTY_APPROVERS.includes(e)
}

/** Accounts allowed to submit a petty-cash request (owner has override). */
export function canRequestPetty(email?: string): boolean {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  return PETTY_REQUESTERS.includes(e)
}
