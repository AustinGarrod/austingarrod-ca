export const ACCOUNT_OBJECT_STORE = 'records'
export interface AccountRepositoryOptions {
  factory?: IDBFactory
  broadcast?: boolean
}
export interface DocumentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void | Promise<void>
}
export interface AccountRepository extends DocumentStorage {
  readonly length: number
  key(index: number): string | null
  removeItem(key: string): void | Promise<void>
  reload(key?: string): Promise<void>
  subscribe(listener: () => void): () => void
  close(): void
}

/** Reads use a hydrated cache. Writes acknowledge only a completed durable IDB
 * transaction and an exact readback; there is no background flush. Callers hold
 * the account Web Lock from reload through each read/modify/write operation. */
export function createAccountRepository(options: AccountRepositoryOptions & { name: string }): AccountRepository {
  let cache = new Map<string, string>(), opening: Promise<IDBDatabase> | undefined, database: IDBDatabase | undefined, channel: BroadcastChannel | undefined
  const listeners = new Set<() => void>(), name = options.name
  function completed(transaction: IDBTransaction) {
    return new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true })
      transaction.addEventListener('abort', () => reject(transaction.error ?? new DOMException('Account storage transaction was aborted. Saved data was kept.', 'AbortError')), { once: true })
      transaction.addEventListener('error', () => { /* The transaction abort supplies its original cause. */ })
    })
  }
  function open() {
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = options.factory ?? globalThis.indexedDB
      if (!factory) { reject(new Error('Account device storage is unavailable. Browser originals and existing export tools remain available.')); return }
      const request = factory.open(name, 1)
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(ACCOUNT_OBJECT_STORE)) request.result.createObjectStore(ACCOUNT_OBJECT_STORE) }
      request.onerror = () => reject(request.error ?? new Error('Account device storage could not be opened.'))
      request.onblocked = () => reject(new Error('Account storage is waiting for another tab. Close older account tabs and retry.'))
      request.onsuccess = () => {
        database = request.result
        database.onversionchange = () => { database?.close(); database = undefined; opening = undefined; listeners.forEach((listener) => listener()) }
        if (options.broadcast !== false && typeof BroadcastChannel !== 'undefined' && !channel) {
          channel = new BroadcastChannel(name)
          channel.onmessage = () => listeners.forEach((listener) => listener())
        }
        resolve(request.result)
      }
    }).catch((error) => { opening = undefined; throw error })
    return opening
  }
  function transaction(db: IDBDatabase, mode: IDBTransactionMode) {
    if (mode === 'readwrite') {
      try { return db.transaction(ACCOUNT_OBJECT_STORE, mode, { durability: 'strict' }) } catch (error) { if (!(error instanceof TypeError)) throw error }
    }
    return db.transaction(ACCOUNT_OBJECT_STORE, mode)
  }
  async function readOne(key: string) {
    const db = await open(), tx = transaction(db, 'readonly'), done = completed(tx), request = tx.objectStore(ACCOUNT_OBJECT_STORE).get(key)
    let value: unknown
    request.onsuccess = () => { value = request.result }
    await done
    if (value !== undefined && typeof value !== 'string') throw new Error('Account device data needs recovery. Existing records were kept.')
    return value === undefined ? null : value as string
  }
  return {
    get length() { return cache.size }, key: (index) => [...cache.keys()][index] ?? null,
    getItem: (key) => cache.get(key) ?? null,
    async setItem(key, value) {
      const db = await open(), tx = transaction(db, 'readwrite'), done = completed(tx)
      try { tx.objectStore(ACCOUNT_OBJECT_STORE).put(value, key) } catch (error) { tx.abort(); await done.catch(() => undefined); throw error }
      await done
      if (await readOne(key) !== value) throw new Error('Account device data could not be verified after saving. Export this visit before closing it.')
      cache.set(key, value); channel?.postMessage('account-record-changed')
    },
    async removeItem(key) {
      const db = await open(), tx = transaction(db, 'readwrite'), done = completed(tx)
      tx.objectStore(ACCOUNT_OBJECT_STORE).delete(key); await done
      if (await readOne(key) !== null) throw new Error('Account storage could not verify this change.')
      cache.delete(key); channel?.postMessage('account-record-changed')
    },
    async reload(key) {
      if (key !== undefined) { const value = await readOne(key); if (value === null) cache.delete(key); else cache.set(key, value); return }
      const db = await open(), tx = transaction(db, 'readonly'), done = completed(tx), store = tx.objectStore(ACCOUNT_OBJECT_STORE), keysRequest = store.getAllKeys(), valuesRequest = store.getAll()
      let keys: IDBValidKey[] = [], values: unknown[] = []
      keysRequest.onsuccess = () => { keys = keysRequest.result }; valuesRequest.onsuccess = () => { values = valuesRequest.result }
      await done
      if (keys.length !== values.length || keys.some((key, index) => typeof key !== 'string' || typeof values[index] !== 'string')) throw new Error('Account device data needs recovery. No records were replaced.')
      cache = new Map(keys.map((key, index) => [key as string, values[index] as string]))
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    close() { database?.close(); database = undefined; opening = undefined; channel?.close(); channel = undefined },
  }
}
