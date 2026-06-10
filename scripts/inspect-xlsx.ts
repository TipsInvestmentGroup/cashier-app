import * as XLSX from 'xlsx'

const wb = XLSX.readFile('C:/Users/HP/OneDrive/Desktop/CODE/DIRECTORS,ADIMN&STAFF.xlsx')
console.log('SHEETS:', wb.SheetNames)
for (const name of wb.SheetNames) {
  console.log('\n===== SHEET:', name, '=====')
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' })
  rows.slice(49).forEach((r, i) => console.log(i + 49, JSON.stringify(r)))
  console.log('TOTAL ROWS:', rows.length)
}
