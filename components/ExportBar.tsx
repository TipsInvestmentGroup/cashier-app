'use client'
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/**
 * Reusable export toolbar: CSV / Excel / PDF (client-side, from `rows`) +
 * Email Directors (POSTs the same rows to /api/email-report).
 */
export function ExportBar({ rows, filename, title, subject }: { rows: Row[]; filename: string; title: string; subject?: string }) {
  const { request } = useApi()
  const [emailing, setEmailing] = useState(false)

  const guard = () => { if (!rows.length) { toast.error('No data to export'); return false } return true }
  const download = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  }

  // Stable, complete column set across heterogeneous rows (union in first-seen
  // order) — not just the first row's keys, which silently drops later columns.
  const columnKeys = () => {
    const set = new Set<string>()
    for (const r of rows) for (const k of Object.keys(r)) set.add(k)
    return [...set]
  }

  // One CSV field: escape embedded quotes (RFC 4180), and neutralise Excel/Sheets
  // formula injection — a text cell starting with = + - @ (or tab/CR) could be
  // executed as a formula, so prefix it with an apostrophe. Numbers are left as-is.
  const csvCell = (v: unknown): string => {
    let s = v == null ? '' : String(v)
    const isNumeric = typeof v === 'number' || (s !== '' && !isNaN(Number(s)))
    if (!isNumeric && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }

  const exportCSV = () => {
    if (!guard()) return
    const keys = columnKeys()
    const csv = [keys.map(csvCell).join(','), ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(','))].join('\r\n')
    // Prepend a UTF-8 BOM so Excel opens accented text/currency correctly.
    download(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`)
    toast.success('CSV exported!')
  }
  const exportExcel = async () => {
    if (!guard()) return
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows, { header: columnKeys() })
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report')
    XLSX.writeFile(wb, `${filename}.xlsx`)
    toast.success('Excel exported!')
  }
  const exportPDF = async () => {
    if (!guard()) return
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const keys = columnKeys()
    const doc = new jsPDF({ orientation: keys.length > 6 ? 'landscape' : 'portrait' })
    doc.setFontSize(14); doc.text(title, 14, 16)
    doc.setFontSize(9); doc.text(new Date().toLocaleString(), 14, 22)
    const fmtCell = (v: unknown) => typeof v === 'number' ? v.toLocaleString('en-US') : String(v ?? '')
    autoTable(doc, { startY: 26, head: [keys], body: rows.map((r) => keys.map((k) => fmtCell(r[k]))), styles: { fontSize: 7 }, headStyles: { fillColor: [79, 70, 229] } })
    doc.save(`${filename}.pdf`)
    toast.success('PDF exported!')
  }
  const emailDirectors = () => {
    if (!guard()) return
    setEmailing(true)
    const id = toast.loading('Emailing directors…')
    request('/api/email-report', { method: 'POST', body: JSON.stringify({ subject: subject || title, title, rows }) })
      .then((res) => {
        if (res.mode === 'ethereal' && res.previewUrl) { toast.success('Test email sent — opening preview…', { id, duration: 5000 }); window.open(res.previewUrl, '_blank') }
        else toast.success(`Emailed to ${res.recipients.length} director(s)`, { id })
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : 'Email failed', { id }))
      .finally(() => setEmailing(false))
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={exportCSV} className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-xl hover:bg-gray-200 transition">📄 CSV</button>
      <button onClick={exportExcel} className="px-3 py-2 bg-green-600 text-white text-sm rounded-xl hover:bg-green-700 transition">📊 Excel</button>
      <button onClick={exportPDF} className="px-3 py-2 bg-red-600 text-white text-sm rounded-xl hover:bg-red-700 transition">📕 PDF</button>
      <button onClick={emailDirectors} disabled={emailing} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 transition disabled:opacity-50">{emailing ? 'Sending…' : '✉️ Email Directors'}</button>
    </div>
  )
}
