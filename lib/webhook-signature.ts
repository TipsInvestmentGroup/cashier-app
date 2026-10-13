import crypto from 'crypto'

/**
 * HMAC-SHA256 signing for inbound payment webhooks.
 *
 * The sender computes  hex( HMAC_SHA256(secret, rawRequestBody) )  and sends it in
 * the `x-signature` header (a leading `sha256=` prefix is tolerated, as GitHub-style
 * senders add one). We verify against the RAW body bytes — never a re-serialised
 * JSON object — and compare in constant time.
 *
 * Provider-specific schemes (different header names / canonicalisation) are an
 * adapter concern; this is the generic baseline that makes the endpoint
 * un-forgeable by anyone who merely knows a connector id.
 */

export const WEBHOOK_SIGNATURE_HEADER = 'x-signature'

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function signWebhookBody(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false
  const provided = header.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(provided)) return false
  const expected = signWebhookBody(secret, rawBody)
  return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
}

/** Parse a connector's JSON `config` column defensively. */
export function parseConnectorConfig(config: string | null | undefined): Record<string, unknown> {
  if (!config) return {}
  try {
    const v = JSON.parse(config)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** The connector config as safe to return to a client: the signing secret is never echoed. */
export function redactConnector<T extends { config: string | null }>(c: T): Omit<T, 'config'> & { config: Record<string, unknown>; hasWebhookSecret: boolean } {
  const cfg = parseConnectorConfig(c.config)
  const has = typeof cfg.webhookSecret === 'string' && cfg.webhookSecret.length > 0
  delete cfg.webhookSecret
  return { ...c, config: cfg, hasWebhookSecret: has }
}
