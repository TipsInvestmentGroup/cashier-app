import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { seedProducts } from '@/lib/seed-products'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) import of the tips product catalogue (146 products).
 * Open in a browser:
 *   https://<your-app>.vercel.app/api/admin/seed-products?secret=<CRON_SECRET>
 * Matches on the unique product code (SKU) — safe to re-run; updates prices
 * on products that already exist rather than creating duplicates.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  const provided = req.nextUrl.searchParams.get('secret')
  if (provided !== secret) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })

  try {
    const result = await seedProducts(prisma)
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Product import complete — ${result.created} added, ${result.updated} updated (${result.total} total).`,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Product import failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
