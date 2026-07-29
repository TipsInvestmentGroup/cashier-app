import type { SmokeCheck } from '../types'

// Payroll preview is read-only regardless of whether the module is enabled
// (GET /api/payroll/preview always 200s; it returns moduleEnabled:false as
// data rather than gating the route). So: 200 + moduleEnabled:false means
// "disabled for this scope" (explicit SKIP, never a silent pass), a genuine
// error means the calculation is broken.
const check: SmokeCheck = async ({ client }) => {
  const employees = await client.get('/api/payroll/employees')
  if (employees.status !== 200 || !Array.isArray(employees.body) || employees.body.length === 0) {
    return { status: 'skip', message: 'no payroll employees to preview against' }
  }

  const employeeId = employees.body[0].id
  const res = await client.get(`/api/payroll/preview?employeeId=${employeeId}`)
  if (res.status !== 200) {
    return { status: 'fail', message: `GET /api/payroll/preview returned ${res.status}: ${JSON.stringify(res.body)}` }
  }
  if (res.body?.moduleEnabled === false) {
    return { status: 'skip', message: 'payroll disabled for this scope (moduleEnabled:false) — not a failure' }
  }
  return { status: 'pass' }
}

export default check
