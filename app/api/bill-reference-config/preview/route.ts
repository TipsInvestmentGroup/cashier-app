import { NextRequest, NextResponse } from 'next/server'
import { format } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { seedBillTypesIfEmpty } from '@/lib/bill-reference'

// Mirrors DATE_FORMAT_TOKENS / formatConfiguredDate / renderDisplayReference in
// lib/bill-reference.ts (kept private there — see file header). Duplicated
// (~15 lines) rather than exporting those internals, since this route renders
// against the client's UNSAVED in-memory settings, not the persisted config
// that previewDisplayReference(tx, sample) always reads. Do not change
// lib/bill-reference.ts's public API to avoid this duplication.
const DATE_FORMAT_TOKENS: Record<string, string> = {
  YYMMDD: 'yyMMdd',
  DDMMYY: 'ddMMyy',
  YYYYMMDD: 'yyyyMMdd',
  'DD-MM-YYYY': 'dd-MM-yyyy',
  'MM-YYYY': 'MM-yyyy',
}

function formatConfiguredDatePreview(dateFormat: string, customDateFormat: string | null | undefined, date: Date): string {
  if (dateFormat === 'CUSTOM' && customDateFormat) return format(date, customDateFormat)
  return format(date, DATE_FORMAT_TOKENS[dateFormat] || DATE_FORMAT_TOKENS.YYMMDD)
}

interface PreviewComponent {
  type: string
  staticValue?: string | null
  isEnabled?: boolean
  order?: number
}

function renderPreview(opts: {
  dateFormat: string
  customDateFormat: string | null | undefined
  separator: string
  numberPadding: number
  components: PreviewComponent[]
  billTypePrefix: string
  personCode: string
  outletCode: string
  sequenceValue: number
  date: Date
}): string {
  const parts = opts.components.map((c) => {
    switch (c.type) {
      case 'DATE': return formatConfiguredDatePreview(opts.dateFormat, opts.customDateFormat, opts.date)
      case 'BILL_TYPE_CODE': return opts.billTypePrefix
      case 'PERSON_CODE': return opts.personCode
      case 'SEQUENCE': return String(opts.sequenceValue).padStart(opts.numberPadding, '0')
      case 'COMPANY_CODE':
      case 'BRANCH_CODE':
      case 'OUTLET_CODE': return opts.outletCode
      case 'DEPARTMENT_CODE': return ''
      case 'COUNTER_CODE': return ''
      case 'STATIC_TEXT': return c.staticValue || ''
      default: return ''
    }
  })
  const sep = opts.separator === 'NONE' ? '' : opts.separator
  return parts.filter((p) => p !== '').join(sep)
}

/** Side-effect-free preview render — any authed user. Renders against the
 *  client's current (possibly-unsaved) form state rather than the persisted
 *  BillReferenceConfig, and never touches BillSequenceCounter /
 *  BillReferenceRegistry. Sample values: personCode '14', sequenceValue 3,
 *  outletCode 'DSM'. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Lazy-seed the 15 default bill types (idempotent upsert, same as every
  // other entry point into the Bill Reference System) so a fresh install can
  // still preview before ever touching Bill Types settings.
  await seedBillTypesIfEmpty(prisma)

  const persisted = await prisma.billReferenceConfig.findUnique({
    where: { id: 'default' },
    include: { components: { where: { isEnabled: true }, orderBy: { order: 'asc' } } },
  })

  const dateFormat: string = body.dateFormat ?? persisted?.dateFormat ?? 'YYMMDD'
  const customDateFormat: string | null = body.customDateFormat ?? persisted?.customDateFormat ?? null
  const separator: string = body.separator ?? persisted?.separator ?? '-'
  const numberPadding: number = Number(body.numberPadding ?? persisted?.numberPadding ?? 3)

  const componentsInput: PreviewComponent[] = Array.isArray(body.components) ? body.components : (persisted?.components ?? [])
  const components = componentsInput
    .filter((c) => c.isEnabled !== false)
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))

  let billTypePrefix = ''
  if (body.billTypeCode) {
    const bt = await prisma.billTypeConfig.findUnique({ where: { code: body.billTypeCode } })
    if (!bt) return NextResponse.json({ error: `Unknown bill type "${body.billTypeCode}"` }, { status: 400 })
    billTypePrefix = bt.prefix
  } else {
    const bt = await prisma.billTypeConfig.findFirst({ where: { category: 'SIGNED_BILL', isActive: true }, orderBy: { sortOrder: 'asc' } })
    billTypePrefix = bt?.prefix ?? ''
  }

  const preview = renderPreview({
    dateFormat, customDateFormat, separator, numberPadding, components,
    billTypePrefix, personCode: '14', outletCode: 'DSM', sequenceValue: 3, date: new Date(),
  })

  return NextResponse.json({ preview })
}
