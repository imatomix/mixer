import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../src/index.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoryStore', () => {
  it('保存したデータを返し、返り値を書き換えてもストアには影響しない', async () => {
    const store = new MemoryStore()
    await store.set('a', { user: 'imatomix', tags: ['x'] }, 60)
    const loaded = (await store.get('a')) as { tags: string[] }
    expect(loaded).toEqual({ user: 'imatomix', tags: ['x'] })
    loaded.tags.push('mutated')
    expect(await store.get('a')).toEqual({ user: 'imatomix', tags: ['x'] })
  })

  it('有効期限を過ぎたものは返さない', async () => {
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

  it('update は存在するものだけを更新し、なければ false を返す', async () => {
    const store = new MemoryStore()
    expect(await store.update('missing', { v: 1 }, 60)).toBe(false)
    expect(await store.get('missing')).toBeUndefined()
    await store.set('a', { v: 1 }, 60)
    expect(await store.update('a', { v: 2 }, 60)).toBe(true)
    expect(await store.get('a')).toEqual({ v: 2 })
  })

  it('期限切れのものは update で復活させない', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const store = new MemoryStore()
    await store.set('a', { v: 1 }, 60)
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'))
    expect(await store.update('a', { v: 2 }, 60)).toBe(false)
  })

  it('上限を超えたら最も長く使われていないものから捨てる', async () => {
    const store = new MemoryStore({ maxEntries: 2 })
    await store.set('a', { v: 1 }, 60)
    await store.set('b', { v: 2 }, 60)
    await store.get('a')
    await store.set('c', { v: 3 }, 60)
    expect(await store.get('a')).toEqual({ v: 1 })
    expect(await store.get('b')).toBeUndefined()
    expect(await store.get('c')).toEqual({ v: 3 })
  })

  it('delete で消える', async () => {
    const store = new MemoryStore()
    await store.set('a', { v: 1 }, 60)
    await store.delete('a')
    expect(await store.get('a')).toBeUndefined()
  })

  it('maxEntries に不正な値は指定できない', () => {
    expect(() => new MemoryStore({ maxEntries: 0 })).toThrow()
    expect(() => new MemoryStore({ maxEntries: 1.5 })).toThrow()
  })
})
