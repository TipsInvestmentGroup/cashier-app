/**
 * Verify that THIS CI run actually produced a live Vercel deployment.
 *
 * Why this exists — the false-green incident of 2026-08-04:
 *   `vercel deploy --prebuilt --prod` died on a hard account quota
 *     Error: Too many requests - try again in 24 hours
 *            (more than 5000, code: "api-upload-free")
 *   after `Uploading (0.0B/4.4MB)` — zero bytes, no deployment created.
 *   The workflow's `|| true` swallowed it, and the old verification
 *     vercel ls --meta githubCommitSha=$SHA  ->  deployments[0].state === 'READY'
 *   then matched Vercel's OWN git-integration deployment for the same commit —
 *   created 3m22s BEFORE `vercel deploy` even started — and reported success.
 *   Three of five "successful" production runs deployed nothing this way
 *   (af51043, 4addee3, 7d628ea), while seed + smoke passed against the stale
 *   build and corroborated the lie.
 *
 * So a deployment only counts as ours when ALL of these hold:
 *   - meta.githubCommitSha === the commit this run is building
 *   - created >= a watermark taken BEFORE we deploy (excludes pre-existing ones)
 *   - source === 'cli'          (excludes Vercel's git-integration deployments)
 *   - production mode: target === 'production'
 *       NB: `vercel ls`/the API report target `null` for previews, never
 *       "preview" — so this must be a positive equality test, not `!== 'preview'`.
 *   - preview mode: url === the host the CLI itself printed
 *   - state/readyState === 'READY'
 * and, in production mode, the production alias must actually resolve to it
 * (checked via GET /v4/aliases/<host>, the authoritative resolver — the
 * "Aliases" block of `vercel inspect` lists aliases assigned at deploy time and
 * is NOT proof of current ownership).
 *
 * Uses the REST API rather than `vercel ls` because only the API exposes
 * `source`, which is the field that distinguishes our CLI deploy from Vercel's
 * git-integration build of the same commit.
 *
 * Usage:
 *   node scripts/ci/verify-vercel-deploy.mjs --mode=production
 *   node scripts/ci/verify-vercel-deploy.mjs --mode=production --exists-only
 *   node scripts/ci/verify-vercel-deploy.mjs --mode=preview --expect-url=<host>
 *
 * Env: VERCEL_TOKEN, GITHUB_SHA, SINCE_MS, VERCEL_PROJECT (default cashier-app),
 *      PROD_HOST (production mode only), GITHUB_OUTPUT (optional).
 */
import { appendFileSync } from 'node:fs'

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const flag = (name) => process.argv.includes(`--${name}`)
const need = (key) => {
  const v = process.env[key]
  if (!v) {
    console.error(`verify-vercel-deploy: missing required env ${key}`)
    process.exit(1)
  }
  return v
}

const MODE = arg('mode')
if (MODE !== 'production' && MODE !== 'preview') {
  console.error('verify-vercel-deploy: --mode must be "production" or "preview"')
  process.exit(1)
}
const EXISTS_ONLY = flag('exists-only')
const EXPECT_URL = (arg('expect-url') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
if (MODE === 'preview' && !EXPECT_URL && !EXISTS_ONLY) {
  console.error('verify-vercel-deploy: --mode=preview requires --expect-url=<host>')
  process.exit(1)
}

const TOKEN = need('VERCEL_TOKEN')
const SHA = need('GITHUB_SHA')
const SINCE_MS = Number(need('SINCE_MS'))
if (!Number.isFinite(SINCE_MS) || SINCE_MS <= 0) {
  console.error(`verify-vercel-deploy: SINCE_MS must be an epoch-ms number, got "${process.env.SINCE_MS}"`)
  process.exit(1)
}
const PROJECT = process.env.VERCEL_PROJECT || 'cashier-app'

// Deployment wait budget. A cold production build here has taken ~2min; 12min
// leaves generous headroom without letting a wedged run hold the job forever.
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 12 * 60_000)
const ALIAS_TIMEOUT_MS = Number(process.env.ALIAS_TIMEOUT_MS || 5 * 60_000)
const POLL_MS = 15_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const stateOf = (d) => d.readyState || d.state || 'UNKNOWN'
const createdOf = (d) => Number(d.created ?? d.createdAt ?? 0)

async function api(path) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`GET ${path}: HTTP ${res.status} returned non-JSON`)
  }
  if (!res.ok || body.error) {
    throw new Error(`GET ${path}: HTTP ${res.status} ${body.error ? body.error.code || body.error.message : ''}`)
  }
  return body
}

// Transient API/network hiccups must not be read as "deployment absent" —
// that is the class of silent-fallback bug this script exists to prevent.
async function apiWithRetry(path, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await api(path)
    } catch (err) {
      lastErr = err
      console.log(`  (api attempt ${i}/${attempts} failed: ${err.message})`)
      if (i < attempts) await sleep(3000)
    }
  }
  throw lastErr
}

const project = await apiWithRetry(`/v9/projects/${PROJECT}`)
if (!project.id) throw new Error(`cannot resolve project id for "${PROJECT}"`)
const projectId = project.id

/** Deployments that are unambiguously the product of THIS run. */
async function ours() {
  const qs = new URLSearchParams({ projectId, limit: '20', 'meta-githubCommitSha': SHA })
  if (MODE === 'production') qs.set('target', 'production')
  const { deployments = [] } = await apiWithRetry(`/v6/deployments?${qs}`)
  return deployments.filter((d) => {
    if ((d.meta || {}).githubCommitSha !== SHA) return false
    if (createdOf(d) < SINCE_MS) return false // pre-existing / earlier run
    if (d.source !== 'cli') return false // Vercel's git integration, not us
    if (MODE === 'production') return d.target === 'production'
    return EXPECT_URL ? d.url === EXPECT_URL : true
  })
}

if (EXISTS_ONLY) {
  const found = await ours()
  console.log(`exists-only: ${found.length} matching deployment(s)`)
  process.exit(found.length > 0 ? 0 : 1)
}

// ── 1. wait for a deployment that is genuinely ours to reach READY ──
let deployment = null
const readyDeadline = Date.now() + READY_TIMEOUT_MS
while (Date.now() < readyDeadline) {
  const found = await ours()
  const ready = found.find((d) => stateOf(d) === 'READY')
  if (ready) {
    deployment = ready
    break
  }
  const dead = found.find((d) => ['ERROR', 'CANCELED', 'DELETED'].includes(stateOf(d)))
  if (dead) {
    console.error(`FAIL: our deployment ${dead.uid} ended in state ${stateOf(dead)}`)
    process.exit(1)
  }
  console.log(
    found.length
      ? `waiting: ${found.map((d) => `${d.uid}=${stateOf(d)}`).join(', ')}`
      : `waiting: no source=cli${MODE === 'production' ? ' target=production' : ''} deployment for ${SHA} created after the watermark yet`
  )
  await sleep(POLL_MS)
}
if (!deployment) {
  console.error(
    `FAIL: this run produced no READY ${MODE} deployment for ${SHA}.\n` +
      '       A deployment created by Vercel\'s git integration, or one from an\n' +
      '       earlier run, does NOT count. The deploy did not happen.'
  )
  process.exit(1)
}
console.log(`OK: ${MODE} deployment ${deployment.uid} (${deployment.url}) is READY`)

// ── 2. production only: the alias must actually serve it ──
if (MODE === 'production') {
  const host = need('PROD_HOST').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  let resolved = null
  const aliasDeadline = Date.now() + ALIAS_TIMEOUT_MS
  while (Date.now() < aliasDeadline) {
    const alias = await apiWithRetry(`/v4/aliases/${host}`)
    resolved = (alias.deployment && alias.deployment.id) || alias.deploymentId || null
    if (resolved === deployment.uid) {
      console.log(`OK: production alias ${host} resolves to ${deployment.uid}`)
      break
    }
    console.log(`waiting: alias ${host} still resolves to ${resolved || 'nothing'}`)
    await sleep(10_000)
  }
  if (resolved !== deployment.uid) {
    console.error(
      `FAIL: production alias ${host} resolves to ${resolved || 'nothing'}, expected ${deployment.uid}.\n` +
        '       The build succeeded but is not what production serves.'
    )
    process.exit(1)
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `id=${deployment.uid}\nurl=https://${deployment.url}\n`)
}
console.log(`verified: ${SHA} is live (${deployment.uid})`)
