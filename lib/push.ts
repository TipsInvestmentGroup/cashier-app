import webpush from 'web-push'
import { prisma } from '@/lib/prisma'

let configured = false
function ensureConfigured() {
  if (configured) return true
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@tips.co.tz', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
  return true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Sends a real OS-level push notification to every device a user has
 * subscribed on. Best-effort: silently no-ops if VAPID keys aren't
 * configured (e.g. local dev without them), and prunes subscriptions the
 * push service reports as gone (expired/uninstalled) so they don't keep
 * failing forever.
 */
export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string }) {
  if (!ensureConfigured()) return

  const subs = await db.pushSubscription.findMany({ where: { userId } })
  if (subs.length === 0) return

  const json = JSON.stringify(payload)
  await Promise.all(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, json)
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is dead (browser data cleared, uninstalled, etc.) — remove it.
          await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {})
        }
      }
    })
  )
}
