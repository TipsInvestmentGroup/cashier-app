'use client'
import { useState, useEffect, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useAuth } from '@/contexts/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

interface Shift { id: string; name: string; date: string; openedAt: string; closedAt: string | null }
interface Report {
  shift: Shift
  outlet: string
  summary: { totalOrders: number; grandTotal: number }
  byWaiter: { name: string; orders: number; total: number }[]
  topItems: { name: string; category: string; qty: number; total: number }[]
  paymentBreakdown: Record<string, number>
}

const fmt = (n: number) => `TSh ${n.toLocaleString()}`

function buildPdf(report: Report): File {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const INDIGO = [63, 81, 181] as [number, number, number]
  const W = doc.internal.pageSize.getWidth()

  // Header
  doc.setFillColor(...INDIGO)
  doc.rect(0, 0, W, 28, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16); doc.setFont('helvetica', 'bold')
  doc.text('Tips MyPos — Shift Report', 14, 12)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`${report.outlet} · Shift ${report.shift.name} · ${new Date(report.shift.date).toLocaleDateString('en-TZ')}`, 14, 20)
  doc.text(`Generated: ${new Date().toLocaleString('en-TZ')}`, W - 14, 20, { align: 'right' })

  let y = 36

  // Summary box
  doc.setTextColor(0, 0, 0)
  doc.setFillColor(240, 242, 255)
  doc.roundedRect(14, y, W - 28, 18, 3, 3, 'F')
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text(`Total Orders: ${report.summary.totalOrders}`, 20, y + 7)
  doc.text(`Grand Total: ${fmt(report.summary.grandTotal)}`, 20, y + 14)
  y += 26

  // By waiter
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Sales by Waiter', 14, y); y += 4
  autoTable(doc, {
    startY: y,
    head: [['Waiter', 'Orders', 'Total (TSh)']],
    body: report.byWaiter.map(w => [w.name, w.orders, w.total.toLocaleString()]),
    headStyles: { fillColor: INDIGO, textColor: 255 },
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Top items
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Top Selling Items', 14, y); y += 4
  autoTable(doc, {
    startY: y,
    head: [['Item', 'Category', 'Qty', 'Total (TSh)']],
    body: report.topItems.map(i => [i.name, i.category, i.qty, i.total.toLocaleString()]),
    headStyles: { fillColor: INDIGO, textColor: 255 },
    styles: { fontSize: 9 },
    columnStyles: { 2: { halign: 'center' }, 3: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8

  // Payment breakdown
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('Payment Breakdown', 14, y); y += 4
  autoTable(doc, {
    startY: y,
    head: [['Method', 'Amount (TSh)']],
    body: Object.entries(report.paymentBreakdown).map(([method, amt]) => [method, amt.toLocaleString()]),
    headStyles: { fillColor: INDIGO, textColor: 255 },
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  })

  const blob = doc.output('blob')
  return new File([blob], `tips-shift-${report.outlet.replace(/\s/g, '-')}-${report.shift.name}-${new Date(report.shift.date).toISOString().slice(0, 10)}.pdf`, { type: 'application/pdf' })
}

export default function ShiftReportPage() {
  const { token } = useAuth()
  const [shifts, setShifts] = useState<Shift[]>([])
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadShifts = useCallback(async () => {
    if (!token) return
    const res = await fetch('/api/pos/shifts', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) {
      const data: Shift[] = await res.json()
      setShifts(data)
      if (data.length) setSelectedShiftId(data[0].id)
    }
  }, [token])

  useEffect(() => { loadShifts() }, [loadShifts])

  const loadReport = async () => {
    if (!token || !selectedShiftId) return
    setLoading(true); setReport(null)
    const res = await fetch(`/api/pos/shifts/${selectedShiftId}/report`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setReport(await res.json())
    setLoading(false)
  }

  const shareReport = async () => {
    if (!report) return
    setBusy(true)
    const file = buildPdf(report)
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Shift Report — ${report.shift.name}`, text: `Tips MyPos Shift Report\n${report.outlet} · Shift ${report.shift.name}\nTotal Orders: ${report.summary.totalOrders}\nGrand Total: ${fmt(report.summary.grandTotal)}` })
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
        URL.revokeObjectURL(url)
      }
    }
    setBusy(false)
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-indigo-900">Shift Report</h1>
          <p className="text-sm text-gray-500">Ripoti ya mauzo kwa shift — shareable kwa WhatsApp</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-5">
          <label className="block text-sm font-semibold text-gray-700 mb-2">Chagua Shift</label>
          <div className="flex gap-3">
            <select
              value={selectedShiftId}
              onChange={e => { setSelectedShiftId(e.target.value); setReport(null) }}
              className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
            >
              {shifts.length === 0 && <option value="">Hakuna shifts leo</option>}
              {shifts.map(s => (
                <option key={s.id} value={s.id}>
                  Shift {s.name} — {s.closedAt ? 'Imefungwa' : 'Wazi'} · {new Date(s.openedAt).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' })}
                </option>
              ))}
            </select>
            <button
              onClick={loadReport}
              disabled={!selectedShiftId || loading}
              className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Inapakia...' : 'Onyesha'}
            </button>
          </div>
        </div>

        {report && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="bg-indigo-600 text-white rounded-2xl p-5">
              <div className="text-indigo-200 text-sm mb-1">{report.outlet} · Shift {report.shift.name}</div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <div className="text-indigo-200 text-xs">Maagizo Yaliyofungwa</div>
                  <div className="text-3xl font-bold">{report.summary.totalOrders}</div>
                </div>
                <div>
                  <div className="text-indigo-200 text-xs">Jumla ya Mauzo</div>
                  <div className="text-xl font-bold">{fmt(report.summary.grandTotal)}</div>
                </div>
              </div>
            </div>

            {/* By Waiter */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h3 className="font-bold text-gray-800 mb-3">Mauzo kwa Waiter</h3>
              <div className="space-y-2">
                {report.byWaiter.map((w, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div>
                      <div className="font-medium text-gray-800 text-sm">{w.name}</div>
                      <div className="text-xs text-gray-400">{w.orders} orders</div>
                    </div>
                    <div className="font-bold text-indigo-700">{fmt(w.total)}</div>
                  </div>
                ))}
                {report.byWaiter.length === 0 && <p className="text-gray-400 text-sm text-center py-2">Hakuna mauzo zilizofungwa kwenye shift hii</p>}
              </div>
            </div>

            {/* Top Items */}
            {report.topItems.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <h3 className="font-bold text-gray-800 mb-3">Bidhaa 10 Bora</h3>
                <div className="space-y-2">
                  {report.topItems.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 w-5">{i + 1}.</span>
                        <div>
                          <div className="font-medium text-gray-800">{item.name}</div>
                          <div className="text-xs text-gray-400">{item.qty} vilivyouzwa</div>
                        </div>
                      </div>
                      <div className="font-semibold text-gray-700">{fmt(item.total)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment breakdown */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <h3 className="font-bold text-gray-800 mb-3">Malipo kwa Njia</h3>
              <div className="space-y-2">
                {Object.entries(report.paymentBreakdown).map(([method, amt]) => (
                  <div key={method} className="flex justify-between text-sm">
                    <span className="text-gray-600 font-medium">{method}</span>
                    <span className="font-bold text-gray-800">{fmt(amt)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Share button */}
            <div className="grid grid-cols-2 gap-3 pb-6">
              <button
                onClick={shareReport}
                disabled={busy}
                className="bg-green-600 text-white py-3.5 rounded-xl font-bold hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50"
              >
                {busy ? 'Inatengeneza...' : '📲 Share WhatsApp'}
              </button>
              <button
                onClick={() => { const f = buildPdf(report); const u = URL.createObjectURL(f); const a = document.createElement('a'); a.href=u; a.download=f.name; a.click(); URL.revokeObjectURL(u) }}
                className="bg-indigo-600 text-white py-3.5 rounded-xl font-bold hover:bg-indigo-700 active:scale-95 transition-all"
              >
                📥 Download PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
