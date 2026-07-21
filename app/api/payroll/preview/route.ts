import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { previewPayslip } from '@/lib/payroll-calc'

// Read-only payslip preview (Phase 2). Computes a DRAFT payslip for one employee
// without persisting anything or posting to the GL. Restricted to payroll
// supervisors; works whether or not the module is enabled (the preview reports
// `moduleEnabled`) so an admin can dry-run configuration before turning it on.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })

  const dateParam = searchParams.get('date')
  const date = dateParam ? new Date(dateParam) : undefined
  if (date && isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  const overtimeParam = searchParams.get('overtimeHours')
  const overtimeHours = overtimeParam != null ? Number(overtimeParam) : undefined
  if (overtimeHours != null && !Number.isFinite(overtimeHours)) return NextResponse.json({ error: 'Invalid overtimeHours' }, { status: 400 })

  try {
    const preview = await previewPayslip(prisma, employeeId, { date, overtimeHours })
    return NextResponse.json(preview)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Preview failed'
    const status = msg === 'Employee not found' ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
