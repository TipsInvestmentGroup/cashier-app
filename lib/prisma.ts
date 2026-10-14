import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { tenantStampExtension } from '@/lib/tenant-stamp'
import { tenantGuardExtension } from '@/lib/tenant-guard'

interface Clients {
  /** The app's client: stamps new rows with their company AND (inside a signed-in request) confines every query to
   *  the session's company and rejects cross-company references. See lib/tenant-guard.ts. */
  prisma: PrismaClient
  /** Stamps new rows but does NOT scope reads/writes. Only for identity code that must look across companies
   *  (sign-in, company switching, the platform console, the tenant layer itself) - never for business data. */
  prismaSystem: PrismaClient
}

const globalForPrisma = globalThis as unknown as { clients: Clients | undefined }

function createClients(): Clients {
  const url = process.env.DATABASE_URL || 'file:./dev.db'
  const isPg = /^postgres(ql)?:\/\//.test(url)
  const adapter = isPg ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = new PrismaClient({ adapter } as any)
  // The casts keep the exported type the familiar PrismaClient - the extensions only wrap queries and do not change
  // any model API. TENANT_STAMP=off / TENANT_GUARD=off are emergency switches (see docs/MULTI-TENANT-PHASE3/4.md).
  const stamped = (process.env.TENANT_STAMP === 'off' ? base : base.$extends(tenantStampExtension(base))) as unknown as PrismaClient
  const scoped = (process.env.TENANT_GUARD === 'off' ? stamped : (stamped.$extends(tenantGuardExtension(base)))) as unknown as PrismaClient
  return { prisma: scoped, prismaSystem: stamped }
}

const clients = globalForPrisma.clients ?? createClients()
export const prisma = clients.prisma
export const prismaSystem = clients.prismaSystem

if (process.env.NODE_ENV !== 'production') globalForPrisma.clients = clients
