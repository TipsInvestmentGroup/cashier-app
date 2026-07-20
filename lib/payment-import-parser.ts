// Client-side Excel/CSV parsing for the Payment Verification file-import
// pilot (design doc §12.3 — "Excel Import" adapter). Runs entirely in the
// browser via the xlsx (SheetJS) package already in package.json; the parsed
// rows are POSTed as plain JSON to the existing
// /api/payment-integration-connectors/[id]/import route, which was built to
// accept already-parsed rows — this file is what actually produces them.
// Column names are auto-detected case-insensitively against common bank/
// MoMo statement header synonyms, so most real exports need no manual
// mapping; a row missing a usable Date or Amount is skipped and reported.
import * as XLSX from 'xlsx'

export interface ParsedImportRow {
  date: string // ISO date string
  amount: number
  reference?: string
  customerName?: string
}

export interface ParseResult {
  rows: ParsedImportRow[]
  skipped: { row: number; reason: string }[]
  detectedColumns: { date?: string; amount?: string; reference?: string; customerName?: string }
  totalRows: number
}

const COLUMN_SYNONYMS: Record<'date' | 'amount' | 'reference' | 'customerName', string[]> = {
  date: ['date', 'txn date', 'transaction date', 'value date', 'posting date'],
  amount: ['amount', 'credit', 'value', 'credit amount', 'amount (tzs)', 'amount tzs'],
  reference: ['reference', 'ref', 'ref no', 'reference no', 'txn ref', 'transaction ref', 'transaction id'],
  customerName: ['customer', 'customer name', 'description', 'narration', 'details', 'remarks', 'payer'],
}

function detectColumn(headers: string[], field: keyof typeof COLUMN_SYNONYMS): string | undefined {
  const normalized = headers.map((h) => ({ raw: h, clean: h.trim().toLowerCase() }))
  for (const synonym of COLUMN_SYNONYMS[field]) {
    const match = normalized.find((h) => h.clean === synonym)
    if (match) return match.raw
  }
  // Fall back to substring match (e.g. a header like "Txn Reference No.")
  for (const synonym of COLUMN_SYNONYMS[field]) {
    const match = normalized.find((h) => h.clean.includes(synonym))
    if (match) return match.raw
  }
  return undefined
}

function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/[,\s]/g, '').replace(/^TZS/i, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'string') {
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d.toISOString()
  }
  if (typeof value === 'number') {
    // Excel serial date fallback (rare once cellDates:true is set, kept for safety)
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString()
  }
  return null
}

/** Parses the first sheet of an uploaded .xlsx/.csv File into import rows. */
export async function parsePaymentImportFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer()
  const workbook = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

  if (!raw.length) return { rows: [], skipped: [], detectedColumns: {}, totalRows: 0 }

  const headers = Object.keys(raw[0])
  const dateCol = detectColumn(headers, 'date')
  const amountCol = detectColumn(headers, 'amount')
  const referenceCol = detectColumn(headers, 'reference')
  const customerCol = detectColumn(headers, 'customerName')

  const rows: ParsedImportRow[] = []
  const skipped: ParseResult['skipped'] = []

  raw.forEach((r, i) => {
    const date = dateCol ? parseDate(r[dateCol]) : null
    const amount = amountCol ? parseAmount(r[amountCol]) : null
    if (!date) return skipped.push({ row: i + 2, reason: 'Missing or unreadable date' }) // +2: header row + 1-index
    if (amount == null) return skipped.push({ row: i + 2, reason: 'Missing or unreadable amount' })
    rows.push({
      date,
      amount,
      reference: referenceCol && r[referenceCol] != null ? String(r[referenceCol]) : undefined,
      customerName: customerCol && r[customerCol] != null ? String(r[customerCol]) : undefined,
    })
  })

  return {
    rows,
    skipped,
    detectedColumns: { date: dateCol, amount: amountCol, reference: referenceCol, customerName: customerCol },
    totalRows: raw.length,
  }
}
