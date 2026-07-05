// Minimal hand-rolled IndexedDB wrapper for the offline order-queue (see
// lib/offline-queue.ts). No new dependency — the schema here is small enough
// (two stores, a handful of operations) that a real library would be
// overkill, consistent with this codebase's preference for small in-house
// utilities over pulling in packages for trivial functionality.
//
// IndexedDB (not localStorage) specifically for this data: a queued action
// represents an unbilled sale, and iOS Safari PWAs have documented
// localStorage eviction/reliability issues under storage pressure that
// IndexedDB handles more robustly. Read-only reference caching (products,
// tables, etc.) is a separate, lower-stakes concern — see lib/offline-cache.ts.

const DB_NAME = 'mypos-offline'
const DB_VERSION = 1
const QUEUE_STORE = 'queue'
const LOCAL_ORDERS_STORE = 'localOrders'

export type QueueActionType = 'CREATE_ORDER' | 'ADD_ITEM' | 'SEND_ORDER' | 'MARK_PREPARED'
export type QueueActionStatus = 'pending' | 'blocked'

export interface QueueAction {
  id: number // autoIncrement primary key
  chainKey: string // localOrderId for order actions, itemId for MARK_PREPARED
  type: QueueActionType
  payload: Record<string, unknown>
  clientRequestId?: string
  createdAt: number
  status: QueueActionStatus
  error?: string
}

export interface LocalOrderItem {
  localItemId: string
  productId: string
  productName: string
  unitPrice: number
  quantity: number
  amount: number
  extras: string[]
  counterCode: string
}

export interface LocalOrder {
  localOrderId: string
  tableId: string | null
  shiftId: string
  outletId: string
  tableNumber?: number
  tableLabel?: string | null
  items: LocalOrderItem[]
  createdAt: number
  realOrderId?: string
  realOrderNo?: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('chainKey', 'chainKey')
      }
      if (!db.objectStoreNames.contains(LOCAL_ORDERS_STORE)) {
        db.createObjectStore(LOCAL_ORDERS_STORE, { keyPath: 'localOrderId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ---- Queue store ----

export async function addQueueAction(action: Omit<QueueAction, 'id'>): Promise<number> {
  const db = await openDB()
  const tx = db.transaction(QUEUE_STORE, 'readwrite')
  const id = await promisifyRequest(tx.objectStore(QUEUE_STORE).add(action) as IDBRequest<number>)
  return id
}

export async function getAllQueueActions(): Promise<QueueAction[]> {
  const db = await openDB()
  const tx = db.transaction(QUEUE_STORE, 'readonly')
  return promisifyRequest(tx.objectStore(QUEUE_STORE).getAll() as IDBRequest<QueueAction[]>)
}

export async function getQueueActionsByChain(chainKey: string): Promise<QueueAction[]> {
  const db = await openDB()
  const tx = db.transaction(QUEUE_STORE, 'readonly')
  const index = tx.objectStore(QUEUE_STORE).index('chainKey')
  return promisifyRequest(index.getAll(chainKey) as IDBRequest<QueueAction[]>)
}

export async function updateQueueAction(id: number, patch: Partial<QueueAction>): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(QUEUE_STORE, 'readwrite')
  const store = tx.objectStore(QUEUE_STORE)
  const existing = await promisifyRequest(store.get(id) as IDBRequest<QueueAction | undefined>)
  if (!existing) return
  await promisifyRequest(store.put({ ...existing, ...patch }) as IDBRequest<number>)
}

export async function deleteQueueAction(id: number): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(QUEUE_STORE, 'readwrite')
  await promisifyRequest(tx.objectStore(QUEUE_STORE).delete(id) as IDBRequest<undefined>)
}

// ---- Local orders store ----

export async function putLocalOrder(order: LocalOrder): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(LOCAL_ORDERS_STORE, 'readwrite')
  await promisifyRequest(tx.objectStore(LOCAL_ORDERS_STORE).put(order) as IDBRequest<string>)
}

export async function getLocalOrder(localOrderId: string): Promise<LocalOrder | undefined> {
  const db = await openDB()
  const tx = db.transaction(LOCAL_ORDERS_STORE, 'readonly')
  return promisifyRequest(tx.objectStore(LOCAL_ORDERS_STORE).get(localOrderId) as IDBRequest<LocalOrder | undefined>)
}

export async function deleteLocalOrder(localOrderId: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(LOCAL_ORDERS_STORE, 'readwrite')
  await promisifyRequest(tx.objectStore(LOCAL_ORDERS_STORE).delete(localOrderId) as IDBRequest<undefined>)
}

export async function getAllLocalOrders(): Promise<LocalOrder[]> {
  const db = await openDB()
  const tx = db.transaction(LOCAL_ORDERS_STORE, 'readonly')
  return promisifyRequest(tx.objectStore(LOCAL_ORDERS_STORE).getAll() as IDBRequest<LocalOrder[]>)
}
