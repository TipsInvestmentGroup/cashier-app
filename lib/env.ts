// Fail-fast environment validation, run once at boot (see instrumentation.ts).
// Existing process.env.X reads elsewhere in the app are unaffected — this is
// an additive startup check, not a replacement for them.
const REQUIRED_ALWAYS = ['JWT_SECRET', 'DATABASE_URL', 'CRON_SECRET'] as const
const REQUIRED_PRODUCTION_ONLY = ['SMTP_HOST', 'SMTP_FROM'] as const

export function validateEnv(env: NodeJS.ProcessEnv = process.env) {
  const missing: string[] = []
  for (const key of REQUIRED_ALWAYS) if (!env[key]) missing.push(key)
  // The owner address is server-side only now (lib/owner.ts). Prefer OWNER_EMAIL; the legacy
  // NEXT_PUBLIC_OWNER_EMAIL is still accepted so existing deployments need no env change.
  if (!env.OWNER_EMAIL && !env.NEXT_PUBLIC_OWNER_EMAIL) missing.push('OWNER_EMAIL (or legacy NEXT_PUBLIC_OWNER_EMAIL)')
  if (env.NODE_ENV === 'production') {
    for (const key of REQUIRED_PRODUCTION_ONLY) if (!env[key]) missing.push(key)
  }
  if (missing.length > 0) {
    throw new Error(`[env] Missing required environment variables: ${missing.join(', ')}`)
  }
}
