// Evaluates a CollectionTemplate's CollectionValidationRule rows against a
// single stage submission. Rule types are a small, fixed enum (not a generic
// expression DSL) — see the ruleType comment block in prisma/schema.prisma.
// Rules that reference field values do so by the field's `key` (looked up
// via `config`), so they keep working if an admin reorders fields or fields
// get new database ids.

export class CollectionValidationError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

interface FieldLite { id: string; key: string }
interface StageLite { id: string; order: number; isOptional: boolean }
interface StageRecordLite { stageId: string; status: string }
interface RuleLite { id: string; ruleType: string; config: string | null; isActive: boolean }

export interface ApprovalNeeded { ruleId: string; approverRole: string; reason: string }

interface EvaluateArgs {
  rules: RuleLite[]
  allStages: StageLite[]
  existingRecords: StageRecordLite[]
  currentStage: StageLite
  fields: FieldLite[]
  values: Record<string, unknown>
}

function parseConfig(config: string | null): Record<string, unknown> {
  if (!config) return {}
  try { return JSON.parse(config) } catch { return {} }
}

function fieldValue(fields: FieldLite[], values: Record<string, unknown>, key: unknown): number | null {
  if (typeof key !== 'string') return null
  const field = fields.find((f) => f.key === key)
  if (!field) return null
  const raw = values[field.id]
  if (raw === undefined || raw === null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

/**
 * Throws CollectionValidationError for a blocking violation. Returns a list
 * of ApprovalNeeded entries (usually 0 or 1) for rules that don't block the
 * submission but require sign-off before the stage record counts as done.
 */
export function evaluateStageSubmit({ rules, allStages, existingRecords, currentStage, fields, values }: EvaluateArgs): ApprovalNeeded[] {
  const approvals: ApprovalNeeded[] = []

  for (const rule of rules.filter((r) => r.isActive)) {
    const config = parseConfig(rule.config)

    if (rule.ruleType === 'STAGE_SEQUENCE') {
      const priorStages = allStages.filter((s) => s.order < currentStage.order && !s.isOptional)
      const incomplete = priorStages.find((s) => !existingRecords.some((r) => r.stageId === s.id && (r.status === 'COMPLETED' || r.status === 'APPROVED')))
      if (incomplete) throw new CollectionValidationError('A required earlier stage has not been completed for this session yet', 409)
    }

    if (rule.ruleType === 'CASH_NOT_EXCEED_SYSTEM_SALES') {
      const cash = fieldValue(fields, values, config.cashFieldKey)
      const systemSales = fieldValue(fields, values, config.systemSalesFieldKey)
      const reasonKey = config.reasonFieldKey
      if (cash !== null && systemSales !== null && cash > systemSales) {
        const hasReason = typeof reasonKey === 'string' && fields.some((f) => f.key === reasonKey) && !!values[fields.find((f) => f.key === reasonKey)!.id]
        if (!hasReason) throw new CollectionValidationError('Cash collected exceeds System Sales — provide an excess reason to continue', 409)
      }
    }

    if (rule.ruleType === 'NO_NEGATIVE_BALANCE') {
      const targetKeys = typeof config.fieldKey === 'string' ? [config.fieldKey] : fields.map((f) => f.key)
      for (const key of targetKeys) {
        const v = fieldValue(fields, values, key)
        if (v !== null && v < 0) throw new CollectionValidationError(`"${key}" cannot be negative`, 400)
      }
    }

    if (rule.ruleType === 'DISCOUNT_APPROVAL_LIMIT') {
      const amount = fieldValue(fields, values, config.fieldKey)
      const limit = Number(config.limit)
      const approverRole = typeof config.approverRole === 'string' ? config.approverRole : 'MANAGER'
      if (amount !== null && !Number.isNaN(limit) && amount > limit) {
        approvals.push({ ruleId: rule.id, approverRole, reason: `Discount of ${amount} exceeds the ${limit} limit` })
      }
    }

    // REQUIRED_FIELD is a no-op here — CollectionField.isRequired is already
    // enforced generically by the stage-submit route before rules run.
  }

  return approvals
}
