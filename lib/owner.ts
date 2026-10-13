/**
 * System-owner identity — SERVER ONLY.
 *
 * The owner email used to be read from `NEXT_PUBLIC_OWNER_EMAIL` in ~25 places,
 * including client pages, which compiled the address into the public browser
 * bundle (anyone could read who the all-powerful account is, and target it).
 * It is now read on the server only: prefer the non-public `OWNER_EMAIL`, and
 * fall back to `NEXT_PUBLIC_OWNER_EMAIL` so existing deployments keep working
 * with no env change. Client UI learns whether the signed-in user is the owner
 * from the `isOwner` flag the auth endpoints return, never from the address.
 *
 * Do NOT import this from a 'use client' component.
 */
export function ownerEmail(): string {
  return (process.env.OWNER_EMAIL || process.env.NEXT_PUBLIC_OWNER_EMAIL || '').trim().toLowerCase()
}

export function isOwnerEmail(email?: string | null): boolean {
  const owner = ownerEmail()
  return !!owner && (email || '').trim().toLowerCase() === owner
}

/**
 * Is this session's user the OWNER of the company the session is bound to?
 * With a company claim the answer is the membership's own `owner` flag - owner power never travels to
 * another company just because the same email happens to be a member there. A legacy token without a
 * company claim falls back to the single-owner email (the pre-multi-company behaviour).
 */
export function isCompanyOwner(user: { email?: string | null; companyId?: string | null; owner?: boolean | null }): boolean {
  if (user.companyId) return !!user.owner
  return isOwnerEmail(user.email)
}
