import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { backfillProductCategories } from '@/lib/backfill-product-categories'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * One-time (idempotent) migration of Product.category free text into real
 * ProductCategory rows. Open in a browser:
 *   https://<your-app>.vercel.app/api/admin/backfill-product-categories?secret=<CRON_SECRET>
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  const provided = req.nextUrl.searchParams.get('secret')
  if (provided !== secret) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })

  try {
    const result = await backfillProductCategories(prisma)
    return NextResponse.json({
      ok: true,
      ...result,
      message: `Backfill complete — ${result.categoriesCreated} categor${result.categoriesCreated === 1 ? 'y' : 'ies'}, ${result.productsUpdated}/${result.productsTotal} products updated.`,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Backfill failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
