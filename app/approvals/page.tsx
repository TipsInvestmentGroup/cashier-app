'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, PETTY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import toast from 'react-hot-toast'

interface PettyCash {
  id: string; date: string; requestedBy: string; department?: string; functionName?: string; purpose: string
  amount: number; paymentMethod: string; payeeName?: string; payeeAccount?: string
  approvedBy?: string; status: string
}

export default function ApprovalsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<PettyCash[]>([])
  const [loading, setLoading] = useState(true)
  const [canApprove, setCanApprove] = useState(false)
  const [approverEmails, setApproverEmails] = useState<string[]>([])
  const [tab, setTab] = useState<'pending' | 'decided'>('pending')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [its, access] = await Promise.all([request('/api/petty-cash'), request('/api/petty-access')])
      setItems(its || [])
      setCanApprove(!!access?.canApprove)
      setApproverEmails(access?.approverEmails || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      await request(`/api/petty-cash/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      toast.success(action === 'approve' ? 'Request approved' : 'Request rejected')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating request')
    }
  }

  const q = search.trim().toLowerCase()
  const matchesSearch = (i: PettyCash) =>
    !q || `${i.requestedBy} ${i.purpose} ${i.department || ''} ${i.functionName || ''} ${i.payeeName || ''}`.toLowerCase().includes(q)
  const pending = items.filter((i) => i.status === 'PENDING' && matchesSearch(i))
  const decided = items.filter((i) => i.status !== 'PENDING' && matchesSearch(i))
  const list = tab === 'pending' ? pending : decided
  const pendingTotal = pending.reduce((s, i) => s + i.amount, 0)

  return (
    <AppShell>
      <SectionTabs tabs={PETTY_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Approval Requests</h1>
            <p className="text-gray-500 text-sm">Review and decide petty-cash requests</p>
          </div>
          <Link href="/petty-cash"
            className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
            ➕ Petty Cash Approval Request
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 max-w-lg">
          <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-4 shadow">
            <p className="text-orange-100 text-xs">⏳ Pending Approval</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(pendingTotal)}</p>
            <p className="text-orange-200 text-xs mt-1">{pending.length} request(s)</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">Your access</p>
            <p className={`text-sm font-bold mt-1 ${canApprove ? 'text-green-600' : 'text-gray-400'}`}>
              {canApprove ? '✓ Can approve/reject' : 'View only'}
            </p>
            <p className="text-gray-400 text-[11px] mt-1 truncate" title={approverEmails.join(', ')}>
              Approvers: {approverEmails.join(', ') || '—'}
            </p>
          </div>
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search by requester, purpose, department, function or payee…" />

        <div className="flex gap-2">
          <button onClick={() => setTab('pending')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === 'pending' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            Pending ({pending.length})
          </button>
          <button onClick={() => setTab('decided')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${tab === 'decided' ? 'bg-indigo-600 text-white shadow' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'}`}>
            Decided ({decided.length})
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Requested By</th>
                    <th className="px-4 py-3 font-semibold">Department</th>
                    <th className="px-4 py-3 font-semibold">Function</th>
                    <th className="px-4 py-3 font-semibold">Purpose</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Payee</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {tab === 'pending' && canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map((i) => (
                    <tr key={i.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{i.requestedBy}</td>
                      <td className="px-4 py-3 text-gray-500">{i.department || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{i.functionName || '-'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate" title={i.purpose}>{i.purpose}</td>
                      <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                      <td className="px-4 py-3 text-gray-500">{i.payeeName || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${i.status === 'APPROVED' ? 'bg-green-100 text-green-700' : i.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                          {i.status === 'APPROVED' ? `✓ ${i.approvedBy || 'Approved'}` : i.status === 'REJECTED' ? '✕ Rejected' : 'Pending'}
                        </span>
                      </td>
                      {tab === 'pending' && canApprove && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button onClick={() => act(i.id, 'approve')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 mr-1">Approve</button>
                          <button onClick={() => act(i.id, 'reject')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Reject</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {list.length === 0 && (
                    <tr><td colSpan={tab === 'pending' && canApprove ? 9 : 8} className="text-center py-12 text-gray-400">
                      {tab === 'pending' ? 'No pending requests 🎉' : 'No decided requests yet'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
