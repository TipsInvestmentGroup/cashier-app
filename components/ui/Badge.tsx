import { cn } from '@/lib/utils'
import { STATUS_COLORS, BILL_TYPE_COLORS } from '@/lib/utils'

// Semantic badge. Prefer the `tone`/`status`/`billType` props so colors stay
// driven by the central maps in lib/utils rather than re-picked per page.
type Tone = 'gray' | 'green' | 'red' | 'amber' | 'indigo' | 'blue' | 'purple'

const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  amber: 'bg-amber-100 text-amber-700',
  indigo: 'bg-indigo-100 text-indigo-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
}

export function Badge({
  tone = 'gray', status, billType, className, children,
}: {
  tone?: Tone
  status?: string // looked up in STATUS_COLORS
  billType?: string // looked up in BILL_TYPE_COLORS
  className?: string
  children: React.ReactNode
}) {
  const mapped = status ? STATUS_COLORS[status] : billType ? BILL_TYPE_COLORS[billType] : undefined
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold', mapped || TONES[tone], className)}>
      {children}
    </span>
  )
}
