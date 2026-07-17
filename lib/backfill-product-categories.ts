// Shared logic for the Product.category (free text) -> ProductCategory
// backfill — used by both scripts/backfill-product-categories.ts (local) and
// app/api/admin/backfill-product-categories/route.ts (prod, secret-gated).
// See prisma/schema.prisma's comment on Product.category for why both the
// legacy string and the new relation coexist.

function slugify(label: string): string {
  return label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'CATEGORY'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function backfillProductCategories(prisma: any) {
  const products: { id: string; category: string | null }[] = await prisma.product.findMany({ where: { category: { not: null } }, select: { id: true, category: true } })
  const labels: string[] = [...new Set(products.map((p) => (p.category as string).trim()).filter(Boolean))]

  const idByLabel = new Map<string, string>()
  for (const label of labels) {
    const code = slugify(label)
    const cat: { id: string } = await prisma.productCategory.upsert({ where: { code }, update: { label }, create: { code, label } })
    idByLabel.set(label, cat.id)
  }

  let updated = 0
  for (const p of products) {
    const categoryId = idByLabel.get((p.category as string).trim())
    if (!categoryId) continue
    await prisma.product.update({ where: { id: p.id }, data: { categoryId } })
    updated++
  }

  return { categoriesCreated: labels.length, productsUpdated: updated, productsTotal: products.length }
}
