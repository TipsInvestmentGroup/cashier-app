'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import { MoneyInput } from '@/components/MoneyInput'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

interface PettyCash {
  id: string; date: string; requestedBy: string; department?: string; functionName?: string; purpose: string
  amount: number; paymentMethod: string; payeeName?: string; payeeAccount?: string
  approvedBy?: string; status: string
}
interface Person { id: string; name: string; type: string }
interface NamedItem { id: string; name: string; isActive: boolean }
interface Approver { name: string; email: string }

// Persons eligible as requester / payee on a cash request (internal people only).
const PERSON_EXCLUDE = ['CUSTOMER', 'STAFF_LOSS', 'TIPS', 'DJ']

interface Channel { code: string; label: string; isActive: boolean }

const INIT = {
  date: format(new Date(), 'yyyy-MM-dd'), requestedBy: '', department: '', functionName: '', purpose: '',
  amount: '', paymentMethod: 'CASH', payeeName: '', payeeAccount: '', approvedBy: '',
}

export default function PettyCashPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<PettyCash[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState({ ...INIT })
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [persons, setPersons] = useState<Person[]>([])
  const [departments, setDepartments] = useState<NamedItem[]>([])
  const [functions, setFunctions] = useState<NamedItem[]>([])
  const [approvers, setApprovers] = useState<Approver[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const METHODS = channels.filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.label }))
  // Cash reconciliation modal
  const [reconOpen, setReconOpen] = useState(false)
  const [reconForm, setReconForm] = useState({ date: format(new Date(), 'yyyy-MM-dd'), outletId: '', cashDeposited: '', notes: '', verifiedAmount: '' })
  const [reconComputed, setReconComputed] = useState<{ cashCollected: number; paidBillsCash: number; cashExpenses: number } | null>(null)
  const [autoOpening, setAutoOpening] = useState(0)
  const [reconCanVerify, setReconCanVerify] = useState(false)
  const [reconBusy, setReconBusy] = useState(false)
  // Owner: manage the extra verifier
  const ownerEmail = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const isOwner = !!ownerEmail && (user?.email || '').toLowerCase() === ownerEmail
  const [verifierEmail, setVerifierEmail] = useState('')
  const [verifierUsers, setVerifierUsers] = useState<{ id: string; name: string; email: string }[]>([])

  const [canApprove, setCanApprove] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [its, outs, ppl, depts, fns, access, chs] = await Promise.all([
        request('/api/petty-cash'), request('/api/outlets'), request('/api/persons'),
        request('/api/departments'), request('/api/functions'), request('/api/petty-access'),
        request('/api/payment-channels'),
      ])
      setItems(its); setOutlets(outs || [])
      setChannels(chs || [])
      setPersons((ppl || []).filter((p: Person) => !PERSON_EXCLUDE.includes(p.type)))
      setDepartments((depts || []).filter((d: NamedItem) => d.isActive))
      setFunctions((fns || []).filter((f: NamedItem) => f.isActive))
      setApprovers(access?.approvers || [])
      setCanApprove(!!access?.canApprove)
      setCanRequest(!!access?.canRequest)
    } finally { setLoading(false) }
  }, [request])

  const loadRecon = useCallback(async (date: string, outletId: string) => {
    const params = new URLSearchParams({ date }); if (outletId) params.set('outletId', outletId)
    const res = await request(`/api/cash-recon?${params}`)
    setReconComputed(res.computed)
    setAutoOpening(res.autoOpening || 0)
    setReconCanVerify(!!res.canVerify)
    setReconForm((f) => ({
      ...f,
      cashDeposited: res.existing ? String(res.existing.cashDeposited) : f.cashDeposited,
      notes: res.existing?.notes || f.notes,
      verifiedAmount: res.existing?.verifiedAmount != null ? String(res.existing.verifiedAmount) : f.verifiedAmount,
    }))
  }, [request])

  const openRecon = () => {
    setReconForm({ date: format(new Date(), 'yyyy-MM-dd'), outletId: '', cashDeposited: '', notes: '', verifiedAmount: '' })
    setReconComputed(null); setAutoOpening(0); setReconOpen(true); loadRecon(format(new Date(), 'yyyy-MM-dd'), '')
    if (isOwner) {
      request('/api/cash-verifiers').then((r) => setVerifierEmail((r?.verifierEmail || '').toLowerCase())).catch(() => {})
      request('/api/users').then((u) => setVerifierUsers(u || [])).catch(() => {})
    }
  }

  const saveVerifier = async (email: string) => {
    try { await request('/api/cash-verifiers', { method: 'PUT', body: JSON.stringify({ email }) }); setVerifierEmail(email.toLowerCase()); toast.success('Verifier access updated') }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error updating access') }
  }

  const saveRecon = async () => {
    if (reconForm.cashDeposited === '') return toast.error('Cash Deposited to Bank is required')
    if (reconCanVerify && reconForm.verifiedAmount === '') return toast.error('Cash Verified amount is required (officer)')
    setReconBusy(true)
    try {
      await request('/api/cash-recon', { method: 'POST', body: JSON.stringify({
        date: reconForm.date, outletId: reconForm.outletId, notes: reconForm.notes,
        cashDeposited: Number(reconForm.cashDeposited) || 0,
        ...(reconCanVerify && reconForm.verifiedAmount !== '' ? { verifiedAmount: Number(reconForm.verifiedAmount) || 0 } : {}),
      }) })
      toast.success('Cash reconciliation saved!')
      setReconOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving reconciliation')
    } finally { setReconBusy(false) }
  }

  // Digital payment reconciliation modal (per channel)
  const [bankOpen, setBankOpen] = useState(false)
  const [bankDate, setBankDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [bankOutletId, setBankOutletId] = useState('')
  const [bankRows, setBankRows] = useState<{ code: string; label: string; reported: number }[]>([])
  const [bankEntries, setBankEntries] = useState<Record<string, { opening: string; closing: string; verified: string; verifiedOpening: string; verifiedClosing: string; reason: string }>>({})
  const [bankCanVerify, setBankCanVerify] = useState(false)
  const [bankBusy, setBankBusy] = useState(false)

  const loadBank = useCallback(async (date: string, outletId: string) => {
    const params = new URLSearchParams({ date }); if (outletId) params.set('outletId', outletId)
    const res = await request(`/api/bank-recon?${params}`)
    const rows = res.rows || []
    setBankRows(rows.map((r: { code: string; label: string; reported: number }) => ({ code: r.code, label: r.label, reported: r.reported })))
    setBankCanVerify(!!res.canVerify)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: Record<string, any> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of rows as any[]) entries[r.code] = {
      opening: r.openingBalance != null ? String(r.openingBalance) : '',
      closing: r.closingBalance != null ? String(r.closingBalance) : '',
      verified: r.verifiedAmount != null ? String(r.verifiedAmount) : '',
      verifiedOpening: r.verifiedOpening != null ? String(r.verifiedOpening) : '',
      verifiedClosing: r.verifiedClosing != null ? String(r.verifiedClosing) : '',
      reason: r.reason || '',
    }
    setBankEntries(entries)
  }, [request])

  const openBank = () => {
    setBankDate(format(new Date(), 'yyyy-MM-dd')); setBankOutletId(''); setBankRows([]); setBankEntries({}); setBankOpen(true); loadBank(format(new Date(), 'yyyy-MM-dd'), '')
    if (isOwner) {
      request('/api/cash-verifiers').then((r) => setVerifierEmail((r?.verifierEmail || '').toLowerCase())).catch(() => {})
      request('/api/users').then((u) => setVerifierUsers(u || [])).catch(() => {})
    }
  }

  const saveBank = async () => {
    // Every channel must have its required fields: cashier → opening & closing; officer → verified opening & closing.
    const missing = bankRows.filter((r) => {
      const e = bankEntries[r.code] || {}
      return bankCanVerify
        ? ((e.verifiedOpening ?? '') === '' || (e.verifiedClosing ?? '') === '')
        : ((e.opening ?? '') === '' || (e.closing ?? '') === '')
    }).map((r) => r.label)
    if (missing.length) {
      return toast.error(`Fill ${bankCanVerify ? 'Verified Opening & Closing' : 'Opening & Closing'} for: ${missing.join(', ')}`)
    }
    setBankBusy(true)
    try {
      const channels = bankRows.map((r) => {
        const e = bankEntries[r.code] || {}
        return {
          channel: r.code,
          openingBalance: e.opening ?? '',
          closingBalance: e.closing ?? '',
          reason: e.reason || '',
          ...(bankCanVerify ? { verifiedOpening: e.verifiedOpening ?? '', verifiedClosing: e.verifiedClosing ?? '' } : {}),
        }
      })
      await request('/api/bank-recon', { method: 'POST', body: JSON.stringify({ date: bankDate, outletId: bankOutletId, channels }) })
      toast.success('Digital payment reconciliation saved!')
      setBankOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving reconciliation')
    } finally { setBankBusy(false) }
  }

  useEffect(() => { load() }, [load])

  const [canRequest, setCanRequest] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.requestedBy) return toast.error('Requested by is required')
    if (!form.purpose) return toast.error('Purpose is required')
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Amount must be > 0')
    setSubmitting(true)
    try {
      await request('/api/petty-cash', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) })
      toast.success('Cash request submitted!')
      setForm({ ...INIT })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error submitting request')
    } finally {
      setSubmitting(false)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = items.filter((i) => {
    if (!inRange(i.date, range, customFrom, customTo)) return false
    if (statusFilter && i.status !== statusFilter) return false
    if (q && !`${i.requestedBy} ${i.purpose} ${i.department || ''} ${i.payeeName || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const total = filtered.reduce((s, i) => s + i.amount, 0)

  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      await request(`/api/petty-cash/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      toast.success(action === 'approve' ? 'Request approved' : 'Request rejected')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating request')
    }
  }

  const exportRows = () => filtered.map((i) => ({
    Date: formatDate(i.date), 'Requested By': i.requestedBy, Department: i.department || '', Function: i.functionName || '',
    Purpose: i.purpose, Amount: i.amount, 'Payment Method': i.paymentMethod,
    Payee: i.payeeName || '', 'Payee Account': i.payeeAccount || '', Status: i.status, 'Approved By': i.approvedBy || '',
  }))
  const fileBase = `petty-cash-${format(new Date(), 'yyyy-MM-dd')}`

  const exportCSV = () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const keys = Object.keys(rows[0])
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${(r as Record<string, unknown>)[k] ?? ''}"`).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported!')
  }
  const exportExcel = async () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Petty Cash')
    XLSX.writeFile(wb, `${fileBase}.xlsx`)
    toast.success('Excel exported!')
  }
  const exportPDF = async () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const keys = Object.keys(rows[0])
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14); doc.text('Petty Cash Requests', 14, 16)
    doc.setFontSize(9); doc.text(`Total: ${formatCurrency(total)}`, 14, 22)
    autoTable(doc, { startY: 26, head: [keys], body: rows.map((r) => keys.map((k) => String((r as Record<string, unknown>)[k] ?? ''))), styles: { fontSize: 7 }, headStyles: { fillColor: [79, 70, 229] } })
    doc.save(`${fileBase}.pdf`)
    toast.success('PDF exported!')
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Petty Cash Expenses</h1>
            <p className="text-gray-500 text-sm">Record and track cash requests</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={openRecon}
              className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition shadow">
              💰 Cash Reconciliation
            </button>
            <button onClick={openBank}
              className="px-5 py-3 bg-sky-600 text-white rounded-xl font-medium hover:bg-sky-700 transition shadow">
              📲 Digital Payment Reconciliation
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* LEFT: list */}
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                <p className="text-indigo-100 text-xs">Total Requested</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
                <p className="text-indigo-200 text-xs mt-1">{filtered.length} requests</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">⏳ Pending</p>
                <p className="text-lg font-bold mt-1 text-orange-600">{filtered.filter((i) => i.status !== 'APPROVED').length}</p>
              </div>
            </div>

            <SearchBox value={search} onChange={setSearch} placeholder="Search by requester, purpose, department or payee…" />

            <DateRangeFilter range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-600 mr-1">Status:</span>
              {[['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([s, label]) => {
                const count = s ? items.filter((i) => i.status === s && inRange(i.date, range, customFrom, customTo)).length : null
                return (
                  <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition ${statusFilter === s ? (s === 'APPROVED' ? 'bg-green-600 text-white' : s === 'REJECTED' ? 'bg-red-600 text-white' : s === 'PENDING' ? 'bg-orange-500 text-white' : 'bg-indigo-600 text-white') + ' shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                    {label}{count != null ? ` (${count})` : ''}
                  </button>
                )
              })}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-800">Cash Requests <span className="text-gray-400 font-normal text-sm">· {RANGE_OPTIONS.find((r) => r.key === range)?.label}</span></h2>
                <div className="flex gap-2">
                  <button onClick={exportCSV} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition">📄 CSV</button>
                  <button onClick={exportExcel} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition">📊 Excel</button>
                  <button onClick={exportPDF} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition">📕 PDF</button>
                </div>
              </div>
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
                        <th className="px-4 py-3 font-semibold">Method</th>
                        <th className="px-4 py-3 font-semibold">Payee</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        {canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.date)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{i.requestedBy}</td>
                          <td className="px-4 py-3 text-gray-500">{i.department || '-'}</td>
                          <td className="px-4 py-3 text-gray-500">{i.functionName || '-'}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={i.purpose}>{i.purpose}</td>
                          <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-3 text-gray-500">{i.paymentMethod}</td>
                          <td className="px-4 py-3 text-gray-500">{i.payeeName || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${i.status === 'APPROVED' ? 'bg-green-100 text-green-700' : i.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                              {i.status === 'APPROVED' ? `✓ ${i.approvedBy || 'Approved'}` : i.status === 'REJECTED' ? `✕ Rejected` : 'Pending'}
                            </span>
                          </td>
                          {canApprove && (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {i.status === 'PENDING' ? (
                                <>
                                  <button onClick={() => act(i.id, 'approve')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 mr-1">Approve</button>
                                  <button onClick={() => act(i.id, 'reject')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Reject</button>
                                </>
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                          )}
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={canApprove ? 10 : 9} className="text-center py-12 text-gray-400">No cash requests in this period</td></tr>
                      )}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                        <tr>
                          <td className="px-4 py-3" colSpan={5}>TOTAL ({filtered.length})</td>
                          <td className="px-4 py-3 text-indigo-700">{formatCurrency(total)}</td>
                          <td className="px-4 py-3" colSpan={canApprove ? 4 : 3}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Cash Request Form */}
          {canRequest && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:sticky lg:top-4">
                <h2 className="text-lg font-bold text-gray-800 mb-1">🧾 Cash Request Form</h2>
                <p className="text-xs text-gray-400 mb-4">Fill all required fields</p>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Requested By *</label>
                    <select value={form.requestedBy} onChange={(e) => setForm({ ...form, requestedBy: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white" required>
                      <option value="">Select person…</option>
                      {persons.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Department</label>
                    <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">Select department…</option>
                      {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Function</label>
                    <select value={form.functionName} onChange={(e) => setForm({ ...form, functionName: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">Select function…</option>
                      {functions.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose of Request *</label>
                    <textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} placeholder="What is the cash for?" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Amount Requested (TZS) *</label>
                    <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      {METHODS.map((m) => (
                        <button key={m.value} type="button" onClick={() => setForm({ ...form, paymentMethod: m.value })}
                          className={`py-2 rounded-xl text-sm font-medium transition ${form.paymentMethod === m.value ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Payee Name <span className="text-gray-400 font-normal">(if applicable)</span></label>
                    <select value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">Select payee…</option>
                      {persons.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Payee Account <span className="text-gray-400 font-normal">(if applicable)</span></label>
                    <input type="text" value={form.payeeAccount} onChange={(e) => setForm({ ...form, payeeAccount: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Account / phone number" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Approved By <span className="text-gray-400 font-normal">(leave blank if pending)</span></label>
                    <select value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">Pending approval</option>
                      {approvers.map((a) => <option key={a.email} value={a.name}>{a.name}</option>)}
                    </select>
                  </div>
                  <button type="submit" disabled={submitting}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                    {submitting ? 'Submitting…' : 'Submit Cash Request'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cash Reconciliation modal */}
      {reconOpen && (() => {
        const c = reconComputed || { cashCollected: 0, paidBillsCash: 0, cashExpenses: 0 }
        const opening = autoOpening
        const deposited = Number(reconForm.cashDeposited) || 0
        const closing = opening + c.cashCollected + c.paidBillsCash - c.cashExpenses - deposited
        const verified = reconForm.verifiedAmount !== '' ? Number(reconForm.verifiedAmount) || 0 : null
        const vVar = verified != null ? verified - closing : null // + = excess cash, − = shortage
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setReconOpen(false)}>
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">💰 Cash Reconciliation</h3>
                <button onClick={() => setReconOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input type="date" value={reconForm.date} onChange={(e) => { setReconForm({ ...reconForm, date: e.target.value }); loadRecon(e.target.value, reconForm.outletId) }}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                    <select value={reconForm.outletId} onChange={(e) => { setReconForm({ ...reconForm, outletId: e.target.value }); loadRecon(reconForm.date, e.target.value) }}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">All Outlets</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Computed cash figures */}
                <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">💵 Cash collected from staff</span><span className="font-semibold">{formatCurrency(c.cashCollected)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">✅ Paid bills (cash)</span><span className="font-semibold">{formatCurrency(c.paidBillsCash)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">🧾 Cash expenses (requests)</span><span className="font-semibold text-red-600">−{formatCurrency(c.cashExpenses)}</span></div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Opening Cash Balance (TZS)</label>
                  <div className="w-full px-3 py-2.5 border-2 border-gray-100 rounded-xl bg-gray-50 flex items-center justify-between">
                    <span className="text-lg font-semibold text-gray-700">{formatCurrency(opening)}</span>
                    <span className="text-[11px] text-gray-400">auto · yesterday&apos;s closing</span>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Deposited to Bank (TZS) *</label>
                  <MoneyInput value={reconForm.cashDeposited} onChange={(v) => setReconForm({ ...reconForm, cashDeposited: v })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
                </div>

                <div className="bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
                  <span className="font-semibold text-indigo-800">Closing Cash Balance</span>
                  <span className={`text-xl font-bold ${closing < 0 ? 'text-red-700' : 'text-indigo-700'}`}>{formatCurrency(closing)}</span>
                </div>
                <p className="text-xs text-gray-400">Closing = Opening + Collected + Paid-cash − Expenses − Deposited</p>

                {/* Cash verified by officer */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Cash Verified (TZS) {reconCanVerify ? '*' : <span className="text-gray-400 font-normal">— officers only</span>}
                  </label>
                  {reconCanVerify ? (
                    <MoneyInput value={reconForm.verifiedAmount} onChange={(v) => setReconForm({ ...reconForm, verifiedAmount: v })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Physical cash counted" />
                  ) : (
                    <div className="w-full px-3 py-2.5 border-2 border-gray-100 rounded-xl bg-gray-50 text-gray-500">
                      {verified != null ? formatCurrency(verified) : 'Not yet verified'}
                    </div>
                  )}
                </div>
                {vVar != null && (
                  <div className={`rounded-xl p-3 flex items-center justify-between ${vVar === 0 ? 'bg-gray-50' : vVar > 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <span className={`font-semibold ${vVar === 0 ? 'text-gray-700' : vVar > 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {vVar === 0 ? '✅ Verified matches closing' : vVar > 0 ? '🔺 Excess cash' : '🔻 Cash shortage'}
                    </span>
                    <span className={`text-lg font-bold ${vVar === 0 ? 'text-gray-700' : vVar > 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(vVar))}</span>
                  </div>
                )}

                {isOwner && (
                  <div className="border-t border-gray-100 pt-3">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">🔐 Extra verifier (owner picks)</label>
                    <select value={verifierEmail} onChange={(e) => saveVerifier(e.target.value)}
                      className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">— None —</option>
                      {verifierUsers
                        .filter((u) => !['shabinam@tips.co.tz', 'siyer.mkama@tips.co.tz', ownerEmail].includes(u.email.toLowerCase()))
                        .map((u) => <option key={u.id} value={u.email}>{u.name} ({u.email})</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">Always allowed: owner, shabinam@tips.co.tz, siyer.mkama@tips.co.tz.</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={reconForm.notes} onChange={(e) => setReconForm({ ...reconForm, notes: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} placeholder="Any notes…" />
                </div>

                <button onClick={saveRecon} disabled={reconBusy}
                  className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-60">
                  {reconBusy ? 'Saving…' : 'Save Reconciliation'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Digital Payment Reconciliation modal (per channel) */}
      {bankOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setBankOpen(false)}>
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="font-bold text-gray-900">📲 Digital Payment Reconciliation</h3>
              <button onClick={() => setBankOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <input type="date" value={bankDate} onChange={(e) => { setBankDate(e.target.value); loadBank(e.target.value, bankOutletId) }}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                  <select value={bankOutletId} onChange={(e) => { setBankOutletId(e.target.value); loadBank(bankDate, e.target.value) }}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                    <option value="">All Outlets</option>
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-400">Each digital channel is reconciled separately. {bankCanVerify
                ? <>You are an <strong>officer</strong>: enter the verified figures independently. The cashier&apos;s opening/closing are locked and hidden.</>
                : <><strong>Required</strong> = Closing − Opening (you fill these). <strong>Reported</strong> is auto from collections + paid bills. Variance = Reported − Required.</>}</p>

              {/* Per-channel cards */}
              <div className="space-y-3">
                {bankRows.length === 0 && <p className="text-sm text-gray-400 py-2">No digital channels configured.</p>}
                {bankRows.map((r) => {
                  const e = bankEntries[r.code] || { opening: '', closing: '', verified: '', verifiedOpening: '', verifiedClosing: '', reason: '' }
                  const upd = (patch: Partial<typeof e>) => setBankEntries((m) => ({ ...m, [r.code]: { ...e, ...patch } }))
                  const hasReq = e.opening !== '' || e.closing !== ''
                  const required = (Number(e.closing) || 0) - (Number(e.opening) || 0)
                  const variance = hasReq ? r.reported - required : null // + over, − short
                  return (
                    <div key={r.code} className="border border-gray-100 rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-gray-800">{r.label}</span>
                        <span className="text-xs text-gray-500">Reported (system): <strong className="text-gray-700">{formatCurrency(r.reported)}</strong></span>
                      </div>
                      {/* Cashier side — only visible to non-verifiers. Once it reaches an
                          officer, these figures are frozen and hidden for independent verification. */}
                      {!bankCanVerify && (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Opening balance *</label>
                              <MoneyInput value={e.opening} onChange={(v) => upd({ opening: v })} className="w-full px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Closing balance *</label>
                              <MoneyInput value={e.closing} onChange={(v) => upd({ closing: v })} className="w-full px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" />
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                            <span className="text-gray-600">Required to collect <span className="text-[11px] text-gray-400">(Closing − Opening)</span></span>
                            <span className="font-semibold text-gray-800">{hasReq ? formatCurrency(required) : '—'}</span>
                          </div>
                          {variance != null && (
                            <div className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${variance === 0 ? 'bg-green-50' : variance > 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                              <span className={`font-semibold ${variance === 0 ? 'text-green-800' : variance > 0 ? 'text-amber-800' : 'text-red-800'}`}>
                                {variance === 0 ? '✅ Reported matches required' : variance > 0 ? '🔺 You have an Excess of' : '🔻 You have a Loss of'}
                              </span>
                              <span className={`font-bold ${variance === 0 ? 'text-green-700' : variance > 0 ? 'text-amber-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(variance))}</span>
                            </div>
                          )}
                        </>
                      )}
                      {/* Officer verification — independent: no sight of the cashier's opening/closing */}
                      {bankCanVerify ? (
                        <div className="border-t border-gray-100 pt-2">
                          <p className="text-[11px] font-semibold text-indigo-600 mb-1">🔎 Officer verification — enter the actual figures independently</p>
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-indigo-600 mb-0.5">Verified opening *</label>
                              <MoneyInput value={e.verifiedOpening} onChange={(v) => upd({ verifiedOpening: v })} className="w-full px-2 py-1.5 border-2 border-indigo-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-indigo-600 mb-0.5">Verified closing *</label>
                              <MoneyInput value={e.verifiedClosing} onChange={(v) => upd({ verifiedClosing: v })} className="w-full px-2 py-1.5 border-2 border-indigo-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-indigo-600 mb-0.5">Verified amount <span className="text-gray-400 font-normal">(auto)</span></label>
                              <div className="w-full px-2 py-1.5 border-2 border-gray-100 rounded-lg text-sm bg-gray-50 font-semibold text-gray-700">{formatCurrency((Number(e.verifiedClosing) || 0) - (Number(e.verifiedOpening) || 0))}</div>
                            </div>
                          </div>
                          {(e.verifiedOpening !== '' || e.verifiedClosing !== '') && (() => {
                            const vAmt = (Number(e.verifiedClosing) || 0) - (Number(e.verifiedOpening) || 0)
                            const vVar = vAmt - r.reported // verified vs system reported
                            return (
                              <div className={`mt-2 flex items-center justify-between text-sm rounded-lg px-3 py-2 ${vVar === 0 ? 'bg-green-50' : vVar > 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                                <span className={`font-semibold ${vVar === 0 ? 'text-green-800' : vVar > 0 ? 'text-amber-800' : 'text-red-800'}`}>
                                  {vVar === 0 ? '✅ Verified matches reported' : vVar > 0 ? '🔺 Verified Excess of' : '🔻 Verified Loss of'}
                                </span>
                                <span className={`font-bold ${vVar === 0 ? 'text-green-700' : vVar > 0 ? 'text-amber-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(vVar))}</span>
                              </div>
                            )
                          })()}
                          <p className="text-[10px] text-gray-400 mt-1">Verified amount = Verified Closing − Verified Opening. Variance compares it to the system-reported amount. The cashier&apos;s figures are locked and not shown here.</p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-2">Verified figures: officer-only.</p>
                      )}
                      {((bankCanVerify) || (variance != null && variance !== 0)) && (
                        <input value={e.reason} onChange={(ev) => upd({ reason: ev.target.value })} placeholder="Reason for variance…"
                          className="w-full px-2 py-1.5 border-2 border-gray-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                      )}
                    </div>
                  )
                })}
              </div>

              {isOwner && (
                <div className="border-t border-gray-100 pt-3">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">🔐 Extra verifier (owner picks)</label>
                  <select value={verifierEmail} onChange={(e) => saveVerifier(e.target.value)}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                    <option value="">— None —</option>
                    {verifierUsers
                      .filter((u) => !['shabinam@tips.co.tz', 'siyer.mkama@tips.co.tz', ownerEmail].includes(u.email.toLowerCase()))
                      .map((u) => <option key={u.id} value={u.email}>{u.name} ({u.email})</option>)}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">Same officers as cash verification: owner, shabinam@tips.co.tz, siyer.mkama@tips.co.tz.</p>
                </div>
              )}

              <button onClick={saveBank} disabled={bankBusy}
                className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl hover:bg-sky-700 transition disabled:opacity-60">
                {bankBusy ? 'Saving…' : 'Save Digital Payment Reconciliation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
