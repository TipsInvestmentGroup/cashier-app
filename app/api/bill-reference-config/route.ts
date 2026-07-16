import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { DEFAULT_REFERENCE_COMPONENTS, DATE_FORMAT_OPTIONS, SEPARATOR_OPTIONS, PERSON_NUMBERING_MODES, SEQUENCE_RESET_RULES } from '@/lib/bill-reference-defaults'

const CAN_MANAGE = ['ADMIN', 'DIRECTOR']

/** Loads (or lazily creates) the singleton config row + ALL of its components
 *  (enabled and disabled), same lazy-create-on-first-use convention as
 *  lib/bill-reference.ts's internal loadReferenceConfig — except this one
 *  doesn't filter to isEnabled, since the settings UI needs to show disabled
 *  components too so they can be re-enabled. */
async function loadFullConfig() {
  const existing = await prisma.billReferenceConfig.findUnique({
    where: { id: 'default' },
    include: { components: { orderBy: { order: 'asc' } } },
  })
  if (existing) return existing
  try {
    return await prisma.billReferenceConfig.create({
      data: { id: 'default', components: { create: DEFAULT_REFERENCE_COMPONENTS } },
      include: { components: { orderBy: { order: 'asc' } } },
    })
  } catch (err) {
    // Concurrent first-ever-use race — recover by re-reading rather than failing.
    if (err instanceof Error && err.message.includes('Unique')) {
      const created = await prisma.billReferenceConfig.findUnique({
        where: { id: 'default' },
        include: { components: { orderBy: { order: 'asc' } } },
      })
      if (created) return created
    }
    throw err
  }
}

/** Any authed user can view the current Bill Reference format settings. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await loadFullConfig()
  return NextResponse.json(config)
}

/** Update the format settings on the singleton row — ADMIN/DIRECTOR only,
 *  same gating as outlets/payment-channels. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MANAGE)) return NextResponse.json({ error: 'You are not authorized to change Bill Reference Settings' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { dateFormat, customDateFormat, separator, numberPadding, personNumberingMode, sequenceResetRule } = body

  if (dateFormat !== undefined && !DATE_FORMAT_OPTIONS.includes(dateFormat)) {
    return NextResponse.json({ error: `Invalid dateFormat "${dateFormat}"` }, { status: 400 })
  }
  if (separator !== undefined && !SEPARATOR_OPTIONS.includes(separator)) {
    return NextResponse.json({ error: `Invalid separator "${separator}"` }, { status: 400 })
  }
  if (personNumberingMode !== undefined && !PERSON_NUMBERING_MODES.includes(personNumberingMode)) {
    return NextResponse.json({ error: `Invalid personNumberingMode "${personNumberingMode}"` }, { status: 400 })
  }
  if (sequenceResetRule !== undefined && !SEQUENCE_RESET_RULES.includes(sequenceResetRule)) {
    return NextResponse.json({ error: `Invalid sequenceResetRule "${sequenceResetRule}"` }, { status: 400 })
  }
  if (numberPadding !== undefined && (!Number.isInteger(Number(numberPadding)) || Number(numberPadding) < 1 || Number(numberPadding) > 8)) {
    return NextResponse.json({ error: 'numberPadding must be an integer between 1 and 8' }, { status: 400 })
  }
  if (dateFormat === 'CUSTOM' && customDateFormat !== undefined && !String(customDateFormat).trim()) {
    return NextResponse.json({ error: 'customDateFormat is required when dateFormat is CUSTOM' }, { status: 400 })
  }

  // Ensure the singleton (+ default components) exists before updating it —
  // the settings page may PUT format settings before ever GET-ing the config.
  await loadFullConfig()

  const updated = await prisma.billReferenceConfig.update({
    where: { id: 'default' },
    data: {
      ...(dateFormat !== undefined && { dateFormat }),
      ...(customDateFormat !== undefined && { customDateFormat: customDateFormat || null }),
      ...(separator !== undefined && { separator }),
      ...(numberPadding !== undefined && { numberPadding: Number(numberPadding) }),
      ...(personNumberingMode !== undefined && { personNumberingMode }),
      ...(sequenceResetRule !== undefined && { sequenceResetRule }),
      updatedById: user.userId,
    },
    include: { components: { orderBy: { order: 'asc' } } },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'UPDATE',
      entity: 'BillReferenceConfig',
      entityId: 'default',
      details: `Updated Bill Reference format settings (dateFormat=${updated.dateFormat}, separator=${updated.separator}, numberPadding=${updated.numberPadding}, personNumberingMode=${updated.personNumberingMode}, sequenceResetRule=${updated.sequenceResetRule})`,
    },
  })

  return NextResponse.json(updated)
}
