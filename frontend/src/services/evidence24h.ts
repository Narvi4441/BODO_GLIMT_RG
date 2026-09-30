import type { EvidenceSnapshot, SavedEvidence } from '../types'

const storeName = 'saved_routes'
const retention = 24 * 60 * 60 * 1000
let database: Promise<IDBDatabase> | undefined
function open(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('guardian-evidence', 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'evidence_id' })
    request.onerror = () => reject(new Error('No se pudo abrir la evidencia local.'))
    request.onblocked = () => reject(new Error('Cierra otras pestañas para abrir la evidencia local.'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = undefined }
      // Purga también al inicializar el servicio.
      const tx = db.transaction(storeName, 'readwrite')
      purge(tx.objectStore(storeName), Date.now())
      tx.oncomplete = () => resolve(db)
      tx.onabort = () => { db.close(); reject(new Error('No se pudo limpiar la evidencia vencida.')) }
    }
  }).catch(error => { database = undefined; throw error })
  return database
}
function purge(store: IDBObjectStore, now: number) {
  const request = store.openCursor()
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    if (cursor.value.expires_at <= now) cursor.delete()
    cursor.continue()
  }
}
async function transaction<T>(operation: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    let value: T
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(new Error('No se pudo guardar o consultar la evidencia local.'))
    const store = tx.objectStore(storeName)
    purge(store, Date.now())
    operation(store, result => { value = result })
  })
}
export const evidence24h = {
  list: () => transaction<SavedEvidence[]>((store, result) => {
    const request = store.getAll()
    request.onsuccess = () => result((request.result as SavedEvidence[]).filter(item => item.expires_at > Date.now()).sort((a, b) => b.saved_at - a.saved_at))
  }),
  save: (snapshot: EvidenceSnapshot) => transaction<SavedEvidence>((store, result) => {
    const now = Date.now()
    const item: SavedEvidence = { ...snapshot, evidence_id: crypto.randomUUID(), saved_at: now, expires_at: now + retention }
    // add nunca modifica ni extiende la vigencia de una instantánea existente.
    store.add(item)
    result(item)
  }),
  remove: (id: string) => transaction<void>((store, result) => { store.delete(id); result(undefined) }),
}
