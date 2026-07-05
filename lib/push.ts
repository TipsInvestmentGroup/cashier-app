import webpush from 'web-push'
import { prisma } from '@/lib/prisma'

let configured = false
function ensureConfigured() {
  if (configured) return true
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications are disabled. Check the env vars in Vercel and redeploy.')
    return false
  }
  // The VAPID spec requires the subject to be a full URL or a mailto: URI —
  // a bare email address (a common copy-paste mistake) fails at send time
  // with a cryptic error. Catch it here instead, with a fix in the message.
  let subject = VAPID_SUBJECT || 'mailto:admin@tips.co.tz'
  if (!/^(mailto:|https?:\/\/)/i.test(subject)) {
    console.error(`[push] VAPID_SUBJECT "${subject}" is missing the required "mailto:" or "https://" prefix — using mailto: automatically. Fix the env var to mailto:${subject} in Vercel.`)
    subject = `mailto:${subject}`
  }
  webpush.setVapidDetails(subject, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

export interface PushResult { attempted: number; sent: number; failed: { error: string; statusCode?: number }[] }

/**
 * Sends a real OS-level push notification to every device a user has
 * subscribed on. Returns a summary (attempted/sent/failed) so callers that
 * care can surface it — the fire-and-forget callers (e.g. counter route)
 * just log it, but /api/push/test uses it to show the caller exactly why a
 * delivery failed instead of a silent no-op.
 * Prunes subscriptions the push service reports as gone (404/410 — expired
 * or uninstalled) so they don't keep failing forever.
 */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }): Promise<PushResult> {
  if (!ensureConfigured()) return { attempted: 0, sent: 0, failed: [{ error: 'VAPID keys not configured on the server' }] }

  const subs = await db.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return { attempted: 0, sent: 0, failed: [] }

  const json = JSON.stringify(payload)
  const failed: { error: string; statusCode?: number }[] = []
  let sent = 0

  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json)
        sent++
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        const message = (err as { body?: string; message?: string })?.body || (err as Error)?.message || 'Unknown error'
        console.error(`[push] Delivery failed for subscription ${s.id} (userId=${userId}): statusCode=${statusCode} message=${message}`)
        failed.push({ error: message, statusCode })
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is dead (browser data cleared, uninstalled, etc.) — remove it.
          await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
        }
      }
    })
  )

  return { attempted: subs.length, sent, failed }
}
