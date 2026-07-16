// Bootstrap defaults for the Payment Channels config (/api/payment-channels,
// managed at /payment-channels). Seeded once on first read; every field is
// admin-editable afterward — this is just what a fresh install starts with.
export const DEFAULT_PAYMENT_CHANNELS = [
  { code: 'CASH', label: 'Cash' },
  { code: 'CRDB', label: 'CRDB' },
  { code: 'STANBIC', label: 'Stanbic' },
  { code: 'MPESA', label: 'M-PESA' },
]

export const DEFAULT_PAYMENT_CHANNEL_CODES = DEFAULT_PAYMENT_CHANNELS.map((c) => c.code)
