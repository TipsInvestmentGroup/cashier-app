// Checks configuration is complete and consistent for the target environment
// before a deploy proceeds. Run via: npx tsx scripts/validate-config.ts --env=<ci|staging|production>
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ENV_ARG = process.argv.find((a) => a.startsWith('--env='))?.split('=')[1] ?? 'ci'
const VALID_ENVS = ['ci', 'staging', 'production']

function fail(msg: string): never {
  console.error(`[validate-config] FAIL: ${msg}`)
  process.exit(1)
}

if (!VALID_ENVS.includes(ENV_ARG)) {
  fail(`Unknown --env=${ENV_ARG}, expected one of ${VALID_ENVS.join(', ')}`)
}

// Vars that are legitimately optional (e.g. Sentry/VAPID are opt-in features,
// the *_UNPOOLED/NON_POOLING vars are alternates and only one is required).
const OPTIONAL = [
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'APP_URL',
]

// 1. .env.example completeness — every non-optional key listed there must be
//    set for a real deploy target (skipped for `ci`, which has no secrets).
if (ENV_ARG !== 'ci') {
  const exampleKeys = readFileSync(path.join(process.cwd(), '.env.example'), 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
    .filter((key): key is string => Boolean(key))

  const missing = exampleKeys.filter((key) => !OPTIONAL.includes(key) && !process.env[key])
  if (missing.length > 0) {
    fail(`Missing required env vars for ${ENV_ARG}: ${missing.join(', ')}`)
  }
}

// 2. migration_lock.toml must match the target provider for staging/production
//    — catches the sqlite/postgresql mismatch this pipeline was built to fix.
if (ENV_ARG === 'staging' || ENV_ARG === 'production') {
  const lockPath = path.join(process.cwd(), 'prisma/migrations/migration_lock.toml')
  const lock = readFileSync(lockPath, 'utf8')
  if (!/provider\s*=\s*"postgresql"/.test(lock)) {
    fail(`prisma/migrations/migration_lock.toml is not locked to "postgresql" — required before deploying to ${ENV_ARG}.`)
  }

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || ''
  if (!/^postgres(ql)?:\/\//.test(url)) {
    fail(`DATABASE_URL for ${ENV_ARG} does not look like a Postgres connection string.`)
  }
}

// 3. Reject known-insecure defaults.
if (process.env.JWT_SECRET === 'fallback-secret') {
  fail('JWT_SECRET is unset / using the local fallback value — refusing to deploy.')
}
if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 16) {
  fail('CRON_SECRET is too short (<16 chars).')
}

console.log(`[validate-config] OK for env=${ENV_ARG}`)
