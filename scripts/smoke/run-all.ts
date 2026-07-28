// Smoke-test orchestrator. Usage:
//   SMOKE_BASE_URL=https://... SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... npx tsx scripts/smoke/run-all.ts [--readonly]
//
// Auto-discovers checks/*.smoke.ts — add a new domain check by dropping a
// new file there, no changes needed here.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeClient } from './client'
import { login } from './auth'
import type { SmokeCheck, SmokeOutcome } from './types'

async function main() {
  const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000'
  const email = process.env.SMOKE_ADMIN_EMAIL
  const password = process.env.SMOKE_ADMIN_PASSWORD
  const readonly = process.argv.includes('--readonly')

  if (!email || !password) {
    console.error('[smoke] SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD must be set')
    process.exit(1)
  }

  const client = makeClient(baseUrl, process.env.VERCEL_AUTOMATION_BYPASS_SECRET)
  const user = await login(client, email, password)
  console.log(`[smoke] logged in as ${user.email} (${user.role}) against ${baseUrl}${readonly ? ' [readonly]' : ''}`)

  const checksDir = path.join(__dirname, 'checks')
  const files = readdirSync(checksDir)
    .filter((f) => f.endsWith('.smoke.ts'))
    .sort()

  const results: Array<{ name: string } & SmokeOutcome> = []

  for (const file of files) {
    const name = file.replace(/\.smoke\.ts$/, '')
    const mod = await import(pathToFileURL(path.join(checksDir, file)).href)
    const run: SmokeCheck = mod.default
    try {
      const outcome = await run({ client, user, readonly, baseUrl })
      results.push({ name, ...outcome })
    } catch (err) {
      results.push({ name, status: 'fail', message: err instanceof Error ? err.message : String(err) })
    }
  }

  console.log('\n[smoke] Results:')
  let failed = 0
  for (const r of results) {
    const icon = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP' : 'FAIL'
    console.log(`  [${icon}] ${r.name}${r.message ? ` — ${r.message}` : ''}`)
    if (r.status === 'fail') failed++
  }
  console.log(`\n[smoke] ${results.length} checks, ${failed} failed.`)
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('[smoke] fatal error:', err)
  process.exit(1)
})
