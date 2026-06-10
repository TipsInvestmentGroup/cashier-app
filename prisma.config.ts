import { defineConfig } from 'prisma/config'
import 'dotenv/config'

// Provider (sqlite vs postgresql) is set by scripts/prepare-db.mjs based on
// DATABASE_URL before generate/push. The CLI connects via datasource.url.
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL || 'file:./dev.db',
  },
  migrations: {
    seed: 'npx tsx prisma/seed.ts',
  },
})
