import * as Sentry from '@sentry/nextjs'

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

export async function register() {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.1,
    enabled: process.env.NODE_ENV === 'production',
  })
}

// Captures errors thrown in server components / route handlers (Next 15+).
export const onRequestError = Sentry.captureRequestError
