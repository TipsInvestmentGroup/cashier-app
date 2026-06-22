// A friendly empty state with optional call-to-action — replaces bare
// "No items" gray text so dead screens point to a next action.
export function EmptyState({
  icon = '📭', title, hint, action,
}: {
  icon?: string
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
      <div className="text-4xl mb-2 opacity-80">{icon}</div>
      <p className="text-gray-700 font-semibold">{title}</p>
      {hint && <p className="text-gray-400 text-sm mt-1 max-w-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
