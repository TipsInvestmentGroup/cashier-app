'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import toast from 'react-hot-toast'

type Action = 'add' | 'edit' | 'delete'
const ACTION_LABEL: Record<Action, string> = { add: 'Add', edit: 'Edit', delete: 'Delete' }
const ACTION_FIELD: Record<Action, 'canAdd' | 'canEdit' | 'canDelete'> = { add: 'canAdd', edit: 'canEdit', delete: 'canDelete' }

interface UserLite { id: string; name: string; email: string }
interface Grant { userId: string; canAdd: boolean; canEdit: boolean; canDelete: boolean; user: UserLite }

export function ManageAccessModal({
  open, onClose, resource, resourceLabel, actions, request,
}: {
  open: boolean
  onClose: () => void
  resource: string
  resourceLabel: string
  actions: Action[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (url: string, opts?: any) => Promise<any>
}) {
  const [users, setUsers] = useState<UserLite[]>([])
  const [grants, setGrants] = useState<Record<string, Grant>>({})
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    Promise.all([request('/api/users'), request(`/api/permissions?resource=${resource}`)])
      .then(([u, g]) => {
        setUsers(u || [])
        const map: Record<string, Grant> = {}
        for (const row of g || []) map[row.userId] = row
        setGrants(map)
      })
      .catch(() => toast.error('Could not load access list'))
      .finally(() => setLoading(false))
  }, [open, resource, request])

  const toggle = async (userId: string, action: Action, current: Grant | undefined) => {
    const field = ACTION_FIELD[action]
    const key = `${userId}:${action}`
    const next = {
      canAdd: current?.canAdd || false,
      canEdit: current?.canEdit || false,
      canDelete: current?.canDelete || false,
      [field]: !current?.[field],
    }
    setSavingKey(key)
    try {
      await request('/api/permissions', { method: 'PUT', body: JSON.stringify({ resource, userId, ...next }) })
      setGrants((prev) => ({ ...prev, [userId]: { userId, user: prev[userId]?.user || users.find((u) => u.id === userId)!, ...next } }))
      toast.success('Access updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating access')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Manage Access — ${resourceLabel}`} className="max-w-lg">
      <p className="text-sm text-gray-500 mb-3">Grant or revoke {actions.map((a) => ACTION_LABEL[a]).join('/')} access for specific accounts. The owner always has full access.</p>
      {loading ? (
        <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
          {users.map((u) => {
            const g = grants[u.id]
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                  <p className="text-xs text-gray-400 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {actions.map((a) => {
                    const key = `${u.id}:${a}`
                    return (
                      <label key={a} className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
                        <input
                          type="checkbox"
                          checked={!!g?.[ACTION_FIELD[a]]}
                          disabled={savingKey === key}
                          onChange={() => toggle(u.id, a, g)}
                          className="w-4 h-4"
                        />
                        {ACTION_LABEL[a]}
                      </label>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {users.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No user accounts found.</p>}
        </div>
      )}
    </Modal>
  )
}
