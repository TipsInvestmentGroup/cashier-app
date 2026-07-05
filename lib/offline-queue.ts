// Offline-queue engine for MyPOS order-taking (see the plan this was built
// from: limited offline resilience for creating orders / adding items /
// sending orders / marking counter items ready — NOT payments, discounts,
// bill-type changes, or closing an order, which always require a live
// connection).
//
// Design summary:
// - A queued action's `chainKey` is the localOrderId for order-related
//   actions, or the real itemId for MARK_PREPARED (each mark-ready is its
//   own independent chain of length 1 — no dependency chaining needed there
//   since the item already exists server-side).
// - Chains flush independently and concurrently; within one chain, actions
//   process in strict creation order, so a CREATE_ORDER always resolves
//   before any ADD_ITEM/SEND_ORDER that depends on its real order id. This
//   means one stuck/rejected chain (e.g. a table race) never blocks other
//   tables' queued work.
// - A genuine server rejection (not a transient network failure) marks the
//   whole chain "blocked" and stops advancing it — surfaced to the UI, never
//   silently retried forever and never silently dropped.
import {
  type QueueAction, type QueueActionType, type LocalOrder, type LocalOrderItem,
  addQueueAction, getAllQueueActions, getQueueActionsByChain, updateQueueAction, deleteQueueAction,
  putLocalOrder, getLocalOrder, deleteLocalOrder,
} from './offline-db'

export type { LocalOrder, LocalOrderItem }

export class NetworkError extends Error {
  constructor(message = 'Network unreachable') {
    super(message)
    this.name = 'NetworkError'
  }
}

/** Wraps fetch — a thrown error (offline, DNS, timeout) becomes a NetworkError;
 *  a real HTTP response (even non-ok) is returned as-is so callers can tell
 *  "never reached the server" apart from "the server rejected this". */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'fetch failed')
  }
}

// ---- Events ----

export type QueueEvent =
  | { type: 'order-resolved'; localOrderId: string; realOrderId: string; realOrderNo: string }
  | { type: 'chain-blocked'; chainKey: string; error: string }
  | { type: 'auth-expired' }
  | { type: 'queue-changed'; pendingCount: number }

const EVENT_NAME = 'mypos-offline-queue'

function emitEvent(event: QueueEvent) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }))
}

export function onQueueEvent(handler: (event: QueueEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => handler((e as CustomEvent<QueueEvent>).detail)
  window.addEventListener(EVENT_NAME, listener)
  return () => window.removeEventListener(EVENT_NAME, listener)
}

function notifyQueueChanged() {
  getAllQueueActions().then((actions) => emitEvent({ type: 'queue-changed', pendingCount: actions.length })).catch(() => {})
}

// ---- Per-key mutation lock ----
// Guards local-order read-modify-write cycles so an actively-typing waiter
// and the background flush processor never corrupt each other's write.
const locks = new Map<string, Promise<void>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  locks.set(key, prev.then(() => gate))
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

// ---- Local order lifecycle (create/add/remove) ----

export async function createLocalOrder(opts: {
  tableId: string | null; shiftId: string; outletId: string; tableNumber?: number; tableLabel?: string | null
}): Promise<string> {
  const localOrderId = `local-${crypto.randomUUID()}`
  const order: LocalOrder = {
    localOrderId, tableId: opts.tableId, shiftId: opts.shiftId, outletId: opts.outletId,
    tableNumber: opts.tableNumber, tableLabel: opts.tableLabel, items: [], createdAt: Date.now(),
  }
  await putLocalOrder(order)
  const clientRequestId = crypto.randomUUID()
  await addQueueAction({
    chainKey: localOrderId, type: 'CREATE_ORDER',
    payload: { tableId: opts.tableId, shiftId: opts.shiftId, outletId: opts.outletId },
    clientRequestId, createdAt: Date.now(), status: 'pending',
  })
  notifyQueueChanged()
  return localOrderId
}

export async function addLocalItem(orderKey: string, item: {
  productId: string; productName: string; unitPrice: number; quantity: number; amount: number
  extras: string[]; counterCode: string
}): Promise<string> {
  const localItemId = crypto.randomUUID()
  if (orderKey.startsWith('local-')) {
    await withLock(orderKey, async () => {
      const order = await getLocalOrder(orderKey)
      if (!order) return
      order.items.push({ localItemId, ...item })
      await putLocalOrder(order)
    })
  }
  await addQueueAction({
    chainKey: orderKey, type: 'ADD_ITEM',
    payload: { orderId: orderKey, productId: item.productId, quantity: item.quantity, extras: item.extras, counterCode: item.counterCode },
    clientRequestId: localItemId, createdAt: Date.now(), status: 'pending',
  })
  notifyQueueChanged()
  return localItemId
}

/** Removes an item that only ever existed locally (its ADD_ITEM never
 *  synced) — nothing to undo server-side, so this just drops both the local
 *  copy and its queued action outright. No-op if the item already synced
 *  (caller should use the normal DELETE endpoint for that case instead). */
export async function removeLocalItem(orderKey: string, localItemId: string): Promise<void> {
  if (orderKey.startsWith('local-')) {
    await withLock(orderKey, async () => {
      const order = await getLocalOrder(orderKey)
      if (!order) return
      order.items = order.items.filter((i) => i.localItemId !== localItemId)
      await putLocalOrder(order)
    })
  }
  const actions = await getQueueActionsByChain(orderKey)
  const match = actions.find((a) => a.type === 'ADD_ITEM' && a.clientRequestId === localItemId)
  if (match) await deleteQueueAction(match.id)
  notifyQueueChanged()
}

export async function enqueueSendOrder(orderKey: string): Promise<void> {
  await addQueueAction({ chainKey: orderKey, type: 'SEND_ORDER', payload: {}, createdAt: Date.now(), status: 'pending' })
  notifyQueueChanged()
}

export async function enqueueMarkPrepared(itemId: string): Promise<void> {
  await addQueueAction({ chainKey: itemId, type: 'MARK_PREPARED', payload: { itemId }, createdAt: Date.now(), status: 'pending' })
  notifyQueueChanged()
}

/** Drops a local order and everything queued for it — used when a waiter
 *  chooses to abandon a blocked/conflicted order and start over manually. */
export async function discardLocalOrder(localOrderId: string): Promise<void> {
  const actions = await getQueueActionsByChain(localOrderId)
  for (const a of actions) await deleteQueueAction(a.id)
  await deleteLocalOrder(localOrderId)
  notifyQueueChanged()
}

/** Re-arms a blocked chain for another attempt (the "Jaribu tena" button). */
export async function retryChain(chainKey: string, getToken: () => string | null): Promise<void> {
  const actions = await getQueueActionsByChain(chainKey)
  for (const a of actions) if (a.status === 'blocked') await updateQueueAction(a.id, { status: 'pending', error: undefined })
  await flushQueue(getToken)
}

// ---- Read helpers for UI badges ----

export async function getChainState(chainKey: string): Promise<'synced' | 'pending' | 'blocked'> {
  const actions = await getQueueActionsByChain(chainKey)
  if (actions.length === 0) return 'synced'
  if (actions.some((a) => a.status === 'blocked')) return 'blocked'
  return 'pending'
}

export async function getChainError(chainKey: string): Promise<string | undefined> {
  const actions = await getQueueActionsByChain(chainKey)
  return actions.find((a) => a.status === 'blocked')?.error
}

export async function getPendingCount(): Promise<number> {
  const actions = await getAllQueueActions()
  return actions.length
}

// ---- Flush engine ----

let paused = false
let flushing = false

function isBenignAlreadyDone(action: QueueAction, status: number, body: { error?: string }): boolean {
  // Both of these are idempotent no-ops server-side already applied by a
  // previous attempt whose response never reached the client — not a real
  // failure, so drop the queued action silently rather than alarming staff.
  if (action.type === 'SEND_ORDER' && status === 400 && body.error === 'No pending items to send') return true
  if (action.type === 'MARK_PREPARED' && status === 400 && body.error === 'Only sent items can be marked ready') return true
  return false
}

async function resolveOrderId(chainKey: string): Promise<string> {
  if (!chainKey.startsWith('local-')) return chainKey
  const local = await getLocalOrder(chainKey)
  if (local?.realOrderId) return local.realOrderId
  // The CREATE_ORDER for this chain hasn't resolved yet — treat as "still
  // offline" so this action is retried on the next flush pass rather than
  // failing hard (it should never actually happen mid-pass since chains
  // process strictly in order, but guards against any future reordering bug).
  throw new NetworkError('order not yet created')
}

async function performRequest(action: QueueAction, token: string): Promise<Response> {
  switch (action.type) {
    case 'CREATE_ORDER':
      return apiFetch('/api/pos/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...action.payload, clientRequestId: action.clientRequestId }),
      })
    case 'ADD_ITEM': {
      const orderId = await resolveOrderId(action.chainKey)
      const { productId, quantity, extras, counterCode } = action.payload as {
        productId: string; quantity: number; extras: string[]; counterCode: string
      }
      return apiFetch(`/api/pos/orders/${orderId}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, quantity, extras, counterCode, clientRequestId: action.clientRequestId }),
      })
    }
    case 'SEND_ORDER': {
      const orderId = await resolveOrderId(action.chainKey)
      return apiFetch(`/api/pos/orders/${orderId}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    case 'MARK_PREPARED':
      return apiFetch('/api/pos/counter', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: (action.payload as { itemId: string }).itemId }),
      })
  }
}

async function processChain(chainKey: string, actions: QueueAction[], getToken: () => string | null): Promise<void> {
  const sorted = [...actions].sort((a, b) => a.id - b.id)
  for (const action of sorted) {
    const token = getToken()
    if (!token) return

    let res: Response
    try {
      res = await performRequest(action, token)
    } catch (err) {
      if (err instanceof NetworkError) return // still offline (or dependency not ready) — retry next flush
      throw err
    }

    if (res.status === 401) {
      paused = true
      emitEvent({ type: 'auth-expired' })
      return
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }))
      if (isBenignAlreadyDone(action, res.status, body)) {
        await deleteQueueAction(action.id)
        notifyQueueChanged()
        continue
      }
      const message = body.error || `HTTP ${res.status}`
      await updateQueueAction(action.id, { status: 'blocked', error: message })
      emitEvent({ type: 'chain-blocked', chainKey, error: message })
      return
    }

    const data = await res.json().catch(() => null)

    if (action.type === 'CREATE_ORDER') {
      // Verify this is genuinely OUR order, not someone else's pre-existing
      // order for the same table (the server's tableId-has-open-order
      // short-circuit) — a mismatch here is a real conflict, not a benign
      // retry, and must surface to the user rather than silently merging.
      if (action.clientRequestId && data?.clientRequestId && data.clientRequestId !== action.clientRequestId) {
        const message = 'Meza hii tayari ina order nyingine — angalia na uanze upya.'
        await updateQueueAction(action.id, { status: 'blocked', error: message })
        emitEvent({ type: 'chain-blocked', chainKey, error: message })
        return
      }
      const local = await getLocalOrder(chainKey)
      if (local && data) await putLocalOrder({ ...local, realOrderId: data.id, realOrderNo: data.orderNo })
      if (data) emitEvent({ type: 'order-resolved', localOrderId: chainKey, realOrderId: data.id, realOrderNo: data.orderNo })
    }

    await deleteQueueAction(action.id)
    notifyQueueChanged()
  }
}

export async function flushQueue(getToken: () => string | null): Promise<void> {
  if (flushing || paused) return
  flushing = true
  try {
    const actions = await getAllQueueActions()
    const chains = new Map<string, QueueAction[]>()
    for (const a of actions) {
      if (a.status === 'blocked') continue // blocked chains wait for an explicit retry
      if (!chains.has(a.chainKey)) chains.set(a.chainKey, [])
      chains.get(a.chainKey)!.push(a)
    }
    await Promise.all([...chains.entries()].map(([chainKey, chainActions]) => processChain(chainKey, chainActions, getToken)))
  } finally {
    flushing = false
  }
}

export function pauseFlush() {
  paused = true
}

export function resumeFlush(getToken: () => string | null) {
  paused = false
  flushQueue(getToken).catch(() => {})
}

let autoFlushStarted = false

/** Call once (e.g. from AppShell) after a token is available. Idempotent. */
export function startAutoFlush(getToken: () => string | null) {
  if (autoFlushStarted || typeof window === 'undefined') return
  autoFlushStarted = true
  window.addEventListener('online', () => flushQueue(getToken).catch(() => {}))
  setInterval(() => { if (navigator.onLine) flushQueue(getToken).catch(() => {}) }, 15_000)
  flushQueue(getToken).catch(() => {})
}

export type { QueueAction, QueueActionType }
