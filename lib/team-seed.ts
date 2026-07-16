import bcrypt from 'bcryptjs'
import fs from 'fs'
import path from 'path'

// The outlets the business runs. Add/rename here if needed.
export const OUTLET_NAMES = ['Mikocheni Outlet', 'Coco Beach Outlet', 'Tips Events']

interface TeamMember { email: string; name: string; role: string; outlet: string | null }

/**
 * Real names/emails never live in this file or in git — only in the
 * gitignored prisma/team-roster.local.json. Edit that file (copy
 * prisma/team-roster.json as a starting point) before running
 * /api/admin/setup-team; a fresh clone without it falls back to the
 * committed placeholder roster so setup still runs.
 * - role: ADMIN | MANAGER | DIRECTOR | ACCOUNTANT | CASHIER
 * - outlet: exact outlet name from OUTLET_NAMES, or null for "all outlets"
 * Emails are stored lowercase (log in with the lowercase email).
 */
export function loadTeamRoster(): TeamMember[] {
  const local = path.join(process.cwd(), 'prisma', 'team-roster.local.json')
  const sample = path.join(process.cwd(), 'prisma', 'team-roster.json')
  const file = fs.existsSync(local) ? local : sample
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as TeamMember[]
}

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

  for (const u of loadTeamRoster()) {
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
