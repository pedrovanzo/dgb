/**
 * Local battery-save store (IndexedDB). Saves are keyed by the ROM's SHA-1 so
 * they follow the game, not the file name. Works in the worker and the page.
 */

const DB_NAME = 'dgb'
const DB_VERSION = 1
const SAVES = 'saves'
/** Earlier versions kept for rollback (one per play session). */
export const SAVE_HISTORY_LIMIT = 5

export interface SaveVersion {
  data: Uint8Array
  /** ms since the Unix epoch. */
  updatedAt: number
}

export interface SaveRecord extends SaveVersion {
  romSha1: string
  title: string
  /** Newest first, at most `SAVE_HISTORY_LIMIT`. */
  history: SaveVersion[]
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export class SaveStore {
  private readonly db: IDBDatabase

  private constructor(db: IDBDatabase) {
    this.db = db
  }

  static async open(factory: IDBFactory = indexedDB): Promise<SaveStore> {
    const req = factory.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SAVES))
        db.createObjectStore(SAVES, { keyPath: 'romSha1' })
    }
    return new SaveStore(await request(req))
  }

  close(): void {
    this.db.close()
  }

  async get(romSha1: string): Promise<SaveRecord | null> {
    const tx = this.db.transaction(SAVES, 'readonly')
    const rec = await request<SaveRecord | undefined>(
      tx.objectStore(SAVES).get(romSha1),
    )
    return rec ?? null
  }

  /** Overwrites the current save, keeping its history. */
  async put(
    romSha1: string,
    title: string,
    data: Uint8Array,
    updatedAt = Date.now(),
  ): Promise<void> {
    const tx = this.db.transaction(SAVES, 'readwrite')
    const store = tx.objectStore(SAVES)
    const old = await request<SaveRecord | undefined>(store.get(romSha1))
    const rec: SaveRecord = {
      romSha1,
      title,
      data: data.slice(),
      updatedAt,
      history: old?.history ?? [],
    }
    await request(store.put(rec))
  }

  /**
   * Copies the current save into history (start of a play session), unless
   * it equals the newest history entry. Returns the current save.
   */
  async checkpoint(romSha1: string): Promise<SaveRecord | null> {
    const tx = this.db.transaction(SAVES, 'readwrite')
    const store = tx.objectStore(SAVES)
    const rec = await request<SaveRecord | undefined>(store.get(romSha1))
    if (!rec) return null
    const newest = rec.history[0]
    if (!newest || !bytesEqual(newest.data, rec.data)) {
      rec.history = [
        { data: rec.data, updatedAt: rec.updatedAt },
        ...rec.history,
      ].slice(0, SAVE_HISTORY_LIMIT)
      await request(store.put(rec))
    }
    return rec
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export async function sha1Hex(data: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}
