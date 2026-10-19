// Self-contained test of the multi-company Prisma guard. Builds its own two-company fixture in a THROWAWAY SQLite file:
//
//   DATABASE_URL=file:./tmp-tenancy.db npx prisma db push
//   DATABASE_URL=file:./tmp-tenancy.db npx tsx scripts/test-tenancy-guard.ts
//
// Refuses to run against anything that is not a local `file:` database. Exit code 0 = all checks passed.
import { prisma, prismaSystem } from '../lib/prisma'
import { runAsCompany } from '../lib/tenant-context'
import { TenantAccessError } from '../lib/tenant-guard'
import { aliasCompanyKey, companyKey, forEachCompany, legacyAuthorityApplies, resolvePickerCompany, sessionOwnerEmail } from '../lib/tenant'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { postJournalEntry } from '../lib/ledger'
import { createPurchaseOrder, issueTransfer, receiveGrn } from '../lib/stock'
import { allocateRequestNumber } from '../lib/expense-requests'
import { generateBillReference } from '../lib/bill-reference'
import { documentCompanyId, nextDocNumber, raiseDocCounter, seedFromIssued } from '../lib/doc-numbering'
import { signToken } from '../lib/auth'
import { NextRequest } from 'next/server'

const url = process.env.DATABASE_URL || ''
if (!/^file:/.test(url)) throw new Error('refusing to run: DATABASE_URL must be a local file: SQLite database (this test writes data)')

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} ${ok ? '' : extra}`) }
const isTenantError = (e: unknown) => e instanceof TenantAccessError || (e as Error)?.name === 'TenantAccessError'
const rejectsTenant = async (f: () => Promise<unknown>) => { try { await f(); return false } catch (e) { return isTenantError(e) } }
const rejects = async (f: () => Promise<unknown>) => { try { await f(); return false } catch { return true } }
const as = <T>(c: string, f: () => Promise<T>) => runAsCompany(c, f)

async function main() {
  // ---------------------------------------------------------------- fixture: A is the ORIGINAL (oldest) company
  const A = 'co_alpha', B = 'co_beta'
  await prismaSystem.company.create({ data: { id: A, name: 'Alpha', slug: 'alpha', createdAt: new Date('2020-01-01') } })
  await prismaSystem.company.create({ data: { id: B, name: 'Beta', slug: 'beta', createdAt: new Date('2021-01-01') } })
  await prismaSystem.outlet.create({ data: { id: 'out_a', name: 'A Main', companyId: A } })
  await prismaSystem.outlet.create({ data: { id: 'out_b', name: 'B Main', companyId: B } })
  await prismaSystem.outlet.create({ data: { id: 'out_legacy', name: 'Legacy Outlet', companyId: null } }) // no company yet
  const mkUser = (id: string, email: string) => prismaSystem.user.create({ data: { id, name: id, email, password: 'x', role: 'ADMIN' } })
  await mkUser('u_a', 'a@alpha.test'); await mkUser('u_b', 'b@beta.test'); await mkUser('u_shared', 'both@x.test'); await mkUser('u_legacy', 'legacy@alpha.test')
  await prismaSystem.membership.create({ data: { userId: 'u_a', companyId: A, role: 'ADMIN' } })
  await prismaSystem.membership.create({ data: { userId: 'u_b', companyId: B, role: 'ADMIN', isOwner: true } })
  await prismaSystem.membership.create({ data: { userId: 'u_shared', companyId: A, role: 'MANAGER' } })
  await prismaSystem.membership.create({ data: { userId: 'u_shared', companyId: B, role: 'CASHIER' } })
  // u_legacy has NO membership at all (not yet backfilled)
  await prismaSystem.account.create({ data: { id: 'acc_a', companyId: A, code: '1000', name: 'A Cash', type: 'ASSET' } })
  await prismaSystem.account.create({ data: { id: 'acc_b', companyId: B, code: '1000', name: 'B Cash', type: 'ASSET' } })
  await prismaSystem.posTable.create({ data: { id: 't_a', outletId: 'out_a', number: 1 } })
  await prismaSystem.posTable.create({ data: { id: 't_b', outletId: 'out_b', number: 1 } })
  await prismaSystem.posTable.create({ data: { id: 't_null', outletId: 'out_legacy', number: 2, companyId: null } })
  await prismaSystem.salesStaffAlias.create({ data: { alias: 'legacy-alias', staffName: 'X', companyId: '' } })
  await prismaSystem.salesStaffAlias.create({ data: { alias: 'b-alias', staffName: 'Y', companyId: B } })
  const product = (id: string, code: string, companyId: string) => prismaSystem.product.create({ data: { id, name: id, code, category: 'X', unitMeasure: 'PCS', sellingPrice: 1, buyingPrice: 1, companyId } as never })
  await product('p_a', 'PA', A); await product('p_b', 'PB', B)
  // (scope, scopeId) configuration: platform default + each company's own + each outlet's own + a legacy ROLE row
  const cfg = (scope: string, scopeId: string | null) => prismaSystem.businessDayPolicyConfig.create({ data: { scope, scopeId } })
  const cGlobal = await cfg('GLOBAL', null); const cA = await cfg('COMPANY', A); const cB = await cfg('COMPANY', B)
  const cOa = await cfg('OUTLET', 'out_a'); const cOb = await cfg('OUTLET', 'out_b'); const cRole = await cfg('ROLE', 'CASHIER')

  // a parent root with child rows (children have NO company column: they are scoped through the parent)
  await prismaSystem.pettyFund.create({ data: { id: 'pf_a', name: 'A fund', outletId: 'out_a', companyId: A } })
  await prismaSystem.pettyFund.create({ data: { id: 'pf_b', name: 'B fund', outletId: 'out_b', companyId: B } })
  await prismaSystem.pettyFundTxn.create({ data: { id: 'tx_a', fundId: 'pf_a', type: 'IN', amount: 10 } })
  await prismaSystem.pettyFundTxn.create({ data: { id: 'tx_b', fundId: 'pf_b', type: 'IN', amount: 20 } })
  // an audit trail: its GLOBAL rows are the original company's history
  const aud = (scope: string, scopeId: string | null, field: string) => prismaSystem.businessCalendarAuditLog.create({ data: { scope, scopeId, field } })
  const auGlobal = await aud('GLOBAL', null, 'g'); const auA = await aud('COMPANY', A, 'a'); const auB = await aud('COMPANY', B, 'b')

  // ---------------------------------------------------------------- required-company models (the earlier 500s)
  const accA = await as(A, () => prisma.account.findMany()); const accB = await as(B, () => prisma.account.findMany())
  check('required-company model: ORIGINAL company reads its rows without error', accA.length === 1 && accA[0].id === 'acc_a')
  check('required-company model: other company reads only its own', accB.length === 1 && accB[0].id === 'acc_b')
  check('required-company model: findUnique across companies -> null', (await as(B, () => prisma.account.findUnique({ where: { id: 'acc_a' } }))) === null)

  // ---------------------------------------------------------------- legacy rows (NULL / '') belong to the original company
  const tA = await as(A, () => prisma.posTable.findMany({ orderBy: { id: 'asc' } })), tB = await as(B, () => prisma.posTable.findMany())
  check('original company sees its rows AND NULL-company stragglers', tA.map((r) => r.id).join() === 't_a,t_null', tA.map((r) => r.id).join())
  check('other company sees only its own rows (never NULL stragglers)', tB.length === 1 && tB[0].id === 't_b')
  const oA = await as(A, () => prisma.outlet.findMany({ orderBy: { id: 'asc' } })), oB = await as(B, () => prisma.outlet.findMany())
  check('outlets: original sees its own + company-less; other sees only its own', oA.map((o) => o.id).join() === 'out_a,out_legacy' && oB.map((o) => o.id).join() === 'out_b', `${oA.map((o) => o.id)} / ${oB.map((o) => o.id)}`)
  const sA = await as(A, () => prisma.salesStaffAlias.findMany()), sB = await as(B, () => prisma.salesStaffAlias.findMany())
  check("alias tables: the legacy '' key belongs to the original company only", sA.some((r) => r.alias === 'legacy-alias') && !sA.some((r) => r.alias === 'b-alias') && sB.length === 1 && sB[0].alias === 'b-alias')

  // ---------------------------------------------------------------- confinement: reads / writes / deletes / references
  check('cross-company findUnique -> null', (await as(B, () => prisma.posTable.findUnique({ where: { id: 't_a' } }))) === null)
  check('cross-company count/aggregate/groupBy are confined', (await as(B, () => prisma.posTable.count())) === 1 && (await as(B, () => prisma.posTable.aggregate({ _count: true })))._count === 1 && (await as(B, () => prisma.posTable.groupBy({ by: ['outletId'], _count: true }))).every((g) => g.outletId === 'out_b'))
  check('cross-company update rejected', await rejects(() => as(B, () => prisma.posTable.update({ where: { id: 't_a' }, data: { label: 'x' } }))))
  check('cross-company updateMany/deleteMany touch nothing', (await as(B, () => prisma.posTable.updateMany({ where: { id: 't_a' }, data: { label: 'x' } }))).count === 0 && (await as(B, () => prisma.posTable.deleteMany({ where: { id: 't_a' } }))).count === 0 && !!(await prismaSystem.posTable.findUnique({ where: { id: 't_a' } })))
  check('create at another company\'s outlet rejected', await rejectsTenant(() => as(B, () => prisma.posTable.create({ data: { outletId: 'out_a', number: 9 } }))))
  check('createMany at another company\'s outlet rejected', await rejectsTenant(() => as(B, () => prisma.posTable.createMany({ data: [{ outletId: 'out_a', number: 9 }] }))))
  check('moving a row to another company\'s outlet rejected', await rejectsTenant(() => as(B, () => prisma.posTable.update({ where: { id: 't_b' }, data: { outletId: 'out_a' } }))))
  check('foreign key to another company\'s product rejected', await rejectsTenant(() => as(B, () => prisma.stockLevel.create({ data: { productId: 'p_a', outletId: 'out_b', quantity: 1 } as never }))))
  check('...relation connect to another company\'s product rejected', await rejectsTenant(() => as(B, () => prisma.stockLevel.create({ data: { product: { connect: { id: 'p_a' } }, outletId: 'out_b', quantity: 1 } as never }))))
  check('referencing its OWN product + outlet works', !(await rejects(() => as(B, () => prisma.stockLevel.create({ data: { productId: 'p_b', outletId: 'out_b', quantity: 1 } as never })))))
  // B targets A's row through A's own key: the guard must not let it match (it falls through to create) - A's row is never changed
  await as(B, () => prisma.product.upsert({ where: { companyId_code: { companyId: A, code: 'PA' } }, update: { name: 'pwned' }, create: { name: 'pwned', code: 'PA-B2', category: 'X', unitMeasure: 'PCS', sellingPrice: 1, buyingPrice: 1, companyId: B } as never })).catch(() => null)
  check('upsert keyed to another company\'s row can never modify it', (await prismaSystem.product.findUnique({ where: { id: 'p_a' } }))?.name === 'p_a')

  // ---------------------------------------------------------------- users by membership
  const uA = (await as(A, () => prisma.user.findMany({ select: { id: true } }))).map((u) => u.id).sort().join()
  const uB = (await as(B, () => prisma.user.findMany({ select: { id: true } }))).map((u) => u.id).sort().join()
  check('original company sees its members + not-yet-backfilled users', uA === 'u_a,u_legacy,u_shared', uA)
  check('other company sees only its own members (incl. a shared person)', uB === 'u_b,u_shared', uB)
  check('cannot fetch another company\'s user by id', (await as(B, () => prisma.user.findUnique({ where: { id: 'u_a' } }))) === null)
  // a shared person holds DIFFERENT roles per company (User.role mirrors only the primary one: ADMIN here)
  const roleIds = async (c: string, role: string) => (await as(c, () => prisma.user.findMany({ where: { role }, select: { id: true } }))).map((u) => u.id).sort().join()
  check('user role filters use the role held IN THIS company (manager in Alpha)', (await roleIds(A, 'MANAGER')) === 'u_shared' && (await roleIds(B, 'MANAGER')) === '')
  check('...and cashier in Beta', (await roleIds(B, 'CASHIER')) === 'u_shared' && (await roleIds(A, 'CASHIER')) === '')
  check('...with { in: [...] } too', (await as(B, () => prisma.user.findMany({ where: { role: { in: ['CASHIER', 'DIRECTOR'] } }, select: { id: true } }))).map((u) => u.id).join() === 'u_shared')
  await prismaSystem.membership.updateMany({ where: { userId: 'u_shared', companyId: B }, data: { isActive: false } })
  check('isActive filters use the MEMBERSHIP (deactivated in Beta only)', (await as(B, () => prisma.user.count({ where: { id: 'u_shared', isActive: true } }))) === 0 && (await as(A, () => prisma.user.count({ where: { id: 'u_shared', isActive: true } }))) === 1)
  await prismaSystem.membership.updateMany({ where: { userId: 'u_shared', companyId: B }, data: { isActive: true } })
  check('un-backfilled users are matched by their legacy columns in the original company', (await as(A, () => prisma.user.findMany({ where: { role: 'ADMIN', id: 'u_legacy' }, select: { id: true } }))).length === 1)
  check('Membership is exempt (spans companies)', (await as(B, () => prisma.membership.count({ where: { userId: 'u_shared' } }))) === 2)

  // ---------------------------------------------------------------- (scope, scopeId) configuration
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort().join()
  const rA = await as(A, () => prisma.businessDayPolicyConfig.findMany()), rB = await as(B, () => prisma.businessDayPolicyConfig.findMany())
  check('config: ORIGINAL company reads GLOBAL + its COMPANY + its outlets + legacy ROLE rows', ids(rA) === ids([cGlobal, cA, cOa, cRole]), ids(rA))
  check('config: other company reads GLOBAL defaults + only its own COMPANY/OUTLET rows', ids(rB) === ids([cGlobal, cB, cOb]), ids(rB))
  check('config: other company cannot WRITE a GLOBAL default', await rejectsTenant(() => as(B, () => prisma.businessDayPolicyConfig.create({ data: { scope: 'GLOBAL', scopeId: null } }))))
  check('config: ...nor a COMPANY row for another company', await rejectsTenant(() => as(B, () => prisma.businessDayPolicyConfig.create({ data: { scope: 'COMPANY', scopeId: A } }))))
  check('config: ...nor an OUTLET row of another company\'s outlet', await rejectsTenant(() => as(B, () => prisma.businessDayPolicyConfig.create({ data: { scope: 'OUTLET', scopeId: 'out_a' } }))))
  check('config: but may write its own COMPANY row', !(await rejects(() => as(B, () => prisma.businessDayPolicyConfig.update({ where: { id: cB.id }, data: { blockCloseOnMissing: false } })))))
  check('config: updateMany cannot touch the GLOBAL default from another company', (await as(B, () => prisma.businessDayPolicyConfig.updateMany({ where: { id: cGlobal.id }, data: { defaultUnlockMinutes: 1 } }))).count === 0 && (await prismaSystem.businessDayPolicyConfig.findUnique({ where: { id: cGlobal.id } }))?.defaultUnlockMinutes === 30)
  check('config: the original company MAY change the shared GLOBAL row', (await as(A, () => prisma.businessDayPolicyConfig.updateMany({ where: { id: cGlobal.id }, data: { defaultUnlockMinutes: 45 } }))).count === 1)

  // ---------------------------------------------------------------- child tables are scoped through their parent
  const kidsA = (await as(A, () => prisma.pettyFundTxn.findMany())).map((r) => r.id).join()
  const kidsB = (await as(B, () => prisma.pettyFundTxn.findMany())).map((r) => r.id).join()
  check('child table queried DIRECTLY is confined to the company\'s parents', kidsA === 'tx_a' && kidsB === 'tx_b', `${kidsA} / ${kidsB}`)
  check('child: cross-company findUnique -> null', (await as(B, () => prisma.pettyFundTxn.findUnique({ where: { id: 'tx_a' } }))) === null)
  check('child: cross-company count/aggregate confined', (await as(B, () => prisma.pettyFundTxn.count())) === 1 && (await as(B, () => prisma.pettyFundTxn.aggregate({ _sum: { amount: true } })))._sum.amount === 20)
  check('child: cross-company update/delete rejected or touch nothing', await rejects(() => as(B, () => prisma.pettyFundTxn.update({ where: { id: 'tx_a' }, data: { amount: 1 } }))) && (await as(B, () => prisma.pettyFundTxn.deleteMany({ where: { id: 'tx_a' } }))).count === 0)
  check('child: creating under another company\'s parent rejected', await rejectsTenant(() => as(B, () => prisma.pettyFundTxn.create({ data: { fundId: 'pf_a', type: 'IN', amount: 5 } }))))
  check('child: creating under its OWN parent works', !(await rejects(() => as(B, () => prisma.pettyFundTxn.create({ data: { fundId: 'pf_b', type: 'IN', amount: 5 } })))))

  // ---------------------------------------------------------------- audit trails: GLOBAL rows are the original company's history
  const audA = (await as(A, () => prisma.businessCalendarAuditLog.findMany())).map((r) => r.id).sort().join()
  const audB = (await as(B, () => prisma.businessCalendarAuditLog.findMany())).map((r) => r.id).sort().join()
  check('audit trail: original company sees GLOBAL history + its own', audA === [auGlobal.id, auA.id].sort().join(), audA)
  check('audit trail: another company sees ONLY its own entries (not the original\'s GLOBAL history)', audB === auB.id, audB)

  // ---------------------------------------------------------------- legacy authority + owner + pre-login resolution
  check('legacy authorities apply in the ORIGINAL company', await as(A, () => legacyAuthorityApplies()))
  check('...NOT in another company', !(await as(B, () => legacyAuthorityApplies())))
  check('...and in system contexts (scripts, cron)', await legacyAuthorityApplies())
  check('another company\'s owner email is ITS owner, not the global one', (await as(B, () => sessionOwnerEmail())) === 'b@beta.test')
  const pr = await resolvePickerCompany(null)
  check('pre-login with several active companies and no code -> code required', pr.mode === 'required', JSON.stringify(pr))
  const pa = await resolvePickerCompany('Alpha'), pz = await resolvePickerCompany('nope')
  check('pre-login code resolves (case-insensitive) and flags the original company', pa.mode === 'company' && pa.isOriginal && (await resolvePickerCompany('beta')).mode === 'company')
  check('pre-login unknown code reveals nothing', pz.mode === 'none')
  await prismaSystem.company.update({ where: { id: B }, data: { status: 'SUSPENDED' } })
  check('with ONE active company the pickers behave exactly as before (legacy)', (await resolvePickerCompany(null)).mode === 'legacy')
  check('a suspended company\'s code no longer resolves', (await resolvePickerCompany('beta')).mode === 'none')
  await prismaSystem.company.update({ where: { id: B }, data: { status: 'ACTIVE' } })

  // ---------------------------------------------------------------- per-company jobs + alias keys
  const seen = await forEachCompany(async (c) => ({ outlets: (await prisma.outlet.findMany()).map((o) => o.id).sort().join(), recipients: (await prisma.user.findMany({ where: { role: 'CASHIER' }, select: { id: true } })).map((u) => u.id).join() }))
  check('forEachCompany runs once per active company, each confined to that company', seen.length === 2 && seen[0].value?.outlets === 'out_a,out_legacy' && seen[1].value?.outlets === 'out_b', JSON.stringify(seen))
  check('...a job\'s user lookup only reaches that company (a shared CASHIER only in Beta)', seen[0].value?.recipients === '' && seen[1].value?.recipients === 'u_shared', JSON.stringify(seen.map((s) => s.value?.recipients)))
  check('forEachCompany: one failing company does not stop the others', (await forEachCompany(async (c) => { if (c.id === A) throw new Error('boom'); return 1 })).map((r) => r.ok).join() === 'false,true')
  check("alias key: '' for the original company and system contexts, the id for others", (await as(A, () => aliasCompanyKey())) === '' && (await aliasCompanyKey()) === '' && (await as(B, () => aliasCompanyKey())) === B)

  // ---------------------------------------------------------------- per-company unique keys (step 3e)
  const schemaText = readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
  const modelBlock = (m: string) => new RegExp(`^model ${m} \\{[\\s\\S]*?^\\}`, 'm').exec(schemaText)?.[0] ?? ''
  const globalKeysDropped = !/^\s+code\s+String\s+@unique/m.test(modelBlock('PaymentChannel')) // contract state
  // within ONE company a key is still unique, and the composite key is the lookup
  await prismaSystem.department.create({ data: { name: 'Bar', companyId: A } })
  check('same company: a duplicate name is still rejected', await rejects(() => prismaSystem.department.create({ data: { name: 'Bar', companyId: A } })))
  await as(A, () => prisma.department.upsert({ where: { companyId_name: { companyId: A, name: 'Bar' } }, update: {}, create: { name: 'Bar', companyId: A } }))
  check('composite-key upsert is idempotent within a company', (await prismaSystem.department.count({ where: { name: 'Bar', companyId: A } })) === 1)
  check('composite-key lookup finds the row', !!(await prismaSystem.department.findUnique({ where: { companyId_name: { companyId: A, name: 'Bar' } } })))
  if (globalKeysDropped) {
    // contract state: the OLD global keys are gone, so a second company can use the same codes/names
    await prismaSystem.department.create({ data: { name: 'Bar', companyId: B } })
    await prismaSystem.paymentChannel.create({ data: { code: 'CASH', label: 'Cash', companyId: A } as never })
    await prismaSystem.paymentChannel.create({ data: { code: 'CASH', label: 'Cash', companyId: B } as never })
    await prismaSystem.outlet.create({ data: { name: 'Main', companyId: A } })
    await prismaSystem.outlet.create({ data: { name: 'Main', companyId: B } })
    await product('p_b_pa', 'PA', B)
    await prismaSystem.person.create({ data: { name: 'Ann', type: 'CUSTOMER', code: 'C001', companyId: A } as never })
    await prismaSystem.person.create({ data: { name: 'Bob', type: 'CUSTOMER', code: 'C001', companyId: B } as never })
    await prismaSystem.rolePermission.create({ data: { role: 'CASHIER', resource: 'X', allowed: true, companyId: A } as never })
    await prismaSystem.rolePermission.create({ data: { role: 'CASHIER', resource: 'X', allowed: false, companyId: B } as never })
    check('CONTRACT: two companies can both have a department / payment channel / outlet / product / person code', true)
    check('...each company still sees only its own copy', (await as(B, () => prisma.paymentChannel.findMany())).length === 1 && (await as(A, () => prisma.paymentChannel.findMany())).length === 1)
    check('...role permissions are independent per company', (await as(A, () => prisma.rolePermission.findFirst({ where: { role: 'CASHIER', resource: 'X' } })))?.allowed === true && (await as(B, () => prisma.rolePermission.findFirst({ where: { role: 'CASHIER', resource: 'X' } })))?.allowed === false)
    // the screens that "seed defaults when the table is empty" (the crawler's HTTP 500s) now work for a NEW company
    const C = 'co_gamma'
    await prismaSystem.company.create({ data: { id: C, name: 'Gamma', slug: 'gamma', createdAt: new Date('2022-01-01') } })
    const seedDefaults = async () => as(C, async () => {
      const companyId = await companyKey()
      if ((await prisma.paymentChannel.count()) === 0) {
        for (const d of [{ code: 'CASH', label: 'Cash' }, { code: 'CRDB', label: 'CRDB' }]) {
          await prisma.paymentChannel.upsert({ where: { companyId_code: { companyId, code: d.code } }, update: {}, create: { ...d, companyId } as never })
        }
      }
      return (await prisma.paymentChannel.findMany()).map((r) => r.code).sort().join()
    })
    check('a NEW company can seed its own default channels on first use (was HTTP 500)', (await seedDefaults()) === 'CASH,CRDB')
    check('...and that seeding is idempotent and leaves the others untouched', (await seedDefaults()) === 'CASH,CRDB' && (await prismaSystem.paymentChannel.count({ where: { code: 'CASH' } })) === 3)
  } else {
    check('EXPAND state: old global keys still in force (cross-company duplicates intentionally still rejected until the contract migration)', await rejects(() => prismaSystem.paymentChannel.create({ data: { code: 'CASH', label: 'Cash', companyId: A } as never }).then(() => prismaSystem.paymentChannel.create({ data: { code: 'CASH', label: 'Cash', companyId: B } as never }))))
  }

  // ---------------------------------------------------------------- per-company document numbering (step 3f)
  // A = the ORIGINAL company (stands in for TIPS, with history); B = a second company. Real generators where practical.
  const numberingContract = !/^\s+scopeKey\s+String\s+@unique/m.test(modelBlock('BillSequenceCounter'))
  const pad6 = (n: number) => String(n).padStart(6, '0')
  // A's history from before 3f: a counter row written before rows had a company, and documents numbered by count()+1
  await prismaSystem.billSequenceCounter.create({ data: { scopeKey: 'JOURNAL_ENTRY', lastValue: 41, companyId: null } })
  await prismaSystem.supplier.create({ data: { id: 'sup_a', name: 'A Supplier', companyId: A } })
  await prismaSystem.supplier.create({ data: { id: 'sup_b', name: 'B Supplier', companyId: B } })
  await prismaSystem.warehouse.create({ data: { id: 'wh_a', name: 'A Store', companyId: A } })
  await prismaSystem.warehouse.create({ data: { id: 'wh_b', name: 'B Store', companyId: B } })
  // PO-000003 has no company yet (not backfilled): it still counts as the original company's
  for (const n of [1, 2, 3]) await prismaSystem.purchaseOrder.create({ data: { poNumber: `PO-${pad6(n)}`, supplierId: 'sup_a', outletIds: '["out_a"]', createdById: 'u_a', companyId: n === 3 ? null : A } as never })
  // GRN history with a hole (GRN-000002 deleted): count()+1 would re-issue GRN-000003, the seed must not
  for (const n of [1, 3]) await prismaSystem.grn.create({ data: { grnNumber: `GRN-${pad6(n)}`, warehouseId: 'wh_a', supplierName: 'x', createdById: 'u_a', companyId: A } as never })
  await prismaSystem.expenseRequestSequence.create({ data: { scopeKey: 'MIK', lastNumber: 7, companyId: A } })

  const je = (c: string, acc: string, user: string) => as(c, () => postJournalEntry(prisma, { companyId: c, entryDate: new Date(), sourceModule: 'MANUAL', createdById: user, lines: [{ accountId: acc, debit: 5 }, { accountId: acc, credit: 5 }] }))
  const po = (c: string, sup: string, outlet: string, user: string, prod: string) => as(c, () => createPurchaseOrder({ supplierId: sup, outletIds: [outlet], items: [{ productId: prod, purchaseUnit: 'PCS', packSize: 1, quantity: 1, unitPrice: 1 }], userId: user }))
  const grn = (c: string, wh: string, user: string, prod: string) => as(c, () => receiveGrn({ warehouseId: wh, supplierName: 'x', items: [{ productId: prod, purchaseUnit: 'PCS', packSize: 1, quantityOrdered: 5 }], userId: user }))
  const trf = (c: string, wh: string, outlet: string, user: string, prod: string) => as(c, () => issueTransfer({ warehouseId: wh, outletId: outlet, counterCode: 'BAR', items: [{ productId: prod, quantity: 1 }], userId: user }))
  const exp = (c: string) => as(c, () => allocateRequestNumber(prisma, c, { branchCode: 'MIK', name: 'Mikocheni' }))
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const counterOf = (c: string, scopeKey: string) => prismaSystem.billSequenceCounter.findFirst({ where: { companyId: c, scopeKey } }).then((r) => r?.lastValue)

  const jeA = await je(A, 'acc_a', 'u_a')
  check('TIPS continuity: journal numbering carries on from the legacy (company-less) counter row', jeA.entryNumber === 'JE-000042', jeA.entryNumber)
  check('...the legacy counter row is adopted by the original company, not duplicated', (await prismaSystem.billSequenceCounter.findMany({ where: { scopeKey: 'JOURNAL_ENTRY' } })).map((r) => `${r.companyId}:${r.lastValue}`).join() === `${A}:42`)
  check('TIPS continuity: the next JE is the next number (no gap)', (await je(A, 'acc_a', 'u_a')).entryNumber === 'JE-000043')
  const poA = await po(A, 'sup_a', 'out_a', 'u_a', 'p_a')
  check('TIPS continuity: PO numbering continues from the existing POs exactly as count()+1 did', poA.poNumber === 'PO-000004', poA.poNumber)
  check("...and the PO belongs to its outlet's company", (await prismaSystem.purchaseOrder.findUnique({ where: { id: poA.purchaseOrderId } }))?.companyId === A)
  const grnA = await grn(A, 'wh_a', 'u_a', 'p_a')
  check('TIPS continuity: GRN numbering never re-issues a number (history GRN-1, GRN-3 -> GRN-000004)', grnA.grnNumber === 'GRN-000004', grnA.grnNumber)
  check('...and the GRN belongs to its company from creation', (await prismaSystem.grn.findUnique({ where: { id: grnA.grnId } }))?.companyId === A)
  const trfA = await trf(A, 'wh_a', 'out_a', 'u_a', 'p_a')
  check('TIPS continuity: transfers start at TRF-000001 (none issued yet)', trfA.transferNumber === 'TRF-000001', trfA.transferNumber)
  const expA = await exp(A)
  check('TIPS continuity: expense numbers continue per branch (MIK 7 -> 0008), same format', expA === `EXP-${today}-MIK-0008`, expA)
  const refA = await as(A, () => prisma.$transaction((tx) => generateBillReference(tx, { recordId: 'rec_a1', sourceModel: 'SignedBill', billTypeCode: 'SBC', outletId: 'out_a', date: new Date('2026-10-16') })))
  check('bill reference: internal id B-YYYYMMDD-NNNNNN starts the day at 1 for the original company', refA.internalBillId === 'B-20261016-000001', refA.internalBillId)
  check('...and its registry row carries the company', (await prismaSystem.billReferenceRegistry.findFirst({ where: { internalBillId: refA.internalBillId } }))?.companyId === A)

  // race-safety: many concurrent first-use draws on one scope -> all distinct and contiguous
  const conc = await Promise.all(Array.from({ length: 25 }, () => as(A, () => nextDocNumber(prisma, { companyId: A, scopeKey: 'TEST:CONCURRENT', seed: async () => 100 }))))
  check('concurrent draws (25 at once, first use) are all distinct and contiguous', [...conc].sort((x, y) => x - y).join() === Array.from({ length: 25 }, (_, i) => 101 + i).join(), conc.join())
  const concPo = await Promise.all(Array.from({ length: 6 }, () => po(A, 'sup_a', 'out_a', 'u_a', 'p_a')))
  check('concurrent PO creation yields 6 distinct consecutive numbers', concPo.map((r) => r.poNumber).sort().join() === [5, 6, 7, 8, 9, 10].map((n) => `PO-${pad6(n)}`).join(), concPo.map((r) => r.poNumber).join())
  const before = await counterOf(A, 'SEQ:PO')
  await as(A, () => prisma.$transaction(async (tx) => { await nextDocNumber(tx, { companyId: A, scopeKey: 'SEQ:PO' }); throw new Error('rollback') })).catch(() => null)
  check('a rolled-back document gives its number back (no gap)', (await counterOf(A, 'SEQ:PO')) === before, `${before}`)
  await raiseDocCounter(prisma, { companyId: A, scopeKey: 'SEQ:PO' }, 3)
  check('resync never lowers a counter', (await counterOf(A, 'SEQ:PO')) === before)
  await raiseDocCounter(prisma, { companyId: A, scopeKey: 'SEQ:PO' }, 20)
  check('resync raises a counter that is behind', (await counterOf(A, 'SEQ:PO')) === 20)
  check('seedFromIssued takes the larger of count and highest number', seedFromIssued(2, 'GRN-000003', 'GRN-') === 3 && seedFromIssued(4, 'ORD-20261016-003', 'ORD-20261016-') === 4 && seedFromIssued(0, null, 'PO-') === 0)
  check("documentCompanyId: explicit > outlet's company > current company", (await documentCompanyId(prisma, { companyId: B, outletId: 'out_a' })) === B && (await documentCompanyId(prisma, { outletId: 'out_b' })) === B && (await as(B, () => documentCompanyId(prisma, {}))) === B && (await documentCompanyId(prisma, {})) === A)

  // a counter that fell behind numbers issued some other way (an older app version mid-deploy) heals itself
  await prismaSystem.purchaseOrder.create({ data: { poNumber: 'PO-000021', supplierId: 'sup_a', outletIds: '["out_a"]', createdById: 'u_a', companyId: A } as never })
  const healed = await po(A, 'sup_a', 'out_a', 'u_a', 'p_a')
  check('a number already issued elsewhere is skipped, never duplicated (PO-000021 taken -> PO-000022)', healed.poNumber === 'PO-000022', healed.poNumber)

  // POS orders through the real route handler (ORD-YYYYMMDD-NNN, one sequence per company per day)
  const ordersRoute = await import('../app/api/pos/orders/route')
  const ord = (c: string, user: string, outlet: string, shift: string) => as(c, async () => {
    const token = signToken({ userId: user, email: `${user}@x.test`, role: 'ADMIN', name: user, outletId: outlet, companyId: c })
    const res = await ordersRoute.POST(new NextRequest('http://localhost/api/pos/orders', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ shiftId: shift }) }))
    return { status: res.status, orderNo: (await res.json()).orderNo as string | undefined }
  })
  await prismaSystem.posShift.create({ data: { id: 'sh_a', outletId: 'out_a', name: 'KWANZA', date: new Date(), openedBy: 'u_a', companyId: A } })
  await prismaSystem.posShift.create({ data: { id: 'sh_b', outletId: 'out_b', name: 'KWANZA', date: new Date(), openedBy: 'u_b', companyId: B } })
  const ordPrefix = `ORD-${today}-`
  // two orders already taken today by the old count()+1 numbering
  for (const n of ['001', '002']) await prismaSystem.posOrder.create({ data: { orderNo: ordPrefix + n, outletId: 'out_a', shiftId: 'sh_a', waiterId: 'u_a', companyId: A } })
  const o1 = await ord(A, 'u_a', 'out_a', 'sh_a')
  check('TIPS continuity: POS order numbering continues today\'s sequence (001, 002 -> 003), same format', o1.status === 201 && o1.orderNo === `${ordPrefix}003`, JSON.stringify(o1))
  const oc = await Promise.all(Array.from({ length: 5 }, () => ord(A, 'u_a', 'out_a', 'sh_a')))
  check('concurrent POS orders get distinct consecutive numbers', oc.map((o) => o.orderNo).sort().join() === ['004', '005', '006', '007', '008'].map((n) => ordPrefix + n).join(), JSON.stringify(oc))
  await prismaSystem.posOrder.create({ data: { orderNo: `${ordPrefix}009`, outletId: 'out_a', shiftId: 'sh_a', waiterId: 'u_a', companyId: A } })
  check('POS: a number taken by an older app version is skipped (009 taken -> 010)', (await ord(A, 'u_a', 'out_a', 'sh_a')).orderNo === `${ordPrefix}010`)
  check('POS: the order is stamped with its company', (await prismaSystem.posOrder.findFirst({ where: { orderNo: `${ordPrefix}010` } }))?.companyId === A)

  if (numberingContract) {
    // contract state: B has its own, independent sequences - the same numbers A uses
    const jeB = await je(B, 'acc_b', 'u_b')
    check('CONTRACT: a second company starts its own journal sequence at JE-000001', jeB.entryNumber === 'JE-000001', jeB.entryNumber)
    check('...while the original company carries on unaffected', (await je(A, 'acc_a', 'u_a')).entryNumber === 'JE-000044')
    const poB = await po(B, 'sup_b', 'out_b', 'u_b', 'p_b')
    const grnB = await grn(B, 'wh_b', 'u_b', 'p_b')
    const trfB = await trf(B, 'wh_b', 'out_b', 'u_b', 'p_b')
    check("CONTRACT: second company's PO / GRN / TRF sequences start at 1", poB.poNumber === 'PO-000001' && grnB.grnNumber === 'GRN-000001' && trfB.transferNumber === 'TRF-000001', `${poB.poNumber} ${grnB.grnNumber} ${trfB.transferNumber}`)
    check('...and the same number now exists once per company', (await prismaSystem.stockTransfer.count({ where: { transferNumber: 'TRF-000001' } })) === 2)
    const expB = await exp(B)
    check('CONTRACT: expense numbers are per company even for the same branch code', expB === `EXP-${today}-MIK-0001` && (await exp(A)) === `EXP-${today}-MIK-0009`, expB)
    const refB = await as(B, () => prisma.$transaction((tx) => generateBillReference(tx, { recordId: 'rec_b1', sourceModel: 'SignedBill', billTypeCode: 'SBC', outletId: 'out_b', date: new Date('2026-10-16') })))
    check('CONTRACT: bill references are per company (same internal id, own registry row)', refB.internalBillId === 'B-20261016-000001' && (await prismaSystem.billReferenceRegistry.count({ where: { internalBillId: 'B-20261016-000001' } })) === 2, refB.internalBillId)
    check('...each company sees only its own document with that number', (await as(B, () => prisma.stockTransfer.findMany({ where: { transferNumber: 'TRF-000001' } }))).length === 1)
    check('CONTRACT: within ONE company a number is still unique', await rejects(() => prismaSystem.purchaseOrder.create({ data: { poNumber: 'PO-000001', supplierId: 'sup_b', outletIds: '[]', createdById: 'u_b', companyId: B } as never })))
    const ob = await ord(B, 'u_b', 'out_b', 'sh_b')
    check("CONTRACT: a second company's POS orders start their own daily sequence at 001", ob.status === 201 && ob.orderNo === `${ordPrefix}001`, JSON.stringify(ob))
    check('...while the original company carries on (011)', (await ord(A, 'u_a', 'out_a', 'sh_a')).orderNo === `${ordPrefix}011`)
    const two = await Promise.all(Array.from({ length: 10 }, (_, i) => as(i % 2 ? A : B, () => nextDocNumber(prisma, { companyId: i % 2 ? A : B, scopeKey: 'TEST:TWO' }))))
    check('CONTRACT: concurrent draws in two companies on the same scope are independent sequences', two.filter((_, i) => i % 2).sort().join() === '1,2,3,4,5' && two.filter((_, i) => !(i % 2)).sort().join() === '1,2,3,4,5', two.join())
  } else {
    check('EXPAND state: a second company cannot yet draw from a scope the original company uses (clear error, no duplicate)', await rejects(() => je(B, 'acc_b', 'u_b')))
    check('...and no stray counter row or number was created for it', (await prismaSystem.billSequenceCounter.count({ where: { companyId: B } })) === 0 && (await prismaSystem.journalEntry.count({ where: { companyId: B } })) === 0)
    check("EXPAND state: a second company's POS order is refused the same way (no duplicate number)", await rejects(() => ord(B, 'u_b', 'out_b', 'sh_b')))
    check('EXPAND state: scopes no other company uses already work per company', (await as(B, () => nextDocNumber(prisma, { companyId: B, scopeKey: 'TEST:B-ONLY' }))) === 1)
  }

  // ---------------------------------------------------------------- unscoped paths
  check('prismaSystem is NOT scoped even inside a company context', (await as(B, () => prismaSystem.posTable.count())) === 3)
  check('no company context (script / cron) = not scoped', (await prisma.posTable.count()) === 3)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => {
  await prismaSystem.$disconnect()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})
