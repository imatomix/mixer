import type { SessionData } from './store.js'

/** 保存時にどうするか */
export type SessionChange = 'none' | 'modified' | 'regenerated' | 'destroyed'

export class Session<D extends SessionData = SessionData> {
  #data: Partial<D>
  readonly #loadedId: string | undefined
  #change: SessionChange = 'none'

  constructor(data: Partial<D>, loadedId: string | undefined) {
    this.#data = data
    this.#loadedId = loadedId
  }

  /** ストアから読み込んだセッションの ID。新しいセッションでは、保存されるまで undefined */
  get id(): string | undefined {
    return this.#loadedId
  }

  get isEmpty(): boolean {
    return Object.keys(this.#data).length === 0
  }

  get<K extends keyof D & string>(key: K): D[K] | undefined {
    return this.#data[key]
  }

  set<K extends keyof D & string>(key: K, value: D[K]): void {
    this.#data[key] = value
    this.#markModified()
  }

  delete<K extends keyof D & string>(key: K): void {
    delete this.#data[key]
    this.#markModified()
  }

  /**
   * データを保ったまま ID を作り直す。ログインなど権限が変わるときに呼び、
   * 攻撃者があらかじめ知っている ID を使い続けさせない（セッション固定化の対策）
   */
  regenerate(): void {
    if (this.#change !== 'destroyed') this.#change = 'regenerated'
  }

  /** ストアから削除し、Cookie も消す */
  destroy(): void {
    this.#data = {}
    this.#change = 'destroyed'
  }

  /** @internal 保存処理用 */
  snapshot(): { data: Partial<D>; change: SessionChange } {
    return { data: this.#data, change: this.#change }
  }

  #markModified(): void {
    if (this.#change === 'none') this.#change = 'modified'
    if (this.#change === 'destroyed') this.#change = 'regenerated'
  }
}
