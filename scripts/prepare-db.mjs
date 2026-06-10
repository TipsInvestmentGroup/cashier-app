// Sets the Prisma datasource `provider` in schema.prisma to match DATABASE_URL.
//   postgres://... | postgresql://...  -> postgresql   (cloud / production)
//   file:... (or unset)                -> sqlite        (local dev)
// Run before `prisma generate` / `prisma db push` / build.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma')

const url = process.env.DATABASE_URL || 'file:./dev.db'
const provider = /^postgres(ql)?:\/\//.test(url) ? 'postgresql' : 'sqlite'

let schema = readFileSync(schemaPath, 'utf8')
const before = schema
schema = schema.replace(/provider\s*=\s*"(sqlite|postgresql)"/, `provider = "${provider}"`)

if (schema !== before) {
  writeFileSync(schemaPath, schema)
  console.log(`[prepare-db] datasource provider set to "${provider}" (from DATABASE_URL)`)
} else {
  console.log(`[prepare-db] datasource provider already "${provider}"`)
}
