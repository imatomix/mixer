export type SessionData = Record<string, unknown>

/**
 * Where sessions are stored. Implement this to use Redis or another backend.
 * Implementations may assume that the data can be converted to JSON
 */
export interface SessionStore {
  get(id: string): Promise<SessionData | undefined>
  /** Creates a session (overwrites one with the same ID) */
  set(id: string, data: SessionData, ttlSeconds: number): Promise<void>
  /**
   * Updates the session only if it exists, and returns false otherwise.
   * This keeps a request holding an old ID from bringing back a session that was destroyed or regenerated concurrently.
   * The existence check and the update must be atomic
   */
  update(id: string, data: SessionData, ttlSeconds: number): Promise<boolean>
  delete(id: string): Promise<void>
}

export interface MemoryStoreOptions {
  /** Maximum number of sessions. When exceeded, the least recently used ones are dropped (defaults to 10000) */
  maxEntries?: number
}

// Expired entries are never returned, so sweeping them only frees memory. Doing it on every write would cost a scan
// of every entry per request, so sweep at most this often, and at most once a second when over the limit
const SWEEP_INTERVAL_MS = 60_000
const MIN_SWEEP_GAP_MS = 1_000

interface Entry {
  data: SessionData
  expiresAt: number
}

/**
 * Stores sessions in process memory, for development or small single-process deployments.
 * Use an external store to run multiple processes or to keep sessions across restarts
 */
export class MemoryStore implements SessionStore {
  // A Map keeps insertion order, so re-inserting on every use keeps the least recently used entry first
  readonly #entries = new Map<string, Entry>()
  readonly #maxEntries: number
  #lastSweep = Date.now()

  constructor(options: MemoryStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? 10_000
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(
        `mix-session: maxEntries must be an integer of 1 or more: ${maxEntries}`,
      )
    }
    this.#maxEntries = maxEntries
  }

  /** The number of live sessions (counting them sweeps expired ones) */
  get size(): number {
    this.#purgeExpired(Date.now())
    return this.#entries.size
  }

  async get(id: string): Promise<SessionData | undefined> {
    const entry = this.#live(id)
    if (!entry) return undefined
    this.#touch(id, entry)
    // Return a copy so that changes made by the caller do not affect the stored data
    return structuredClone(entry.data)
  }

  async set(id: string, data: SessionData, ttlSeconds: number): Promise<void> {
    this.#write(id, data, ttlSeconds)
  }

  async update(
    id: string,
    data: SessionData,
    ttlSeconds: number,
  ): Promise<boolean> {
    // The check and the update happen without an await in between, so no other request can interleave
    if (!this.#live(id)) return false
    this.#write(id, data, ttlSeconds)
    return true
  }

  async delete(id: string): Promise<void> {
    this.#entries.delete(id)
  }

  #write(id: string, data: SessionData, ttlSeconds: number): void {
    this.#entries.delete(id)
    this.#entries.set(id, {
      data: structuredClone(data),
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
    this.#evictOverflow()
  }

  #live(id: string): Entry | undefined {
    const entry = this.#entries.get(id)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(id)
      return undefined
    }
    return entry
  }

  #touch(id: string, entry: Entry): void {
    this.#entries.delete(id)
    this.#entries.set(id, entry)
  }

  #evictOverflow(): void {
    const now = Date.now()
    const sinceSweep = now - this.#lastSweep
    const overLimit = this.#entries.size > this.#maxEntries
    if (
      sinceSweep >= SWEEP_INTERVAL_MS ||
      (overLimit && sinceSweep >= MIN_SWEEP_GAP_MS)
    ) {
      this.#purgeExpired(now)
    }
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
  }

  #purgeExpired(now: number): void {
    this.#lastSweep = now
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(id)
    }
  }
}
