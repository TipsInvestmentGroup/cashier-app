'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Label, Input, Select } from '@/components/ui/Input'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { BILL_TYPE_CATEGORIES } from '@/lib/bill-reference-defaults'
import toast from 'react-hot-toast'

interface BillType {
  id: string
  code: string
  name: string
  prefix: string
  category: string
  isActive: boolean
  sortOrder: number
}

const CATEGORY_LABELS: Record<string, string> = {
  SIGNED_BILL: 'Signed Bill',
  PAID_BILL: 'Paid Bill',
  EXCESS_PAYMENT: 'Excess Payment',
  EXCESS_REFUND: 'Excess Refund',
  LOSS_RECORD: 'Loss Record',
}

export default function BillTypesPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<BillType[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', prefix: '', category: BILL_TYPE_CATEGORIES[0] as string })
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState({ name: '', prefix: '', sortOrder: 0 })

  const canManage = user?.role === 'ADMIN' || user?.role === 'DIRECTOR'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await request('/api/bill-types')
      setItems(data || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.name.trim() || !addForm.prefix.trim()) return
    setSubmitting(true)
    try {
      await request('/api/bill-types', {
        method: 'POST',
        body: JSON.stringify({ name: addForm.name.trim(), prefix: addForm.prefix.trim(), category: addForm.category }),
      })
      toast.success('Bill type added')
      setAddForm({ name: '', prefix: '', category: BILL_TYPE_CATEGORIES[0] as string })
      setShowAdd(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not add bill type')
    } finally { setSubmitting(false) }
  }

  const startEdit = (b: BillType) => {
    setEditing(b.id)
    setEditValue({ name: b.name, prefix: b.prefix, sortOrder: b.sortOrder })
  }

  const saveEdit = async (id: string) => {
    try {
      await request(`/api/bill-types/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editValue.name.trim(), prefix: editValue.prefix.trim(), sortOrder: editValue.sortOrder }),
      })
      toast.success('Saved')
      setEditing(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const toggle = async (b: BillType) => {
    try {
      await request(`/api/bill-types/${b.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !b.isActive }) })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    }
  }

  const remove = async (b: BillType) => {
    if (!confirm(`Delete bill type "${b.name}"?`)) return
    try {
      await request(`/api/bill-types/${b.id}`, { method: 'DELETE' })
      toast.success('Deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  const groups = (BILL_TYPE_CATEGORIES as readonly string[]).map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat] || cat,
    rows: items.filter((i) => i.category === cat),
  }))

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bill Types</h1>
            <p className="text-gray-500 text-sm">Bill Reference System — the types every Signed Bill, Paid Bill, Excess Payment/Refund and Loss Record can carry</p>
          </div>
          {canManage && <Button onClick={() => setShowAdd(true)}><span>+</span> New Bill Type</Button>}
        </div>

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            View only. Adding/editing/deleting bill types is limited to Admin and Director.
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <EmptyState icon="🏷️" title="No bill types yet" hint="They should seed automatically — reload the page." />
        ) : (
          <div className="space-y-5">
            {groups.map((g) => g.rows.length === 0 ? null : (
              <Card key={g.category}>
                <CardHeader title={g.label} subtitle={`${g.rows.length} bill type${g.rows.length === 1 ? '' : 's'}`} />
                <div className="divide-y divide-gray-50">
                  {g.rows.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 py-2.5">
                      {editing === b.id ? (
                        <>
                          <input
                            value={editValue.name}
                            onChange={(e) => setEditValue((v) => ({ ...v, name: e.target.value }))}
                            autoFocus
                            className="flex-1 min-w-0 px-3 py-2 border-2 border-indigo-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
                            placeholder="Name"
                          />
                          <input
                            value={editValue.prefix}
                            onChange={(e) => setEditValue((v) => ({ ...v, prefix: e.target.value }))}
                            className="w-24 px-3 py-2 border-2 border-indigo-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
                            placeholder="Prefix"
                          />
                          <input
                            type="number"
                            value={editValue.sortOrder}
                            onChange={(e) => setEditValue((v) => ({ ...v, sortOrder: Number(e.target.value) }))}
                            className="w-16 px-2 py-2 border-2 border-indigo-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none"
                            title="Sort order"
                          />
                          <button onClick={() => saveEdit(b.id)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg">Save</button>
                          <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg">Cancel</button>
                        </>
                      ) : (
                        <>
                          <span className={`flex-1 min-w-0 truncate text-sm ${b.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>{b.name}</span>
                          <span className="text-xs text-gray-400 font-mono">{b.prefix}</span>
                          <Badge tone="indigo" className="font-mono">{b.code}</Badge>
                          {canManage && (
                            <div className="flex gap-1.5 ml-1">
                              <button onClick={() => startEdit(b)} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Edit</button>
                              <button onClick={() => toggle(b)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">{b.isActive ? 'Disable' : 'Enable'}</button>
                              <button onClick={() => remove(b)} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-400">
          Code is permanent once a type is created — it&apos;s how already-issued bills stay linked. Once a bill type has been used by any bill, it can only be deactivated, not deleted.
        </p>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Bill Type">
        <form onSubmit={add} className="space-y-4">
          <div>
            <Label>Name *</Label>
            <Input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Signed Bill - Supplier" required />
          </div>
          <div>
            <Label>Prefix *</Label>
            <Input value={addForm.prefix} onChange={(e) => setAddForm((f) => ({ ...f, prefix: e.target.value }))} placeholder="e.g. SUP" required />
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={addForm.category} onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}>
              {BILL_TYPE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
              ))}
            </Select>
          </div>
          <p className="text-xs text-gray-400">A short code (e.g. SUP) is generated automatically from the name — it can&apos;t be changed later.</p>
          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={submitting} className="flex-1">{submitting ? 'Creating…' : 'Create Bill Type'}</Button>
            <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  )
}
