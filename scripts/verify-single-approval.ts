// End-to-end verification of the Single Approval flow (create → submit →
// decide), plus the two invariants the feature turns on:
//   • a configured SINGLE_APPROVER takes precedence over First/Second, and
//   • removing it falls back to the two-stage chain.
// Drives the REAL lib functions (the same code the API routes call) against the
// dev DB, then deletes everything it created. Read-through, not mocked.
//
//   npx tsx scripts/verify-single-approval.ts
import { prisma } from '@/lib/prisma'
import { createExpenseRequest, submitExpenseRequest } from '@/lib/expense-requests'
import { resolveApprovalPlan, decideExpenseRequestViaWorkflow, isStageGrant } from '@/lib/expense-workflow'
import { grantAccess, revokeGrant, hasGrant } from '@/lib/expense-grants'

let ok = true
function check(cond: boolean, msg: string) {
  console.log(`  ${cond ? '✓' : '✗ FAIL:'} ${msg}`)
  if (!cond) ok = false
}

const created = { grantIds: [] as string[], requestIds: [] as string[], requestTypeId: '', categoryId: '', fundingSourceId: '' }

async function main() {
  const company = await prisma.company.findFirst()
  if (!company) throw new Error('No company in the dev DB — seed it first')
  const outlet = await prisma.outlet.findFirst({ where: { companyId: company.id } }) ?? await prisma.outlet.findFirst()
  if (!outlet) throw new Error('No outlet in the dev DB')
  const users = await prisma.user.findMany({ where: { isActive: true }, take: 2, orderBy: { createdAt: 'asc' } })
  if (!users.length) throw new Error('No active users in the dev DB')
  const requester = users[0]
  const approver = users[1] ?? users[0]

  const stamp = Date.now()
  const fundClass = 'PETTY_CASH'
  const outletId = outlet.id

  const fund = await prisma.fundingSource.create({
    data: { companyId: company.id, code: `SA_FUND_${stamp}`, name: 'SingleApproval Test Fund', sourceType: 'CASH', outletId, openingBalance: 1_000_000, currentBalance: 1_000_000, approvalThreshold: 0 },
  })
  created.fundingSourceId = fund.id
  const category = await prisma.expenseCategory.create({ data: { companyId: company.id, code: `SA_CAT_${stamp}`, name: 'SingleApproval Test Category' } })
  created.categoryId = category.id
  // approverRoles non-empty ⇒ approval IS required (the expense chain reads
  // grants, not these role strings, but a non-empty list is the "needs approval"
  // switch resolveApprovalPlan keys off).
  const requestType = await prisma.requestType.create({ data: { companyId: company.id, code: `SA_RT_${stamp}`, name: 'SingleApproval Test Type', approverRoles: JSON.stringify(['MANAGER']) } })
  created.requestTypeId = requestType.id

  const planInput = (fundingSourceId: string) => ({ amount: 5000, outletId, requestType: { approverRoles: requestType.approverRoles }, fundingSourceId })

  console.log(`\nCompany "${company.name}" · outlet "${outlet.name}" · requester ${requester.name} · approver ${approver.name}`)

  // ── Scenario A: a Single Approver is granted ───────────────────────────────
  console.log('\n[A] Single Approver granted for the fund')
  const single = await grantAccess({ companyId: company.id, userId: approver.id, grantType: 'SINGLE_APPROVER', fundClass, outletId, grantedById: requester.id, grantedByName: 'verify-single-approval' })
  created.grantIds.push(single.id)

  check(isStageGrant('SINGLE_APPROVER'), 'isStageGrant() recognizes SINGLE_APPROVER (routes use hasGrant, not role equality)')
  check(await hasGrant(approver.id, 'SINGLE_APPROVER', { fundClass, outletId }), 'approver holds SINGLE_APPROVER for this fund + outlet (decide-route authorization)')

  const reqA = await createExpenseRequest(prisma, { companyId: company.id, requestTypeId: requestType.id, categoryId: category.id, requestedById: requester.id, amount: 5000, purpose: 'Single-approval E2E test', outletId, fundingSourceId: fund.id })
  created.requestIds.push(reqA.id)

  const planA = await resolveApprovalPlan(prisma, planInput(fund.id))
  check(!planA.skip && planA.stages.length === 1 && planA.stages[0] === 'SINGLE_APPROVER', `plan is a single stage: [${planA.stages.join(', ')}]`)

  const sub = await submitExpenseRequest(prisma, reqA.id)
  check(sub.status === 'PENDING_APPROVAL', `submit → ${sub.status} (expected PENDING_APPROVAL)`)
  const openRows = await prisma.workflowApproval.findMany({ where: { expenseRequestId: reqA.id } })
  check(openRows.length === 1 && openRows[0].status === 'PENDING' && openRows[0].approverRole === 'SINGLE_APPROVER', `exactly one PENDING approval addressed to SINGLE_APPROVER (found ${openRows.length})`)

  const decision = await decideExpenseRequestViaWorkflow({ expenseRequestId: reqA.id, approve: true, decidedById: approver.id, decidedByName: approver.name })
  check(decision.status === 'APPROVED', `one approval finalizes the request → ${decision.status} (expected APPROVED)`)
  check(decision.approverRole === 'SINGLE_APPROVER', `decision recorded against ${decision.approverRole}`)

  const afterRows = await prisma.workflowApproval.findMany({ where: { expenseRequestId: reqA.id } })
  check(afterRows.filter((a) => a.status === 'PENDING').length === 0, 'no second stage opened after the single approval')
  check(afterRows.filter((a) => a.status === 'APPROVED').length === 1, `exactly one approval on record — no first/second chain (found ${afterRows.filter((a) => a.status === 'APPROVED').length})`)
  const finalA = await prisma.expenseRequest.findUnique({ where: { id: reqA.id } })
  check(finalA?.status === 'APPROVED', `request final status = ${finalA?.status}`)

  // ── Scenario B: precedence — First+Second also granted, single still wins ──
  console.log('\n[B] First + Second Approver also granted (precedence)')
  const gf = await grantAccess({ companyId: company.id, userId: approver.id, grantType: 'FIRST_APPROVER', fundClass, outletId, grantedById: requester.id, grantedByName: 'verify-single-approval' })
  const gs = await grantAccess({ companyId: company.id, userId: approver.id, grantType: 'SECOND_APPROVER', fundClass, outletId, grantedById: requester.id, grantedByName: 'verify-single-approval' })
  created.grantIds.push(gf.id, gs.id)
  const planB = await resolveApprovalPlan(prisma, planInput(fund.id))
  check(planB.stages.length === 1 && planB.stages[0] === 'SINGLE_APPROVER', `single approver still wins over first/second: [${planB.stages.join(', ')}]`)

  // ── Scenario C: fallback — revoke single, two-stage chain returns ──────────
  console.log('\n[C] Single Approver revoked (fallback to two-stage)')
  await revokeGrant(single.id, requester.id)
  const planC = await resolveApprovalPlan(prisma, planInput(fund.id))
  check(JSON.stringify(planC.stages) === JSON.stringify(['FIRST_APPROVER', 'SECOND_APPROVER']), `chain falls back to first→second: [${planC.stages.join(', ')}]`)
}

async function cleanup() {
  console.log('\nCleaning up test data…')
  if (created.requestIds.length) {
    await prisma.notification.deleteMany({ where: { entityType: 'ExpenseRequest', entityId: { in: created.requestIds } } })
    await prisma.workflowApproval.deleteMany({ where: { expenseRequestId: { in: created.requestIds } } })
    await prisma.expenseRequestFieldValue.deleteMany({ where: { expenseRequestId: { in: created.requestIds } } })
    await prisma.expenseItem.deleteMany({ where: { expenseRequestId: { in: created.requestIds } } })
    await prisma.expenseRequest.deleteMany({ where: { id: { in: created.requestIds } } })
  }
  if (created.grantIds.length) await prisma.expenseAccessGrant.deleteMany({ where: { id: { in: created.grantIds } } })
  if (created.requestTypeId) await prisma.requestType.deleteMany({ where: { id: created.requestTypeId } })
  if (created.categoryId) await prisma.expenseCategory.deleteMany({ where: { id: created.categoryId } })
  if (created.fundingSourceId) await prisma.fundingSource.deleteMany({ where: { id: created.fundingSourceId } })
  console.log('  done')
}

main()
  .catch((e) => { ok = false; console.error('\nError during verification:', e) })
  .finally(async () => {
    await cleanup().catch((e) => console.error('Cleanup error (manual check may be needed):', e))
    console.log(`\n${ok ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`)
    await prisma.$disconnect()
    process.exit(ok ? 0 : 1)
  })
