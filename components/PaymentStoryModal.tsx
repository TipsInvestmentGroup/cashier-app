'use client'
import { useEffect, useState } from 'react'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Story {
  bill: { id: string; date: string; billType: string; personName: string; serviceStaff?: string; amount: number; status: string; description?: string; outlet?: { name: string }; cashier?: { name: string } }
  payments: { id: string; date: string; payerName: string; payerCategory?: string; amountPaid: number; paymentMethod: string; cashier?: { name: string } }[]
  totalPaid: number
  balance: number
}

/** Reusable "payment story" modal for a signed bill: the bill, its payment
 *  timeline with running balance, and the outstanding amount. Pass a billId to
 *  open it; pass null to keep it closed. */
export function PaymentStoryModal({ billId, request, onClose }: {
  billId: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (url: string) => Promise<any>
  onClose: () => void
}) {
  const [story, setStory] = useState<Story | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!billId) { setStory(null); return }
    let active = true
    setLoading(true); setStory(null)
    request(`/api/signed-bills/${billId}/story`)
      .then((res) => { if (active) setStory(res) })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [billId, request])

  if (!billId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-bold text-gray-900">📖 Payment Story</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {loading && <div className="py-10 text-center text-gray-400">Loading…</div>}

          {!loading && story && (
            <div className="space-y-4">
              {/* The signed bill */}
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-indigo-700 uppercase">{story.bill.billType.replace('_', ' ')} bill</span>
                  <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${story.bill.status === 'PAID' ? 'bg-green-100 text-green-700' : story.bill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{story.bill.status}</span>
                </div>
                <p className="text-lg font-bold text-gray-900 mt-1">{story.bill.personName}</p>
                <p className="text-sm text-gray-600">Signed on <strong>{formatDate(story.bill.date)}</strong> · {formatCurrency(story.bill.amount)}</p>
                {story.bill.serviceStaff && <p className="text-xs text-gray-500 mt-1">Served by {story.bill.serviceStaff}{story.bill.outlet?.name ? ` · ${story.bill.outlet.name}` : ''}</p>}
                {story.bill.description && <p className="text-xs text-gray-400 mt-1 italic">{story.bill.description}</p>}
              </div>

              {/* Payment timeline */}
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Payments ({story.payments.length})</p>
                {story.payments.length === 0 ? (
                  <p className="text-sm text-gray-400">No payments recorded yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {(() => { let rem = story.bill.amount; return story.payments.map((pay) => { rem -= pay.amountPaid; return (
                      <li key={pay.id} className="flex items-start gap-3">
                        <span className="mt-1 w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        <div className="flex-1 text-sm">
                          <div className="flex justify-between">
                            <span className="font-medium text-gray-800">{formatDate(pay.date)} — {pay.payerName}</span>
                            <span className="font-bold text-green-700">{formatCurrency(pay.amountPaid)}</span>
                          </div>
                          <p className="text-xs text-gray-500">{pay.paymentMethod}{pay.cashier?.name ? ` · recorded by ${pay.cashier.name}` : ''} · remaining {formatCurrency(Math.max(0, rem))}</p>
                        </div>
                      </li>
                    ) }) })()}
                  </ol>
                )}
              </div>

              {/* Balance summary */}
              <div className={`rounded-xl p-4 flex items-center justify-between ${story.balance <= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <div>
                  <p className={`font-semibold ${story.balance <= 0 ? 'text-green-800' : 'text-red-800'}`}>{story.balance <= 0 ? '✅ Fully settled' : '🔴 Outstanding balance'}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Paid {formatCurrency(story.totalPaid)} of {formatCurrency(story.bill.amount)}</p>
                </div>
                <span className={`text-2xl font-bold ${story.balance <= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.max(0, story.balance))}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
