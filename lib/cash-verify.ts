import { prisma } from '@/lib/prisma'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
// Fixed cash-verification officers (besides the owner).
export const CASH_VERIFIERS_FIXED = ['shabinam@tips.co.tz', 'siyer.mkama@tips.co.tz', 'derickjasselly@gmail.com']
const SETTING_KEY = 'cashVerifierEmail'

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** The owner-configurable extra verifier email. */
export async function getCashVerifierEmail(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: SETTING_KEY } })
  return (s?.value || '').toLowerCase()
}

export async function setCashVerifierEmail(email: string) {
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
  if (isOwner(e)) return true
  if (CASH_VERIFIERS_FIXED.includes(e)) return true
  const dyn = await getCashVerifierEmail()
  return !!dyn && e === dyn
}
