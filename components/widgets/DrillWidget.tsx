import { formatCurrency } from '@/lib/utils'
import type { DrillWidgetDef } from './types'

const STATUS_STYLE: Record<string, string> = {
  DECLARED: 'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
}

function EmptyRow() {
  return <p className="py-4 text-center text-gray-400 text-xs">Nothing here</p>
}

function RecordRow({ label, sub, amount, status, isCount }: { label: string; sub?: string; amount: number; status?: string; isCount?: boolean }) {
  return (
    <div className="py-2 flex items-center justify-between gap-2 text-sm">
      <div>
        <span className="font-medium text-gray-700">{label}</span>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-gray-900">{isCount ? amount : formatCurrency(amount)}</span>
        {status && <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace('_', ' ')}</span>}
      </div>
    </div>
  )
}

/**
 * Renders one DrillWidgetDef — summary tiles that expand to a flat record
 * list. Generalizes the app/my-transactions/page.tsx DrillCard that used to
 * be hard-coded per section (Signed Bills, Discounts, Cancellations, Paid
 * Bills all had near-identical inline blocks) into one reusable component
 * driven by the def's getTiles/getRecords accessors.
 */
export function DrillWidget<T>({
  def, data, expanded, setExpanded,
}: {
  def: DrillWidgetDef<T>; data: T
  expanded: string | null; setExpanded: (k: string | null) => void
}) {
  const isOpen = expanded === def.key
  const tiles = def.getTiles(data)
  const records = def.getRecords(data)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <button onClick={() => setExpanded(isOpen ? null : def.key)} className="w-full flex items-center justify-between p-5 pb-3 text-left">
        <h2 className="font-semibold text-gray-800">{def.title}</h2>
        <span className="text-xs text-indigo-600 font-semibold">{isOpen ? 'Hide details' : 'View details'}</span>
      </button>
      <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {tiles.map((t) => (
          <div key={t.label} className="bg-gray-50 rounded-lg px-2.5 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{t.label}</p>
            <p className="font-semibold text-gray-800">{t.isCount ? `${t.value}${t.suffix || ''}` : formatCurrency(t.value)}</p>
          </div>
        ))}
      </div>
      {isOpen && (
        <div className="border-t border-gray-100 px-5 py-2 bg-gray-50/60 divide-y divide-gray-100">
          {records.length === 0 ? <EmptyRow /> : records.map((r) => (
            <RecordRow key={r.id} label={r.label} sub={r.sub} amount={r.amount} status={r.status} isCount={r.isCount} />
          ))}
        </div>
      )}
    </div>
  )
}
