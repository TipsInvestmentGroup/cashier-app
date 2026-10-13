import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { tenantStampExtension } from '@/lib/tenant-stamp'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL || 'file:./dev.db'
  const isPg = /^postgres(ql)?:\/\//.test(url)
  const adapter = isPg ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = new PrismaClient({ adapter } as any)
  // Stamp every new tenant-owned row with its company (lib/tenant-stamp.ts). TENANT_STAMP=off is an emergency
  // switch that returns the plain client. The cast keeps the exported type the familiar PrismaClient - the
  // extension only wraps create/createMany/upsert and does not change any model API.
  if (process.env.TENANT_STAMP === 'off') return base
  return base.$extends(tenantStampExtension(base)) as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
