import { describe, expect, it } from 'vitest'
import {
  MemoryStore,
  type SessionData,
  type SessionStore,
} from '../src/index.js'
import { checkSessionStore } from '../src/testing.js'

/** A MemoryStore with one rule broken */
function broken(override: Partial<SessionStore>): () => SessionStore {
  return () => {
    const store = new MemoryStore()
    return {
      get: (id) => store.get(id),
      set: (id, data, ttl) => store.set(id, data, ttl),
      update: (id, data, ttl) => store.update(id, data, ttl),
      delete: (id) => store.delete(id),
      ...override,
    }
  }
}

describe('checkSessionStore', () => {
  it('passes for MemoryStore, including expiry', async () => {
    await expect(
      checkSessionStore(() => new MemoryStore()),
    ).resolves.toBeUndefined()
  })

  it('passes for a store that reorders object keys, as JSON columns may', async () => {
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys)
      if (value === null || typeof value !== 'object') return value
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(value).sort().reverse()) {
        Object.defineProperty(sorted, key, {
          value: sortKeys((value as Record<string, unknown>)[key]),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      return sorted
    }
    const shared = new MemoryStore()
    const store = broken({
      set: (id, data, ttl) =>
        shared.set(id, sortKeys(data) as SessionData, ttl),
      update: (id, data, ttl) =>
        shared.update(id, sortKeys(data) as SessionData, ttl),
      get: (id) => shared.get(id),
      delete: (id) => shared.delete(id),
    })
    await expect(
      checkSessionStore(store, { expiry: false }),
    ).resolves.toBeUndefined()
  })

  it('fails when update creates a session that does not exist', async () => {
    const shared = new MemoryStore()
    const store = broken({
      update: async (id, data, ttl) => {
        await shared.set(id, data, ttl)
        return true
      },
      get: (id) => shared.get(id),
      set: (id, data, ttl) => shared.set(id, data, ttl),
      delete: (id) => shared.delete(id),
    })
    await expect(checkSessionStore(store, { expiry: false })).rejects.toThrow(
      /update must not create a session that does not exist/,
    )
  })

  it('fails when a deleted session can be updated back', async () => {
    const data = new Map<string, SessionData>()
    const store = broken({
      get: async (id) => structuredClone(data.get(id)),
      set: async (id, value) => void data.set(id, structuredClone(value)),
      update: async (id, value) => {
        if (!data.has(id)) return false
        data.set(id, structuredClone(value))
        return true
      },
      delete: async () => {},
    })
    await expect(checkSessionStore(store, { expiry: false })).rejects.toThrow(
      /delete/,
    )
  })

  it('fails when get hands out the stored object itself', async () => {
    const data = new Map<string, SessionData>()
    const store = broken({
      get: async (id) => data.get(id),
      set: async (id, value) => void data.set(id, value),
      update: async (id, value) => {
        if (!data.has(id)) return false
        data.set(id, value)
        return true
      },
      delete: async (id) => void data.delete(id),
    })
    await expect(checkSessionStore(store, { expiry: false })).rejects.toThrow(
      /copy/,
    )
  })

  it('fails when sessions never expire', async () => {
    const shared = new MemoryStore()
    const store = broken({
      set: (id, data) => shared.set(id, data, 3600),
      update: (id, data) => shared.update(id, data, 3600),
      get: (id) => shared.get(id),
      delete: (id) => shared.delete(id),
    })
    await expect(checkSessionStore(store)).rejects.toThrow(/expire/)
  })
})
