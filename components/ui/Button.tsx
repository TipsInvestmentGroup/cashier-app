import { cn } from '@/lib/utils'

// One source of truth for buttons. Locked tokens: rounded-xl, active:scale-95.
type Variant = 'primary' | 'outline' | 'danger' | 'ghost' | 'success'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  outline: 'border-2 border-gray-200 text-gray-700 hover:bg-gray-50',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100',
  ghost: 'text-gray-600 hover:bg-gray-100',
  success: 'bg-green-600 text-white hover:bg-green-700 shadow-sm',
}
const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
}

export function Button({
  variant = 'primary', size = 'md', className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant], SIZES[size], className
      )}
      {...props}
    />
  )
}
