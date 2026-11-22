import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../src/index.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoryStore', () => {
  it('returns stored data, and changing the returned value does not affect the store', async () => {
    const store = new MemoryStore()
    await store.set('a', { user: 'imatomix', tags: ['x'] }, 60)
    const loaded = (await store.get('a')) as { tags: string[] }
    expect(loaded).toEqual({ user: 'imatomix', tags: ['x'] })
    loaded.tags.push('mutated')
    expect(await store.get('a')).toEqual({ user: 'imatomix', tags: ['x'] })
  })

  it('does not return expired entries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new MemoryStore()
    await store.set('a', { v: 1 }, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:59Z'))
    expect(await store.get('a')).toEqual({ v: 1 })
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'))
    expect(await store.get('a')).toBeUndefined()
    expect(store.size).toBe(0)
  })

  it('update changes only existing entries and returns false otherwise', async () => {
    const store = new MemoryStore()
    expect(await store.update('missing', { v: 1 }, 60)).toBe(false)
    expect(await store.get('missing')).toBeUndefined()
    await store.set('a', { v: 1 }, 60)
    expect(await store.update('a', { v: 2 }, 60)).toBe(true)
    expect(await store.get('a')).toEqual({ v: 2 })
  })

  it('does not bring expired entries back through update', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new MemoryStore()
    await store.set('a', { v: 1 }, 60)
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    expect(await store.update('a', { v: 2 }, 60)).toBe(false)
  })

  it('drops the least recently used entries when over the limit', async () => {
    const store = new MemoryStore({ maxEntries: 2 })
    await store.set('a', { v: 1 }, 60)
    await store.set('b', { v: 2 }, 60)
    await store.get('a')
    await store.set('c', { v: 3 }, 60)
    expect(await store.get('a')).toEqual({ v: 1 })
    expect(await store.get('b')).toBeUndefined()
    expect(await store.get('c')).toEqual({ v: 3 })
  })

  it('keeps the cost of a write independent of how many sessions are stored', async () => {
    const timeFill = async (count: number) => {
      const store = new MemoryStore({ maxEntries: count })
      const start = performance.now()
      for (let i = 0; i < count; i++) await store.set(`s${i}`, { i }, 600)
      return performance.now() - start
    }
    await timeFill(2_000) // warm up
    const small = await timeFill(2_000)
    const large = await timeFill(20_000)
    // Ten times the sessions should take about ten times as long; scanning every entry on each write takes about a hundred
    expect(large).toBeLessThan(small * 30 + 10)
  })

  it('drops expired entries before live ones when over the limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new MemoryStore({ maxEntries: 2 })
    await store.set('expired', { v: 1 }, 1)
    await store.set('live', { v: 2 }, 60)
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))
    await store.set('new', { v: 3 }, 60)
    expect(await store.get('live')).toEqual({ v: 2 })
    expect(await store.get('new')).toEqual({ v: 3 })
  })

  it('removes entries with delete', async () => {
    const store = new MemoryStore()
    await store.set('a', { v: 1 }, 60)
    await store.delete('a')
    expect(await store.get('a')).toBeUndefined()
  })

  it('rejects an invalid maxEntries', () => {
    expect(() => new MemoryStore({ maxEntries: 0 })).toThrow()
    expect(() => new MemoryStore({ maxEntries: 1.5 })).toThrow()
  })
})
