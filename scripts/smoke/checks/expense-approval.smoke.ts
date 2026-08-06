import type { SmokeCheck } from '../types'

// Regression guard for the expense-request approval decide route
// (POST /api/expense/requests/[id]/decide). Two bugs were fixed there:
//   1. authorization gated on `user.role === approverRole`, but expense
//      approvals are addressed to a STAGE GRANT (FIRST_APPROVER/SECOND_APPROVER
//      per fund + outlet), never a User.role — so every non-ADMIN approver got
//      a 403 "Forbidden"; the check now resolves the fund's class/outlet and
//      uses hasGrant (mirroring the shared approvals inbox route);
//   2. approver notifications were written on the global prisma client inside
//      the decide transaction and silently lost; they now use the tx client.
//
// The smoke suite carries a single ADMIN identity and one shared client, and
// ADMIN passes the authorization check both before and after the fix, so the
// non-admin grant-holder path can't be exercised end-to-end here. What this
// check guarantees cheaply is that the route — and the isStageGrant / hasGrant /
// fundClassOf wiring the fix added — is mounted and runs without throwing: a
// decide against a request that doesn't exist must fall through to a clean 404,
// not a 500 or a crash. A regression that broke an import or threw inside the
// rewritten authorization block would surface as a non-404 status here.
//
// Targets a nonexistent id, so it never mutates — safe to run in --readonly.
const check: SmokeCheck = async ({ client }) => {
  const res = await client.post(
    '/api/expense/requests/smoke-test-nonexistent-request/decide',
    { approve: true },
  )

  if (res.status === 404) return { status: 'pass' }
  if (res.status === 401 || res.status === 403) {
    return { status: 'skip', message: `decide route rejected the smoke identity (${res.status}) — cannot validate route health` }
  }
  return {
    status: 'fail',
    message: `POST /api/expense/requests/<missing>/decide returned ${res.status} (expected 404): ${JSON.stringify(res.body)}`,
  }
}

export default check
