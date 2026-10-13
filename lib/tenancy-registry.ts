/**
 * Tenancy registry — the single source of truth for how every Prisma model relates to a company.
 *
 * Plain data (no imports) so schema checks, ops scripts and the Prisma write-guard can all use it.
 * `scripts/check-tenancy-registry.ts` (run in CI) fails if a model exists that is not classified here,
 * or if a ROOT model is missing its `companyId` column — so a new table can never silently ship
 * without a tenancy decision. See docs/MULTI-TENANT-PHASE3.md.
 *
 * Kinds
 *  - ROOT      owns a `companyId` column (nullable until the Phase-3 contract step makes it required).
 *              `derive` says how an existing/new row's company is determined:
 *                outlet   from its `outletId` -> Outlet.companyId   (rows with no outlet: the original company)
 *                journal  from its JournalEntry
 *                bill     from its SignedBill's outlet
 *                account  from its CompanyPaymentAccount
 *                user     from its user's primary membership
 *                global   shared master/config/counter data: belongs to the original company today and is
 *                         copied per company at onboarding (decision D6)
 *  - CHILD     no column; always reached through (and removed with) its parent
 *  - SCOPED    scope/scopeId configuration (GLOBAL | COMPANY | OUTLET); the scopeId carries the company
 *  - IDENTITY  identity / platform tables that sit outside any one company
 *  - DEFERRED  needs a key redesign before it can be made per-company (see notes)
 *
 * Models that already carry a `companyId` column in the schema (the finance / payroll / expense / credit /
 * reconciliation families, Outlet, ...) need no entry: they are company-native.
 */

export type RootDerive = 'outlet' | 'journal' | 'bill' | 'account' | 'user' | 'global'

export const TENANT_ROOTS: Record<string, RootDerive> = {
  // ── derived from outletId ──
  BankRecon: 'outlet', BusinessDay: 'outlet', Breakage: 'outlet', Cancellation: 'outlet', CashRecon: 'outlet',
  CollectionSession: 'outlet', DailyCollection: 'outlet', DailyReport: 'outlet', DayClosure: 'outlet', Event: 'outlet',
  ExcessRefund: 'outlet', ExcessSettlement: 'outlet', OutletScheduleConfig: 'outlet', PaidBill: 'outlet',
  PettyCash: 'outlet', PettyFund: 'outlet', PosBlockedItem: 'outlet', PosCounter: 'outlet', PosOrder: 'outlet',
  PosShift: 'outlet', PosStockRequest: 'outlet', PosTable: 'outlet', SalesMetric: 'outlet', SalesMetricLock: 'outlet',
  SalesTarget: 'outlet', ScheduleAssignment: 'outlet', SignedBill: 'outlet', StaffTransaction: 'outlet',
  StockCountSession: 'outlet', StockLedgerEntry: 'outlet', StockLevel: 'outlet', StockTransfer: 'outlet',
  TransactionSession: 'outlet',
  // ── derived from a parent / user ──
  JournalLine: 'journal',
  SignedBillWriteOff: 'bill',
  AccountReconciliation: 'account',
  AuditLog: 'user', Notification: 'user', UserPermission: 'user',
  // ── shared masters, config and counters (belong to the original company; copied per company later) ──
  Attachment: 'global', BillReferenceConfig: 'global', BillReferenceRegistry: 'global', BillSequenceCounter: 'global',
  BillTypeConfig: 'global', CancellationReason: 'global', Department: 'global', ExcessReason: 'global',
  ExpenseRequestSequence: 'global', PaymentChannel: 'global', Person: 'global', PersonCategory: 'global',
  PettyFunction: 'global', PosProductExtra: 'global', PriceChangeLog: 'global', Product: 'global',
  ProductCategory: 'global', PurchaseOrder: 'global', RolePermission: 'global', Supplier: 'global', Warehouse: 'global',
}

/** child model -> parent it is reached through (documentation + CI check; no column). */
export const CHILDREN: Record<string, string> = {
  AttendanceRecord: 'Employee', BillItem: 'SignedBill', BillReferenceComponent: 'BillReferenceConfig',
  BusinessDayAuditLog: 'BusinessDay', BusinessDayUnlockRequest: 'BusinessDay',
  CancellationReasonCategory: 'CancellationReason', CancellationReasonProduct: 'CancellationReason',
  CashReconExcess: 'CashRecon', CollectionExcess: 'DailyCollection', CollectionField: 'CollectionSection',
  CollectionFieldValue: 'CollectionStageRecord', CollectionSection: 'CollectionStage', CollectionStage: 'CollectionTemplate',
  CollectionStageRecord: 'CollectionSession', CollectionValidationRule: 'CollectionTemplate',
  ComponentAssignment: 'PayComponent', CreditAccountGroup: 'CreditAccount', CreditTransaction: 'CreditAccount',
  DailyCollectionChannel: 'DailyCollection', EventExpense: 'Event', EventProduct: 'Event', EventSponsor: 'Event',
  EventStaff: 'Event', EventTable: 'Event', EventTarget: 'Event', EventTicketType: 'Event',
  ExpenseItem: 'ExpenseRequest', ExpensePayment: 'FundingSource', ExpenseRequestFieldValue: 'ExpenseRequest',
  FundingSourceCustodian: 'FundingSource', FundingSourceTxn: 'FundingSource', GrnItem: 'Grn',
  LeaveBalance: 'Employee', LeaveRequest: 'Employee', PaymentAllocation: 'ExpensePayment', PaymentInstruction: 'PaymentBatch',
  PayrollAuditLog: 'PayrollRun', Payslip: 'PayrollRun', PayslipLine: 'Payslip', PettyCashItem: 'PettyCash',
  PettyFundTxn: 'PettyFund', PosOrderItem: 'PosOrder', PosPayment: 'PosOrder', PosPrintLog: 'PosOrder',
  PosWaiterSession: 'PosShift', PriceListItem: 'PriceList', PurchaseOrderItem: 'PurchaseOrder',
  ReconciliationCheckResult: 'ReconciliationStage', ReconciliationItem: 'AccountReconciliation',
  ReconciliationStageAuditLog: 'ReconciliationStage', ReconciliationStageUnlockRequest: 'ReconciliationStage',
  RequestTypeField: 'RequestType', SalesImportLine: 'SalesImport', StaffUnavailability: 'User',
  StockCountItem: 'StockCountSession', StockLossAttribution: 'StockCountSession', StockTransferItem: 'StockTransfer',
  SupplierPaymentAllocation: 'SupplierPayment', SystemSalesRecord: 'TransactionSession', TableBooking: 'Event',
  TicketBooking: 'Event', VerificationRecord: 'ExpenseRequest', WorkflowApproval: 'CollectionStageRecord',
  WriteOffAuditLog: 'WriteOffRequest',
}

/** (scope, scopeId) configuration tables — GLOBAL = platform default, COMPANY / OUTLET rows name their owner. */
export const SCOPED = [
  'BusinessCalendarAuditLog', 'BusinessCalendarConfig', 'BusinessCalendarOverride', 'BusinessDayPolicyConfig',
  'BusinessPeriodVersion', 'CollectionModeConfig', 'CreditModuleConfig', 'ExpenseModuleConfig', 'FinanceAccountMapping',
  'PayrollModuleConfig', 'ReconciliationReminderPolicy', 'ReconciliationRequirement', 'ReconciliationStageConfig',
  'ShiftTemplate',
] as const

/** Identity / platform tables outside any single company. */
export const IDENTITY = [
  'Company', 'NotificationPreference', 'PlatformAdmin', 'PlatformAuditLog', 'PushSubscription', 'User',
] as const

/** Not yet per-company: the key itself must change first. */
export const DEFERRED: Record<string, string> = {
  Setting: 'key is the primary key (global); needs a (companyId, key) redesign + a per-company CompanyConfig - Phase 3 step 3g',
}

/**
 * Company-native models: they already carried a `companyId` column before the multi-company programme (the
 * finance / payroll / expense / credit / reconciliation families, Outlet, ...). Together with TENANT_ROOTS these
 * are the models the Prisma tenant guard (lib/tenant-guard.ts) scopes to the session's company. Verified against
 * schema.prisma by `npm run check:tenancy`.
 */
export const NATIVE: readonly string[] = [
  'Outlet',
  'SalesImport',
  'SalesStaffAlias',
  'SalesProductAlias',
  'CustomerGroup',
  'PriceList',
  'Promotion',
  'CollectionTemplate',
  'BusinessSession',
  'Grn',
  'Account',
  'FinancialPeriod',
  'JournalEntry',
  'SupplierInvoice',
  'SupplierPayment',
  'CompanyPaymentAccount',
  'BankTransaction',
  'Budget',
  'ReconciliationStage',
  'PaymentVerification',
  'PaymentIntegrationConnector',
  'WriteOffRequest',
  'CreditPolicy',
  'CreditGroup',
  'CreditAccount',
  'EmployeeCategory',
  'PayGroup',
  'Employee',
  'PayrollFormula',
  'PayComponent',
  'PayrollRun',
  'StatutoryRule',
  'LeaveType',
  'PaymentBatch',
  'RequestType',
  'ExpenseCategory',
  'FundingSource',
  'ExpenseRequest',
  'ExpenseAccessGrant',
  'ExpenseNotificationRule',
] as const

/** Carry a companyId column but are deliberately NOT scoped: a user's memberships span companies by design. */
export const EXEMPT: readonly string[] = ['Membership'] as const

/** Every model the tenant guard scopes by its `companyId` column. */
export const GUARDED: ReadonlySet<string> = new Set<string>([...Object.keys(TENANT_ROOTS), ...NATIVE])

export function classify(model: string): 'ROOT' | 'NATIVE' | 'EXEMPT' | 'CHILD' | 'SCOPED' | 'IDENTITY' | 'DEFERRED' | null {
  if (model in TENANT_ROOTS) return 'ROOT'
  if (NATIVE.includes(model)) return 'NATIVE'
  if (EXEMPT.includes(model)) return 'EXEMPT'
  if (model in CHILDREN) return 'CHILD'
  if ((SCOPED as readonly string[]).includes(model)) return 'SCOPED'
  if ((IDENTITY as readonly string[]).includes(model)) return 'IDENTITY'
  if (model in DEFERRED) return 'DEFERRED'
  return null
}
