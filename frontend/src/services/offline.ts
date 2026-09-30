import type { PendingItem, SavedJourney } from '../types'

let database: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('guardian-core', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('pending', { keyPath: 'id', autoIncrement: true })
      request.result.createObjectStore('session')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => { database = undefined; reject(new Error('Cierra otras pestañas de GUARDIAN para abrir el almacenamiento.')) }
  })
  return database
}

async function operation<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode)
    const request = run(tx.objectStore(store))
    tx.oncomplete = () => resolve(request.result as T)
    tx.onerror = () => reject(tx.error || request.error)
    tx.onabort = () => reject(tx.error || new Error('No se pudo guardar en IndexedDB.'))
  })
}

export const offline = {
  enqueue: (point: PendingItem) => operation<number>('pending', 'readwrite', store => store.add(point)),
  first: () => operation<IDBCursorWithValue | null>('pending', 'readonly', store => store.openCursor()).then(cursor => cursor?.value as PendingItem | undefined),
  remove: (id: number) => operation('pending', 'readwrite', store => store.delete(id)),
  count: () => operation<number>('pending', 'readonly', store => store.count()),
  all: () => operation<PendingItem[]>('pending', 'readonly', store => store.getAll()),
  session: () => operation<SavedJourney | undefined>('session', 'readonly', store => store.get('active')),
  saveSession: (session: SavedJourney) => operation('session', 'readwrite', store => store.put(session, 'active')),
  clearSession: () => operation('session', 'readwrite', store => store.delete('active')),
}
