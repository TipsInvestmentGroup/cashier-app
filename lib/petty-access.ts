import { prisma } from '@/lib/prisma'
import { getDeptManagers, getPettyApprovers } from '@/lib/approvals'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

// Default accounts allowed to SUBMIT a petty-cash request (used until the owner customises the list).
export const DEFAULT_PETTY_REQUESTERS = [
  'bonzon@tips.co.tz',
  'shabinam@tips.co.tz',
  'alphonce.mvungi@tips.co.tz',
  'triphillus@tips.co.tz',
  'john.onesmo@tips.co.tz',
]
const REQUESTERS_KEY = 'pettyRequesterEmails'

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

/** Owner or any configured departments/functions manager (see lib/approvals.ts). */
export async function canManageDepartments(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  return (await getDeptManagers()).includes(e)
}

/** Owner or any configured petty-cash approver (see lib/approvals.ts). */
export async function canApprovePetty(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  return (await getPettyApprovers()).includes(e)
}

/** Who may disburse (pay out) approved petty-cash requests: cashier or accountant. */
export function canDisbursePetty(role?: string): boolean {
  return ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN'].includes((role || '').toUpperCase())
}

/** Who may create/replenish accountant petty-cash funds. */
export function canManageFunds(role?: string): boolean {
  return ['ACCOUNTANT', 'ADMIN', 'DIRECTOR'].includes((role || '').toUpperCase())
}

/** The owner-managed list of petty-cash requester emails (falls back to defaults). */
export async function getPettyRequesters(): Promise<string[]> {
  const s = await prisma.setting.findUnique({ where: { key: REQUESTERS_KEY } })
  if (!s?.value) return DEFAULT_PETTY_REQUESTERS
  try {
    const arr = JSON.parse(s.value)
    return Array.isArray(arr) ? arr.map((x) => String(x).toLowerCase()).filter(Boolean) : DEFAULT_PETTY_REQUESTERS
  } catch {
    return DEFAULT_PETTY_REQUESTERS
  }
}

export async function setPettyRequesters(emails: string[]) {
  const clean = (emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  await prisma.setting.upsert({
    where: { key: REQUESTERS_KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: REQUESTERS_KEY, value: JSON.stringify(clean) },
  })
}

/** Accounts allowed to submit a petty-cash request (owner has override). */
export async function canRequestPetty(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!e) return false
  if (isOwner(e)) return true
  const list = await getPettyRequesters()
  return list.includes(e)
}
