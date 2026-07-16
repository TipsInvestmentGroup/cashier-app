// Seed data for the Bill Reference System (see lib/bill-reference.ts). These
// are defaults only — every field here is admin-editable afterward via
// /bill-types and /bill-reference-settings; nothing here is hardcoded into
// the generation logic itself.

export const DEFAULT_BILL_TYPES: {
  code: string
  name: string
  prefix: string
  category: string // SIGNED_BILL | PAID_BILL | EXCESS_PAYMENT | EXCESS_REFUND | LOSS_RECORD
  legacyBillTypeCode: string | null // bridges to the OLD SignedBill.billType vocabulary, for backfill
  sortOrder: number
}[] = [
  { code: 'SBA', name: 'Signed Bill - Admin', prefix: 'SBA', category: 'SIGNED_BILL', legacyBillTypeCode: 'ADMIN', sortOrder: 1 },
  { code: 'SBD', name: 'Signed Bill - Director', prefix: 'SBD', category: 'SIGNED_BILL', legacyBillTypeCode: 'DIRECTOR', sortOrder: 2 },
  { code: 'SBS', name: 'Signed Bill - Staff', prefix: 'SBS', category: 'SIGNED_BILL', legacyBillTypeCode: 'STAFF_LOSS', sortOrder: 3 },
  { code: 'SBC', name: 'Signed Bill - Customer', prefix: 'SBC', category: 'SIGNED_BILL', legacyBillTypeCode: 'CUSTOMER', sortOrder: 4 },
  { code: 'SBJ', name: 'Signed Bill - DJ', prefix: 'SBJ', category: 'SIGNED_BILL', legacyBillTypeCode: 'DJ', sortOrder: 5 },
  { code: 'SBT', name: 'Signed Bill - Tips', prefix: 'SBT', category: 'SIGNED_BILL', legacyBillTypeCode: 'TIPS', sortOrder: 6 },
  { code: 'PBA', name: 'Paid Bill - Admin', prefix: 'PBA', category: 'PAID_BILL', legacyBillTypeCode: 'ADMIN', sortOrder: 7 },
  { code: 'PBD', name: 'Paid Bill - Director', prefix: 'PBD', category: 'PAID_BILL', legacyBillTypeCode: 'DIRECTOR', sortOrder: 8 },
  { code: 'PBS', name: 'Paid Bill - Staff', prefix: 'PBS', category: 'PAID_BILL', legacyBillTypeCode: 'STAFF_LOSS', sortOrder: 9 },
  { code: 'PBC', name: 'Paid Bill - Customer', prefix: 'PBC', category: 'PAID_BILL', legacyBillTypeCode: 'CUSTOMER', sortOrder: 10 },
  { code: 'PBJ', name: 'Paid Bill - DJ', prefix: 'PBJ', category: 'PAID_BILL', legacyBillTypeCode: 'DJ', sortOrder: 11 },
  { code: 'PBT', name: 'Paid Bill - Tips', prefix: 'PBT', category: 'PAID_BILL', legacyBillTypeCode: 'TIPS', sortOrder: 12 },
  { code: 'EXS', name: 'Excess Payment', prefix: 'EXS', category: 'EXCESS_PAYMENT', legacyBillTypeCode: null, sortOrder: 13 },
  { code: 'EXR', name: 'Excess Refund', prefix: 'EXR', category: 'EXCESS_REFUND', legacyBillTypeCode: null, sortOrder: 14 },
  { code: 'LOS', name: 'Loss Record', prefix: 'LOS', category: 'LOSS_RECORD', legacyBillTypeCode: null, sortOrder: 15 },
]

export const DEFAULT_REFERENCE_COMPONENTS: {
  type: string
  label: string
  order: number
  isEnabled: boolean
}[] = [
  { type: 'DATE', label: 'Date', order: 0, isEnabled: true },
  { type: 'BILL_TYPE_CODE', label: 'Bill Type Code', order: 1, isEnabled: true },
  { type: 'PERSON_CODE', label: 'Person Code', order: 2, isEnabled: true },
  { type: 'SEQUENCE', label: 'Sequence Number', order: 3, isEnabled: true },
]

// All component types selectable in the Bill Reference Settings "Add
// component" dropdown (DATE/BILL_TYPE_CODE/PERSON_CODE/SEQUENCE are enabled
// by default above; the rest are optional add-ins).
export const REFERENCE_COMPONENT_TYPES = [
  'DATE', 'BILL_TYPE_CODE', 'PERSON_CODE', 'SEQUENCE',
  'COMPANY_CODE', 'BRANCH_CODE', 'DEPARTMENT_CODE', 'COUNTER_CODE', 'OUTLET_CODE', 'STATIC_TEXT',
] as const

export const DATE_FORMAT_OPTIONS = ['YYMMDD', 'DDMMYY', 'YYYYMMDD', 'DD-MM-YYYY', 'MM-YYYY', 'CUSTOM'] as const
export const SEPARATOR_OPTIONS = ['-', '/', '_', '.', 'NONE'] as const
export const PERSON_NUMBERING_MODES = ['AUTO', 'MANUAL', 'EMPLOYEE_NUMBER', 'CUSTOMER_NUMBER', 'MEMBERSHIP_NUMBER', 'SUPPLIER_CODE'] as const
export const SEQUENCE_RESET_RULES = ['NEVER', 'DAILY', 'MONTHLY', 'YEARLY', 'PER_PERSON', 'PER_BILL_TYPE'] as const
export const BILL_TYPE_CATEGORIES = ['SIGNED_BILL', 'PAID_BILL', 'EXCESS_PAYMENT', 'EXCESS_REFUND', 'LOSS_RECORD'] as const
