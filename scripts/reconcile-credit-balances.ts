// Rebuilds the credit ledger (CreditTransaction) and materialized
// CreditAccount.currentBalance for every account from the authoritative
// SignedBill / PaidBill / SignedBillWriteOff A/R. This is the AUTHORITY for the
// balance — run it on a schedule and after bulk imports/migrations. Drift-proof
// by construction (delete-then-recreate from source), so it's always safe to
// re-run; it self-corrects any divergence the incremental write-path hooks
// might have missed.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage: npx tsx scripts/reconcile-credit-balances.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { reconcileAllCreditLedgers } from '../lib/credit-ledger'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  console.log('🔁 Reconciling credit ledger + balances…')
  const res = await reconcileAllCreditLedgers(prisma)
  const ledgerRows = await prisma.creditTransaction.count()
  console.log(`✅ Accounts: ${res.accounts} | with a balance: ${res.nonZero} | ledger rows: ${ledgerRows} | total outstanding: ${res.totalOutstanding.toLocaleString('en-US')}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
