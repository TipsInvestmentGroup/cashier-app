import { prisma } from '@/lib/prisma'
import { CASH_VERIFIERS_FIXED } from '@/lib/shared-constants'
import { ownerEmail } from '@/lib/owner'
import { legacyAuthorityApplies } from '@/lib/tenant'

const OWNER_EMAIL = ownerEmail()
export { CASH_VERIFIERS_FIXED }
const SETTING_KEY = 'cashVerifierEmail'

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** The owner-configurable extra verifier email. */
export async function getCashVerifierEmail(): Promise<string> {
  if (!(await legacyAuthorityApplies())) return ''
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  return (s?.value || '').toLowerCase()
}

export async function setCashVerifierEmail(email: string) {
  if (!(await legacyAuthorityApplies())) throw new Error('Cash verifier access is not configurable for this company yet')
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: email || null },
    create: { key: SETTING_KEY, value: email || null },
  })
}

/** Owner, the two fixed officers, or the owner-chosen extra verifier. */
export async function canVerifyCash(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  // owner / fixed officers are the original company's authorities only
  if (!(await legacyAuthorityApplies())) return false
  if (isOwner(e)) return true
  if (CASH_VERIFIERS_FIXED.includes(e)) return true
  const dyn = await getCashVerifierEmail()
  return !!dyn && e === dyn
}
