import type { SessionData } from './store.js'

/** What to do when saving */
export type SessionChange = 'none' | 'modified' | 'regenerated' | 'destroyed'

export class Session<D extends SessionData = SessionData> {
  #data: Partial<D>
  readonly #loadedId: string | undefined
  #change: SessionChange = 'none'
  // A change made inside a value (such as pushing to an array from get) does not go through set,
  // so the loaded data is compared at save time, as stores keep it as JSON anyway
  readonly #loadedJson: string

  constructor(data: Partial<D>, loadedId: string | undefined) {
    this.#data = data
    this.#loadedId = loadedId
    this.#loadedJson = JSON.stringify(data)
  }

  /** ID of the session loaded from the store. undefined for a new session until it is saved */
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
   * Issues a new ID while keeping the data. Call it whenever privileges change, such as on login,
   * so that an ID known to an attacker in advance cannot be used (protection against session fixation)
   */
  regenerate(): void {
    if (this.#change !== 'destroyed') this.#change = 'regenerated'
  }

  /** Deletes the session from the store and removes the cookie */
  destroy(): void {
    this.#data = {}
    this.#change = 'destroyed'
  }

  /** @internal Used when saving */
  snapshot(): { data: Partial<D>; change: SessionChange } {
    const changedInside =
      this.#change === 'none' && JSON.stringify(this.#data) !== this.#loadedJson
    return {
      data: this.#data,
      change: changedInside ? 'modified' : this.#change,
    }
  }

  #markModified(): void {
    if (this.#change === 'none') this.#change = 'modified'
    if (this.#change === 'destroyed') this.#change = 'regenerated'
  }
}
