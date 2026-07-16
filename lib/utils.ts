import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import { DEFAULT_COMPANY_CONFIG, formatAmountLabel, type CompanyConfig } from '@/lib/company-config-shared'

/** Round a monetary value to 2 decimals to avoid floating-point drift (e.g. 0.1+0.2). */
export function roundMoney(n: number | string | null | undefined): number {
  const v = Number(n) || 0
  return Math.round(v * 100) / 100
}

// Module-level company config for CLIENT code (formatters, PDF letterheads),
// defaulting to this deployment's live values so every render is correct
// before any fetch completes. CompanyConfigProvider overwrites it once
// /api/company-config loads (a no-op unless an Admin changed the defaults).
// Server code must use lib/company-config.ts getCompanyConfig() instead.
let clientConfig: CompanyConfig = DEFAULT_COMPANY_CONFIG

export function setClientCompanyConfig(c: CompanyConfig) { clientConfig = c }
export function getClientCompanyConfig(): CompanyConfig { return clientConfig }
export function getCurrencyCode() { return clientConfig.currencyCode }
export function getCurrencyLabel() { return clientConfig.currencyLabel }

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(clientConfig.currencyLocale, {
    style: 'currency',
    currency: clientConfig.currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** "TSh 1,234" — the label-prefixed style used in PDFs and target cards. */
export function formatAmount(n: number): string {
  return formatAmountLabel(clientConfig, n)
}

/** "1,234/=" — the amount style used on printed 80mm bills. */
export function formatReceiptAmount(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')}${clientConfig.receiptAmountSuffix}`
}

export function formatDate(date: Date | string): string {
  return format(new Date(date), 'dd MMM yyyy')
}

export function formatDateTime(date: Date | string): string {
  return format(new Date(date), 'dd MMM yyyy HH:mm')
}

export function getTodayRange() {
  const now = new Date()
  return { start: startOfDay(now), end: endOfDay(now) }
}

export function getWeekRange() {
  const now = new Date()
  return { start: startOfWeek(now), end: endOfWeek(now) }
}

export function getMonthRange() {
  const now = new Date()
  return { start: startOfMonth(now), end: endOfMonth(now) }
}

export function generateVoucherNumber(): string {
  const now = new Date()
  const dateStr = format(now, 'yyyyMMdd')
  const rand = Math.floor(Math.random() * 9000) + 1000
  return `VCH-${dateStr}-${rand}`
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export const BILL_TYPE_COLORS: Record<string, string> = {
  ADMIN: 'bg-blue-100 text-blue-800',
  DIRECTOR: 'bg-purple-100 text-purple-800',
  CUSTOMER: 'bg-green-100 text-green-800',
  TIPS: 'bg-yellow-100 text-yellow-800',
  DJ: 'bg-pink-100 text-pink-800',
  STAFF_LOSS: 'bg-red-100 text-red-800',
}

export const BILL_TYPE_LABELS: Record<string, string> = {
  ADMIN: 'Admin Bill',
  DIRECTOR: 'Director Bill',
  CUSTOMER: 'Customer Bill',
  TIPS: 'Tips Bill',
  DJ: 'DJ Bill',
  STAFF_LOSS: 'Staff Loss',
}

export const STATUS_COLORS: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID: 'bg-green-100 text-green-700',
}

// Friendly Swahili label for a POS shift name. Covers the current
// MORNING/EVENING shifts and the legacy KWANZA/PILI/TATU/NNE ones still
// present on historical shift records.
const POS_SHIFT_LABELS: Record<string, string> = {
  MORNING: 'Shift ya Asubuhi',
  EVENING: 'Shift ya Jioni',
  KWANZA: 'Shift ya Kwanza',
  PILI: 'Shift ya Pili',
  TATU: 'Shift ya Tatu',
  NNE: 'Shift ya Nne',
}
export const posShiftLabel = (name: string) => POS_SHIFT_LABELS[name] || `Shift ${name}`
