export type SessionData = Record<string, unknown>

/**
 * セッションの保存先。Redis などに差し替えるときはこれを実装する。
 * データは JSON に変換できる値であることを前提にしてよい
 */
export interface SessionStore {
  get(id: string): Promise<SessionData | undefined>
  /** 新しく作る（同じ ID があれば上書き） */
  set(id: string, data: SessionData, ttlSeconds: number): Promise<void>
  /**
   * 存在するときだけ更新し、なければ false を返す。
   * 並行して破棄・再生成されたセッションを、古い ID のリクエストが保存して復活させないため。
   * 確認と更新は不可分に行うこと
   */
  update(id: string, data: SessionData, ttlSeconds: number): Promise<boolean>
  delete(id: string): Promise<void>
}

export interface MemoryStoreOptions {
  /** 保持する最大件数。超えたら最も長く使われていないものから捨てる（既定 10000） */
  maxEntries?: number
}

interface Entry {
  data: SessionData
  expiresAt: number
}

/**
 * プロセス内のメモリに保存する。開発用や単一プロセスの小規模な用途向け。
 * 複数プロセスで動かすときや再起動でセッションを失いたくないときは、外部のストアを使う
 */
export class MemoryStore implements SessionStore {
  // Map は挿入順を保つので、使うたびに入れ直せば先頭が最も長く使われていないものになる
  readonly #entries = new Map<string, Entry>()
  readonly #maxEntries: number

  constructor(options: MemoryStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? 10_000
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error(
        `mix-session: maxEntries は 1 以上の整数で指定してください: ${maxEntries}`,
      )
    }
    this.#maxEntries = maxEntries
  }

  get size(): number {
    this.#purgeExpired()
    return this.#entries.size
  }

  async get(id: string): Promise<SessionData | undefined> {
    const entry = this.#live(id)
    if (!entry) return undefined
    this.#touch(id, entry)
    // 呼び出し側が書き換えても保存内容が変わらないよう、コピーを渡す
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
    // await を挟まずに確認と更新を行うので、他のリクエストが割り込む余地はない
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
    this.#purgeExpired()
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
  }

  #purgeExpired(): void {
    const now = Date.now()
    for (const [id, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(id)
    }
  }
}
