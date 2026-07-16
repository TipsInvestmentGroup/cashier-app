'use client'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { MoneyInput } from '@/components/MoneyInput'
import { EXCESS_REASONS } from '@/lib/excess-reasons'
import { getCurrencyCode } from '@/lib/utils'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

type Source = 'CASH_RECON' | 'COLLECTION'
interface Outlet { id: string; name: string }
interface CollectionOpt { id: string; staffName?: string; date: string }

export function AddExcessModal({
  open, onClose, onSaved, outlets, isCashier, defaultOutletId, request,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  outlets: Outlet[]
  isCashier: boolean
  defaultOutletId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (url: string, opts?: any) => Promise<any>
}) {
  const [source, setSource] = useState<Source>('COLLECTION')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState(defaultOutletId)
  const [cashReconId, setCashReconId] = useState<string | null>(null)
  const [cashReconLoading, setCashReconLoading] = useState(false)
  const [collections, setCollections] = useState<CollectionOpt[]>([])
  const [collectionId, setCollectionId] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [staffId, setStaffId] = useState('')
  const [personId, setPersonId] = useState('')
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([])
  const [customerList, setCustomerList] = useState<{ id: string; name: string }[]>([])
  const [reasons, setReasons] = useState<{ value: string; label: string }[]>([...EXCESS_REASONS])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSource('COLLECTION'); setDate(format(new Date(), 'yyyy-MM-dd')); setOutletId(defaultOutletId)
    setCashReconId(null); setCollections([]); setCollectionId('')
    setAmount(''); setReason(''); setStaffId(''); setPersonId('')
    Promise.all([request('/api/staff-list'), request('/api/persons?type=CUSTOMER'), request('/api/excess-reasons')])
      .then(([staff, persons, reasonRows]) => {
        setStaffList(staff || []); setCustomerList(persons || [])
        const active = (reasonRows || []).filter((r: { isActive: boolean }) => r.isActive)
        if (active.length) setReasons(active.map((r: { code: string; label: string }) => ({ value: r.code, label: r.label })))
      })
      .catch(() => {})
  }, [open, defaultOutletId, request])

  useEffect(() => {
    if (!open || !outletId || !date) return
    if (source === 'CASH_RECON') {
      setCashReconLoading(true)
      request(`/api/cash-recon?date=${date}&outletId=${outletId}`)
        .then((res) => setCashReconId(res.existing?.id || null))
        .catch(() => setCashReconId(null))
        .finally(() => setCashReconLoading(false))
    } else {
      request(`/api/collections?outletId=${outletId}&startDate=${date}&endDate=${date}`)
        .then((res) => { setCollections(res || []); setCollectionId('') })
        .catch(() => setCollections([]))
    }
  }, [open, source, outletId, date, request])

  const parentId = source === 'CASH_RECON' ? cashReconId : (collectionId || null)

  const save = async () => {
    if (!parentId) return toast.error('Select the day/collection to attach this excess to')
    if (!amount || Number(amount) <= 0) return toast.error('Enter an amount greater than zero')
    if (!reason) return toast.error('Select a reason')
    if (reason === 'STAFF_TIP' && !staffId) return toast.error('Select the staff name')
    if (reason === 'CUSTOMER_EXCESS' && !personId) return toast.error('Select the customer name')
    setSaving(true)
    try {
      await request('/api/excess-recon/add', {
        method: 'POST',
        body: JSON.stringify({
          source, parentId, amount: Number(amount), reason,
          ...(reason === 'STAFF_TIP' ? { staffId } : {}),
          ...(reason === 'CUSTOMER_EXCESS' ? { personId } : {}),
        }),
      })
      toast.success('Excess record added')
      onSaved()
      onClose()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error adding excess record')
    } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Excess Record">
      <div className="space-y-3">
        <div className="flex gap-2 bg-gray-100 rounded-xl p-1">
          {(['COLLECTION', 'CASH_RECON'] as Source[]).map((s) => (
            <button key={s} type="button" onClick={() => setSource(s)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${source === s ? 'bg-white shadow text-indigo-700' : 'text-gray-500'}`}>
              {s === 'COLLECTION' ? 'Collection' : 'Cash Recon'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          {!isCashier && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">Select outlet…</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
        </div>

        {source === 'CASH_RECON' ? (
          <div className="text-sm">
            {cashReconLoading ? (
              <p className="text-gray-400">Checking…</p>
            ) : cashReconId ? (
              <p className="text-green-700 font-semibold">✓ Cash reconciliation found for this day/outlet</p>
            ) : (
              <p className="text-amber-700">No cash reconciliation exists yet for this day/outlet — record it first from Daily Collections.</p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Collection (staff)</label>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}
              className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">{collections.length === 0 ? 'No collections for this day/outlet' : 'Select a collection…'}</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.staffName || '(no staff)'}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Amount ({getCurrencyCode()})</label>
          <MoneyInput value={amount} onChange={setAmount}
            className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none font-bold" placeholder="0" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Reason</label>
          <select value={reason} onChange={(e) => { setReason(e.target.value); setStaffId(''); setPersonId('') }}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">Select a reason…</option>
            {reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        {reason === 'STAFF_TIP' && (
          <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">Select staff…</option>
            {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {reason === 'CUSTOMER_EXCESS' && (
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}
            className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
            <option value="">Select customer…</option>
            {customerList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving || !parentId} className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-60">
            {saving ? 'Saving…' : 'Add Excess'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
