'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useAuth } from '@/contexts/AuthContext'

interface Product { id: string; name: string; code: string; category: string | null; sellingPrice: number; blocked: boolean }

export default function ItemBlockerPage() {
  const { user, token } = useAuth()
  const [products, setProducts] = useState<Product[]>([])
  const [blocked, setBlocked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const outletId = user?.outlet?.id ?? ''

  const load = useCallback(async () => {
    if (!token) return
    const url = outletId ? `/api/pos/products?outletId=${outletId}` : '/api/pos/products'
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    const all: Product[] = data.flat
    setProducts(all)
    setBlocked(new Set(all.filter((p: Product) => p.blocked).map((p: Product) => p.id)))
    const cats = [...new Set(all.map((p: Product) => p.category ?? 'Other'))] as string[]
    setCategories(cats.sort())
    if (cats.length && !activeCategory) setActiveCategory(cats[0])
  }, [token, outletId, activeCategory])

  useEffect(() => { load() }, [load])

  const toggleBlock = async (product: Product) => {
    if (!token) return
    setBusy(product.id)
    const isBlocked = blocked.has(product.id)

    if (isBlocked) {
      const res = await fetch(`/api/pos/blocked-items?productId=${product.id}&outletId=${outletId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setBlocked(prev => { const n = new Set(prev); n.delete(product.id); return n })
    } else {
      const res = await fetch('/api/pos/blocked-items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id, outletId, reason: 'Out of stock' }),
      })
      if (res.ok) setBlocked(prev => new Set([...prev, product.id]))
    }
    setBusy(null)
  }

  const filtered = products.filter(p => {
    const matchCat = !activeCategory || (p.category ?? 'Other') === activeCategory
    const matchSearch = !search.trim() || p.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchSearch
  })

  const blockedCount = blocked.size

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-indigo-900">Item Blocker</h1>
            <p className="text-sm text-gray-500">Zima bidhaa ambazo hazipatikani leo</p>
          </div>
          {blockedCount > 0 && (
            <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-sm font-bold">
              {blockedCount} zimezimwa
            </span>
          )}
        </div>

        <input
          type="text"
          placeholder="Tafuta bidhaa..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-3 focus:outline-none focus:border-indigo-400"
        />

        {!search && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium flex-shrink-0 transition-colors ${activeCategory === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {filtered.map(product => {
            const isBlocked = blocked.has(product.id)
            const isBusy = busy === product.id
            return (
              <div key={product.id} className={`flex items-center gap-3 bg-white rounded-xl border p-3 transition-all ${isBlocked ? 'border-rose-200 bg-rose-50' : 'border-gray-100'}`}>
                <div className="flex-1">
                  <div className={`font-medium text-sm ${isBlocked ? 'text-rose-700 line-through' : 'text-gray-800'}`}>
                    {product.name}
                  </div>
                  <div className="text-xs text-gray-400">{product.category ?? 'Other'} · TSh {product.sellingPrice.toLocaleString()}</div>
                </div>
                <button
                  onClick={() => toggleBlock(product)}
                  disabled={isBusy}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50 ${isBlocked ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-rose-100 text-rose-700 hover:bg-rose-200'}`}
                >
                  {isBusy ? '...' : isBlocked ? '✓ Washa' : '✕ Zima'}
                </button>
              </div>
            )
          })}

          {filtered.length === 0 && (
            <div className="text-center py-10 text-gray-400 text-sm">Hakuna bidhaa</div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
