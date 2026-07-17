// Event taxonomy config: the picker options for an event's type and its
// expense-line categories. Client-safe (no prisma) — see
// lib/event-config-db.ts for the server-side cached loader. Defaults ARE
// today's live values (including the legacy Phase-1 category duplicates
// still needed so old expense lines keep validating — see the comment on
// EVENT_EXPENSE_CATEGORIES in lib/scheduling.ts).

export interface EventConfig {
  eventTypes: string[]
  expenseCategories: string[]
}

export const DEFAULT_EVENT_CONFIG: EventConfig = {
  eventTypes: ['Wedding', 'Corporate', 'Concert', 'Private Party', 'Product Launch', 'Other'],
  expenseCategories: [
    'Transport', 'Equipment Hire', 'Food & Drinks', 'Decor', 'Staff Allowance', 'Other',
    'Casual Labour', 'Staff Allowances', 'Security', 'Fuel', 'Decorations', 'Entertainment',
    'Marketing & Advertising', 'Equipment Rental', 'Cleaning', 'Licenses & Permits', 'Utilities', 'Miscellaneous Expenses',
  ],
}

function normalizeList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return [...fallback]
  const cleaned = raw.map((v) => String(v).trim()).filter(Boolean)
  return cleaned.length ? cleaned : [...fallback]
}

export function normalizeEventConfig(raw: unknown): EventConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    eventTypes: normalizeList(r.eventTypes, DEFAULT_EVENT_CONFIG.eventTypes),
    expenseCategories: normalizeList(r.expenseCategories, DEFAULT_EVENT_CONFIG.expenseCategories),
  }
}
