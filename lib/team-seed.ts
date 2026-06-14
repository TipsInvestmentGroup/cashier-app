import bcrypt from 'bcryptjs'

// The outlets the business runs. Add/rename here if needed.
export const OUTLET_NAMES = ['Mikocheni Outlet', 'Coco Beach Outlet', 'Tips Events']

/**
 * ⚠️ EDIT THIS ROSTER before running /api/admin/setup-team.
 * - role: ADMIN | MANAGER | DIRECTOR | ACCOUNTANT | CASHIER
 * - outlet: exact outlet name from OUTLET_NAMES, or null for "all outlets"
 * Emails are stored lowercase (log in with the lowercase email).
 */
export const TEAM: { email: string; name: string; role: string; outlet: string | null }[] = [
  { email: 'johnonecmo@gmail.com',        name: 'John (Owner)',      role: 'ADMIN',      outlet: null },
  { email: 'john.onesmo@tips.co.tz',      name: 'John Onesmo',       role: 'ADMIN',      outlet: null },
  { email: 'shabinam@tips.co.tz',         name: 'Shabinam',          role: 'ACCOUNTANT', outlet: null },
  { email: 'alphonce.mvungi@tips.co.tz',  name: 'Alphonce Mvungi',   role: 'MANAGER',    outlet: null },
  { email: 'r.mlay@tips.co.tz',           name: 'R. Mlay',           role: 'MANAGER',    outlet: null },
  { email: 'siyer.mkama@tips.co.tz',      name: 'Siyer Mkama',       role: 'MANAGER',    outlet: null },
  { email: 'bonzon@tips.co.tz',           name: 'Bonzon Yusuph Salim', role: 'CASHIER',  outlet: 'Coco Beach Outlet' },
  { email: 'triphillus@tips.co.tz',       name: 'Triphillus',        role: 'CASHIER',    outlet: 'Mikocheni Outlet' },
]

/**
 * Idempotent team setup: ensures the outlets exist, then upserts each user.
 * NEW users get the temporary password; EXISTING users keep their current
 * password (only name/role/outlet are updated). Never overwrites a password.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function setupTeam(prisma: any, tempPassword: string) {
  const outletMap: Record<string, string> = {}
  for (const name of OUTLET_NAMES) {
    const o = await prisma.outlet.upsert({ where: { name }, update: {}, create: { name } })
    outletMap[name] = o.id
  }

  const hash = await bcrypt.hash(tempPassword, 12)
  let created = 0
  let updated = 0
  const results: { email: string; action: string }[] = []

  for (const u of TEAM) {
    const email = u.email.trim().toLowerCase()
    const outletId = u.outlet ? (outletMap[u.outlet] || null) : null
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { name: u.name, role: u.role, outletId } })
      updated++
      results.push({ email, action: 'updated (password kept)' })
    } else {
      await prisma.user.create({ data: { name: u.name, email, role: u.role, outletId, password: hash } })
      created++
      results.push({ email, action: 'created with temp password' })
    }
  }

  return { outlets: OUTLET_NAMES.length, created, updated, tempPassword, results }
}
