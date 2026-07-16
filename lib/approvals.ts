import { prisma } from '@/lib/prisma'

/**
 * Who's allowed to manage departments/functions, approve petty cash and
 * cancellations, manage persons, and file requests beyond a cashier — every
 * one of these used to be a hardcoded array of specific people's work
 * emails (see git history on lib/shared-constants.ts, lib/persons-access.ts,
 * lib/request-access.ts). That meant changing who holds one of these roles
 * required a code edit and redeploy. They're now Setting-table-backed lists
 * (JSON string arrays, same shape/pattern as lib/petty-access.ts's
 * getPettyRequesters), seeded with today's real approvers as the default so
 * behaviour is unchanged until an admin edits them from a settings screen.
 *
 * Each getter also honours the OLD single-slot "4th/3rd manager" Setting
 * keys (departmentsManagerEmail / personsManagerEmail) on first read, so a
 * value someone already configured through the old UI isn't silently
 * dropped when this list-based Setting hasn't been written yet.
 */

async function getEmailList(settingKey: string, defaults: string[]): Promise<string[]> {
  const s = await prisma.setting.findUnique({ where: { key: settingKey } })
  if (s?.value) {
    try {
      const arr = JSON.parse(s.value)
      if (Array.isArray(arr)) return arr.map((x) => String(x).toLowerCase()).filter(Boolean)
    } catch { /* fall through to defaults */ }
  }
  return defaults
}

async function setEmailList(settingKey: string, emails: string[]) {
  const clean = (emails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean)
  await prisma.setting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(clean) },
    create: { key: settingKey, value: JSON.stringify(clean) },
  })
}

/** Merges a fixed default list with a legacy single-email Setting, if set. */
async function defaultsWithLegacySlot(fixed: string[], legacyKey: string): Promise<string[]> {
  const legacy = await prisma.setting.findUnique({ where: { key: legacyKey } })
  const extra = (legacy?.value || '').toLowerCase()
  return extra && !fixed.includes(extra) ? [...fixed, extra] : fixed
}

const DEFAULT_DEPT_MANAGERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
const DEFAULT_PETTY_APPROVERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
const DEFAULT_CANCELLATION_APPROVERS = DEFAULT_PETTY_APPROVERS
const DEFAULT_PERSONS_MANAGERS = ['r.mlay@tips.co.tz']
const DEFAULT_REQUEST_MANAGERS = ['alphonce.mvungi@tips.co.tz']
const DEFAULT_SIGNED_BILLS_BLOCKED = ['r.mlay@tips.co.tz']

const KEYS = {
  deptManagers: 'deptManagerEmails',
  pettyApprovers: 'pettyApproverEmails',
  cancellationApprovers: 'cancellationApproverEmails',
  personsManagers: 'personsManagerEmails',
  requestManagers: 'requestManagerEmails',
  signedBillsBlocked: 'signedBillsBlockedEmails',
} as const

export async function getDeptManagers(): Promise<string[]> {
  return getEmailList(KEYS.deptManagers, await defaultsWithLegacySlot(DEFAULT_DEPT_MANAGERS, 'departmentsManagerEmail'))
}
export const setDeptManagers = (emails: string[]) => setEmailList(KEYS.deptManagers, emails)

export async function getPettyApprovers(): Promise<string[]> {
  return getEmailList(KEYS.pettyApprovers, DEFAULT_PETTY_APPROVERS)
}
export const setPettyApprovers = (emails: string[]) => setEmailList(KEYS.pettyApprovers, emails)

export async function getCancellationApprovers(): Promise<string[]> {
  return getEmailList(KEYS.cancellationApprovers, DEFAULT_CANCELLATION_APPROVERS)
}
export const setCancellationApprovers = (emails: string[]) => setEmailList(KEYS.cancellationApprovers, emails)

export async function getPersonsManagers(): Promise<string[]> {
  return getEmailList(KEYS.personsManagers, await defaultsWithLegacySlot(DEFAULT_PERSONS_MANAGERS, 'personsManagerEmail'))
}
export const setPersonsManagers = (emails: string[]) => setEmailList(KEYS.personsManagers, emails)

export async function getRequestManagers(): Promise<string[]> {
  return getEmailList(KEYS.requestManagers, DEFAULT_REQUEST_MANAGERS)
}
export const setRequestManagers = (emails: string[]) => setEmailList(KEYS.requestManagers, emails)

export async function getSignedBillsBlockedEmails(): Promise<string[]> {
  return getEmailList(KEYS.signedBillsBlocked, DEFAULT_SIGNED_BILLS_BLOCKED)
}
export const setSignedBillsBlockedEmails = (emails: string[]) => setEmailList(KEYS.signedBillsBlocked, emails)
