'use client'
import { useEffect, useState, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { VALID_ROLES } from '@/lib/shared-constants'
import { Card, CardHeader } from '@/components/ui/Card'
import toast from 'react-hot-toast'

const RESOURCES = [
  { key: 'VIEW_BUSINESS_DAYS', label: 'View Business Days' },
  { key: 'CLOSE_BUSINESS_DAY', label: 'Close Business Day' },
  { key: 'UNLOCK_BUSINESS_DAY', label: 'Unlock Business Day' },
  { key: 'APPROVE_UNLOCK', label: 'Approve Unlock' },
  { key: 'EDIT_CLOSED_RECORDS', label: 'Edit Closed Records' },
  { key: 'VIEW_BUSINESS_DAY_AUDIT_LOG', label: 'View Audit Log' },
]

interface RoleRow { role: string; allowed: boolean }

/** Owner-only role-default grid for the Business Day Exception Management
 *  resources — lets the owner configure who can do what by role, with no
 *  hardcoded role checks in the underlying API routes. */
export function BusinessDayRoleAccessPanel() {
  const { request } = useApi()
  const [grants, setGrants] = useState<Record<string, Record<string, boolean>>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const results = await Promise.all(RESOURCES.map((r) => request(`/api/role-permissions?resource=${r.key}`)))
      const next: Record<string, Record<string, boolean>> = {}
      results.forEach((rows: RoleRow[], i) => {
        for (const row of rows) {
          next[row.role] = next[row.role] || {}
          next[row.role][RESOURCES[i].key] = row.allowed
        }
      })
      setGrants(next)
    } catch { /* owner-only; a non-owner viewer just sees nothing */ } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const toggle = async (role: string, resource: string, current: boolean) => {
    const key = `${role}:${resource}`
    setSavingKey(key)
    try {
      await request('/api/role-permissions', { method: 'PUT', body: JSON.stringify({ role, resource, allowed: !current }) })
      setGrants((prev) => ({ ...prev, [role]: { ...prev[role], [resource]: !current } }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update')
    } finally { setSavingKey(null) }
  }

  if (loading) return null

  return (
    <Card className="overflow-x-auto">
      <CardHeader title="Role Access — Business Day Exception Management" subtitle="Owner-only: which roles can do what by default (per-user overrides still take precedence)." />
      <table className="w-full text-sm min-w-[640px]">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="pr-4 py-2 font-semibold">Role</th>
            {RESOURCES.map((r) => <th key={r.key} className="px-2 py-2 font-semibold text-xs">{r.label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {VALID_ROLES.map((role) => (
            <tr key={role}>
              <td className="pr-4 py-2 font-medium text-gray-800">{role}</td>
              {RESOURCES.map((r) => {
                const key = `${role}:${r.key}`
                return (
                  <td key={r.key} className="px-2 py-2 text-center">
                    <input type="checkbox" className="w-4 h-4"
                      checked={!!grants[role]?.[r.key]}
                      disabled={savingKey === key}
                      onChange={() => toggle(role, r.key, !!grants[role]?.[r.key])} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
