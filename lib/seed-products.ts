import type { PrismaClient } from '@prisma/client'
import { roundMoney } from '@/lib/utils'
import data from '@/lib/seed-products-data.json'

export interface SeedProduct {
  code: string
  name: string
  category: string
  buyingPrice: number
  sellingPrice: number
}

export const SEED_PRODUCTS = data as SeedProduct[]

/**
 * Idempotent bulk import of the tips product catalogue.
 * Matches on the unique `code` (the SKU from the Product Master, e.g. TIPS-VG-0050),
 * so re-running updates prices instead of creating duplicates.
 * Returns counts of created / updated rows.
 */
export async function seedProducts(prisma: PrismaClient) {
  let created = 0
  let updated = 0

  for (const p of SEED_PRODUCTS) {
    const existing = await prisma.product.findUnique({ where: { code: p.code } })
    if (existing) {
      await prisma.product.update({
        where: { code: p.code },
        data: {
          name: p.name,
          category: p.category,
          buyingPrice: roundMoney(p.buyingPrice),
          sellingPrice: roundMoney(p.sellingPrice),
        },
      })
      updated++
    } else {
      await prisma.product.create({
        data: {
          code: p.code,
          name: p.name,
          category: p.category,
          buyingPrice: roundMoney(p.buyingPrice),
          sellingPrice: roundMoney(p.sellingPrice),
          unitMeasure: 'unit',
        },
      })
      created++
    }
  }

  return { total: SEED_PRODUCTS.length, created, updated }
}
