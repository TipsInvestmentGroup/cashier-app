'use client'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CATEGORY_TO_BILLTYPE } from '@/lib/categories'

export interface BillLite { id: string; personName: string; amount: number; billType: string; status: string; seq?: number; date?: string }

/**
 * Multi-select checklist of a member's outstanding bills (same category).
 * Only renders when the member has MORE THAN ONE outstanding bill — a single
 * bill is handled by the normal single-link picker. Excess on the recorded
 * payment auto-applies to the unticked bills (oldest-first) on the server.
 */
export function BillSelector({ bills, payerName, category, selectedIds, onChange }: {
  bills: BillLite[]; payerName: string; category: string; selectedIds: string[]; onChange: (ids: string[], bills: BillLite[]) => void
}) {
  if (!payerName) return null
  const type = CATEGORY_TO_BILLTYPE[category]
  const matching = bills.filter((b) => b.personName === payerName && (!type || b.billType === type) && b.status !== 'PAID')
  if (matching.length <= 1) return null

  const toggle = (id: string) => {
    const next = selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    onChange(next, matching)
  }

  return (
    <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-3">
      <p className="text-xs font-semibold text-indigo-700 mb-2">
        {payerName} has {matching.length} outstanding {category || ''} bills — tick the ones being paid (any excess auto-applies oldest-first):
      </p>
      <div className="space-y-1 max-h-44 overflow-auto">
        {matching.map((b) => (
          <label key={b.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-white/60 rounded px-1 py-0.5">
            <input type="checkbox" className="w-4 h-4" checked={selectedIds.includes(b.id)} onChange={() => toggle(b.id)} />
            <span className="font-semibold text-gray-800">{b.date ? formatDate(b.date) : ''} · #{b.seq ?? '?'}</span>
            <span className="text-gray-600">— {formatCurrency(b.amount)}</span>
            {b.status === 'PARTIAL' && <span className="text-xs text-yellow-600 font-medium">(partial)</span>}
          </label>
        ))}
      </div>
    </div>
  )
}
