import { defineConfig } from 'prisma/config'
import 'dotenv/config'

// Provider (sqlite vs postgresql) is set by scripts/prepare-db.mjs based on
// DATABASE_URL before generate/push. The CLI connects via datasource.url.
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    // Use the DIRECT (unpooled) connection for schema push / migrations.
    // Neon's pooled URL can fail DDL; the unpooled one is reliable for `db push`.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'file:./dev.db',
  },
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
})
