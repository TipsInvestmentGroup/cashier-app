// CI check: every Prisma model must have a tenancy decision (lib/tenancy-registry.ts), and every ROOT model
// must actually carry a `companyId` column. Pure file parsing - no database, no Prisma client needed.
//   npm run check:tenancy
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CHILDREN, DEFERRED, EXEMPT, IDENTITY, NATIVE, SCOPED, TENANT_ROOTS, classify } from '../lib/tenancy-registry'

const schema = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const models = new Map<string, string>()
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) models.set(m[1], m[2])

const hasCompanyColumn = (body: string) => /^\s*companyId\s+String/m.test(body)
const problems: string[] = []

for (const [name, body] of models) {
  const kind = classify(name)
  const native = hasCompanyColumn(body)
  if (kind === null && native) problems.push(`${name}: has a companyId column but is not listed as ROOT, NATIVE or EXEMPT in lib/tenancy-registry.ts`)
  if ((kind === 'NATIVE' || kind === 'EXEMPT') && !native) problems.push(`${name}: listed ${kind} but has no companyId column`)
  if (kind === null && !native) problems.push(`${name}: no companyId column and not classified in lib/tenancy-registry.ts - decide how it belongs to a company`)
  if (kind === 'ROOT' && !native) problems.push(`${name}: classified ROOT but has no companyId column`)
  if (kind === 'ROOT' && native && !/@@index\(\[companyId/.test(body)) problems.push(`${name}: ROOT companyId has no index`)
  if ((kind === 'CHILD' || kind === 'SCOPED') && native) problems.push(`${name}: classified ${kind} but already has a companyId column - reclassify as ROOT or drop the entry`)
}

// registry entries that point at models that do not exist (typos / removed models)
const all = new Set(models.keys())
const listed = [...Object.keys(TENANT_ROOTS), ...NATIVE, ...EXEMPT, ...Object.keys(CHILDREN), ...SCOPED, ...IDENTITY, ...Object.keys(DEFERRED)]
for (const n of listed) if (!all.has(n)) problems.push(`registry lists unknown model ${n}`)
for (const [child, parent] of Object.entries(CHILDREN)) if (!all.has(parent)) problems.push(`child ${child}: unknown parent model ${parent}`)
const seen = new Set<string>()
for (const n of listed) { if (seen.has(n)) problems.push(`registry lists ${n} more than once`); seen.add(n) }

const roots = Object.keys(TENANT_ROOTS).length
if (problems.length) {
  console.error(`[check-tenancy] FAIL (${problems.length})\n` + problems.map((p) => '  - ' + p).join('\n'))
  process.exit(1)
}
console.log(`[check-tenancy] OK - ${models.size} models: ${roots} roots, ${Object.keys(CHILDREN).length} children, ${SCOPED.length} scoped, ${IDENTITY.length} identity, ${Object.keys(DEFERRED).length} deferred, rest company-native`)
