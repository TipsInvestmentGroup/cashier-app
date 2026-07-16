// Printed 80mm bill for a POS order, matching the till format in use:
//   CUSTOMER'S BILL / IN-HOUSE BILL
//   TIPS INVESTMENT LTD (COCO BEACH) · TIN · VRN
//   Date / Attendant / Table No / ID … items … TOTAL Tsh
//   "Hii sio risiti halali ya malipo, huu ni mchanganuo" + "Karibu tena!"
// billType CUSTOMER prints CUSTOMER'S BILL; all in-house types (ADMIN,
// DIRECTOR, DJ, TIPS, STAFF) print IN-HOUSE BILL.

export interface BillOrder {
  orderNo: string
  billType: string
  discount: number
  totalAmount: number
  paidAmount: number
  createdAt: string
  table: { number: number; label: string | null } | null
  waiter: { name: string }
  outlet?: { name: string; legalName: string | null; tin: string | null; vrn: string | null } | null
  items: { productName: string; quantity: number; amount: number }[]
  payments?: { amount: number; method: string }[]
}

export const BILL_TYPES = ['CUSTOMER', 'ADMIN', 'DIRECTOR', 'DJ', 'TIPS', 'STAFF'] as const
export const BILL_TYPE_LABELS: Record<string, string> = {
  CUSTOMER: 'Customer', ADMIN: 'Admin (In-house)', DIRECTOR: 'Director (In-house)',
  DJ: 'DJ (In-house)', TIPS: 'Tips (In-house)', STAFF: 'Staff (In-house)',
}

import { formatReceiptAmount, getCurrencyLabel } from '@/lib/utils'

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
const tsh = (n: number) => formatReceiptAmount(n)

export function buildBillHtml(o: BillOrder): string {
  const title = o.billType === 'CUSTOMER' ? "CUSTOMER'S BILL" : 'IN-HOUSE BILL'
  const outletShort = (o.outlet?.name || '').replace(/\s*outlet\s*$/i, '').toUpperCase()
  const company = o.outlet?.legalName ? `${o.outlet.legalName.toUpperCase()}${outletShort ? ` (${outletShort})` : ''}` : outletShort
  const when = new Date(o.createdAt)
  const dateStr = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(when.getSeconds()).padStart(2, '0')}`

  const rows = o.items.map((i) =>
    `<tr><td class="nm">${i.quantity.toFixed(1)} ${esc(i.productName)}</td><td class="amt">${tsh(i.amount)}</td></tr>`
  ).join('')

  const net = o.totalAmount - o.discount
  const balance = net - o.paidAmount
  const extras: string[] = []
  if (o.discount > 0) extras.push(`<tr><td class="nm">Punguzo</td><td class="amt">- ${tsh(o.discount)}</td></tr>`)
  if (o.paidAmount > 0 && balance > 0.5) {
    extras.push(`<tr><td class="nm">Imelipwa</td><td class="amt">${tsh(o.paidAmount)}</td></tr>`)
    extras.push(`<tr><td class="nm"><b>BALANCE</b></td><td class="amt"><b>${tsh(balance)}</b></td></tr>`)
  }

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.orderNo)}</title><style>
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
body { width: 80mm; margin: 0; padding: 4mm; font-family: 'Courier New', monospace; color: #000; font-size: 12px; }
h1 { font-size: 16px; text-align: center; margin: 0 0 1mm; }
.co { text-align: center; font-size: 12px; margin: 0; }
.dash { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
.meta td { padding: 0.3mm 0; vertical-align: top; }
.meta .k { width: 22mm; }
table { width: 100%; border-collapse: collapse; }
.items td { padding: 0.6mm 0; vertical-align: top; }
.nm { padding-right: 2mm; }
.amt { text-align: right; white-space: nowrap; }
.tot td { font-size: 14px; font-weight: bold; padding: 1mm 0; }
.foot { font-size: 11px; margin-top: 2mm; }
.bye { text-align: center; font-weight: bold; font-size: 13px; margin-top: 1mm; }
</style></head><body>
<h1>${title}</h1>
<p class="co">${esc(company)}</p>
${o.outlet?.tin ? `<p class="co">TIN : ${esc(o.outlet.tin)}</p>` : ''}
${o.outlet?.vrn ? `<p class="co">VRN : ${esc(o.outlet.vrn)}</p>` : ''}
<hr class="dash"/>
<table class="meta">
<tr><td class="k">Date</td><td>: ${dateStr}</td></tr>
<tr><td class="k">Attendant</td><td>: ${esc(o.waiter.name)}</td></tr>
<tr><td class="k">Table No</td><td>: ${o.table ? o.table.number : '-'}${o.table?.label ? ` — ${esc(o.table.label)}` : ''}<span style="float:right">ID : ${esc(o.orderNo.replace(/^ORD-/, ''))}</span></td></tr>
</table>
<hr class="dash"/>
<table class="items">${rows}${extras.join('')}</table>
<hr class="dash"/>
<table class="tot"><tr><td>TOTAL ${esc(getCurrencyLabel())}</td><td class="amt">${tsh(net)}</td></tr></table>
<hr class="dash"/>
<p class="foot">Hii sio risiti halali ya malipo, huu ni mchanganuo</p>
<p class="bye">Karibu tena!</p>
</body></html>`
}

/** Print an HTML document through a hidden iframe (works with --kiosk-printing). */
export function printHtml(html: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open(); doc.write(html); doc.close()
  iframe.contentWindow?.focus()
  setTimeout(() => {
    try { iframe.contentWindow?.print() } catch { /* ignore */ }
    setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe) }, 1500)
  }, 300)
}
