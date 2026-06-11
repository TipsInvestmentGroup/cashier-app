'use client'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }: Props) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-11 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
      />
      {value && (
        <button onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">✕</button>
      )}
    </div>
  )
}
