'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'

interface Group { id: string; name: string; code?: string; isActive: boolean; _count?: { persons: number; priceLists: number } }

export function CustomerGroupsTab() {
  const { request } = useApi()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<Group | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await request('/api/customer-groups'); setRows(r.rows || []) } catch { /* empty */ } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const del = async (g: Group) => {
    if (!(await confirm({ title: 'Delete group?', message: `Delete "${g.name}"?`, danger: true, confirmLabel: 'Delete' }))) return
    try { await request(`/api/customer-groups/${g.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> New customer group</Button>
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm"><EmptyState icon="👥" title="No customer groups" hint="Create pricing segments like VIP, Corporate or Staff, then scope price lists and promotions to them." /></div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide"><tr><th className="px-4 py-2.5 text-left font-semibold">Name</th><th className="px-4 py-2.5 text-left font-semibold">Code</th><th className="px-4 py-2.5 text-right font-semibold">Members</th><th className="px-4 py-2.5 text-right font-semibold">Price lists</th><th className="px-4 py-2.5 text-left font-semibold">Status</th><th className="px-4 py-2.5 text-right font-semibold">Actions</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((g) => (
                <tr key={g.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{g.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">{g.code || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{g._count?.persons ?? 0}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{g._count?.priceLists ?? 0}</td>
                  <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold ${g.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{g.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td className="px-4 py-2.5"><div className="flex items-center justify-end gap-1.5"><button onClick={() => setEdit(g)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil className="w-4 h-4" /></button><button onClick={() => del(g)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(showNew || edit) && <GroupModal group={edit} onClose={() => { setShowNew(false); setEdit(null) }} onSaved={() => { setShowNew(false); setEdit(null); load() }} />}
    </div>
  )
}

function GroupModal({ group, onClose, onSaved }: { group: Group | null; onClose: () => void; onSaved: () => void }) {
  const { request } = useApi()
  const [f, setF] = useState({ name: group?.name || '', code: group?.code || '', isActive: group?.isActive ?? true })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return toast.error('Name required.')
    setSaving(true)
    try {
      if (group) await request(`/api/customer-groups/${group.id}`, { method: 'PATCH', body: JSON.stringify(f) })
      else await request('/api/customer-groups', { method: 'POST', body: JSON.stringify(f) })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }
  const inp = 'w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-gray-900">{group ? 'Edit' : 'New'} customer group</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label><input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. VIP" /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Code</label><input className={inp} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          {group && <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Active</label>}
        </div>
        <div className="flex gap-2 mt-4"><Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </div>
  )
}
