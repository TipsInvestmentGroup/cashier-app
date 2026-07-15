import { prisma } from '@/lib/prisma'

/** Case/whitespace-insensitive identity key for a person's name. */
export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Finds an existing active person with the same normalized name (excluding `excludeId`). */
export async function findDuplicatePersonByName(name: string, excludeId?: string) {
  const key = normalizePersonName(name)
  if (!key) return null
  const candidates = await prisma.person.findMany({
    where: { isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true },
  })
  return candidates.find((p) => normalizePersonName(p.name) === key) || null
}
