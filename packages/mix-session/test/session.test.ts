import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MemoryStore,
  type SessionData,
  type SessionState,
  type SessionStore,
  session,
} from '../src/index.js'
import { app, call } from './helpers.js'

const SID = /^__Host-sid=([A-Za-z0-9_-]{43});/

function sidFrom(res: Response): string | undefined {
  for (const cookie of res.headers.getSetCookie()) {
    const match = SID.exec(cookie)
    if (match) return match[1]
  }
  return undefined
}

const cookieHeader = (sid: string) => ({ cookie: `__Host-sid=${sid}` })

/** Records calls to the store */
class RecordingStore extends MemoryStore {
  calls: string[] = []
  override async set(id: string, data: SessionData, ttl: number) {
    this.calls.push(`set:${ttl}`)
    return super.set(id, data, ttl)
  }
  override async update(id: string, data: SessionData, ttl: number) {
    this.calls.push(`update:${ttl}`)
    return super.update(id, data, ttl)
  }
  override async delete(id: string) {
    this.calls.push('delete')
    return super.delete(id)
  }
}

type State = SessionState

/** Puts a session into a store the way mix-session saves one */
const seed = (
  store: SessionStore,
  id: string,
  data: SessionData,
  ttl = 60,
  createdAt = Date.now(),
) => store.set(id, { createdAt, data }, ttl)

/** The session data mix-session saved under an ID */
const stored = async (store: SessionStore, id: string) =>
  ((await store.get(id)) as { data?: SessionData } | undefined)?.data

afterEach(() => {
  vi.restoreAllMocks()
})

describe('creating and loading', () => {
  it('creates nothing in the store or cookies until something is written', async () => {
    const store = new MemoryStore()
    const target = app(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      return { id: session.id ?? null, user: session.get('user') ?? null }
    })
    const res = await call(target)
    expect(await res.json()).toEqual({ id: null, user: null })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(store.size).toBe(0)
  })

  it('puts a random ID in a cookie on write and reads it back on the next request', async () => {
    const store = new MemoryStore()
    const target = app(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      if (ctx.path === '/login') {
        session.set('user', 'imatomix')
        return 'ok'
      }
      return { id: session.id, user: session.get('user') }
    })
    const login = await call(target, `/login`)
    const sid = sidFrom(login)
    expect(sid).toBeDefined()
    expect(login.headers.getSetCookie()[0]).toBe(
      `__Host-sid=${sid}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`,
    )
    expect(login.headers.get('cache-control')).toBe('private, no-store')

    const me = await call(target, `/me`, { headers: cookieHeader(sid ?? '') })
    expect(await me.json()).toEqual({ id: sid, user: 'imatomix' })
    expect(me.headers.getSetCookie()).toEqual([])
  })

  it('issues a different ID every time', async () => {
    const target = app(session(), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return 'ok'
    })
    const ids = new Set<string | undefined>()
    for (let i = 0; i < 5; i++) ids.add(sidFrom(await call(target)))
    expect(ids.size).toBe(5)
  })
})

describe('invalid IDs', () => {
  const forged = 'A'.repeat(43)

  it('does not adopt an ID missing from the store and issues a new one on write', async () => {
    const store = new MemoryStore()
    const target = app(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      const before = session.id ?? null
      session.set('v', 1)
      return { before }
    })
    const res = await call(target, '/', { headers: cookieHeader(forged) })
    expect(await res.json()).toEqual({ before: null })
    const sid = sidFrom(res)
    expect(sid).toBeDefined()
    expect(sid).not.toBe(forged)
    expect(await store.get(forged)).toBeUndefined()
  })

  it.each([
    ['the format is invalid', '__Host-sid=short'],
    [
      'the cookie name appears more than once',
      '__Host-sid=VALID; __Host-sid=VALID',
    ],
  ])('does not load the session when %s', async (_label, cookie) => {
    const store = new MemoryStore()
    const valid = 'B'.repeat(43)
    await seed(store, valid, { user: 'victim' }, 60)
    const target = app(session({ store }), (ctx) => ({
      user: (ctx.state as State).session.get('user') ?? null,
    }))
    const res = await call(target, '/', {
      headers: { cookie: cookie.replaceAll('VALID', valid) },
    })
    expect(await res.json()).toEqual({ user: null })
  })
})

describe('changes inside stored values', () => {
  it('saves a change made directly to a nested value', async () => {
    const store = new MemoryStore()
    const sid = 'F'.repeat(43)
    await seed(store, sid, { cart: ['apple'] }, 60)
    const target = app(session({ store }), (ctx) => {
      ;((ctx.state as State).session.get('cart') as string[]).push('banana')
      return 'ok'
    })
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(await stored(store, sid)).toEqual({ cart: ['apple', 'banana'] })
    expect(sidFrom(res)).toBe(sid)
  })

  it('does not save or send a cookie when a nested value is only read', async () => {
    const store = new RecordingStore()
    const sid = 'G'.repeat(43)
    await seed(store, sid, { cart: ['apple'] }, 60)
    store.calls = []
    const target = app(session({ store }), (ctx) =>
      (ctx.state as State).session.get('cart'),
    )
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(store.calls).toEqual([])
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('regenerate and destroy', () => {
  async function loggedIn(store: MemoryStore) {
    const sid = 'C'.repeat(43)
    await seed(store, sid, { cart: ['apple'] }, 60)
    return sid
  }

  it('regenerate issues a new ID, keeps the data, and deletes the old ID', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const target = app(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      session.regenerate()
      session.set('user', 'imatomix')
      return 'ok'
    })
    const res = await call(target, '/', { headers: cookieHeader(old) })
    const sid = sidFrom(res)
    expect(sid).toBeDefined()
    expect(sid).not.toBe(old)
    expect(await store.get(old)).toBeUndefined()
    expect(await stored(store, sid ?? '')).toEqual({
      cart: ['apple'],
      user: 'imatomix',
    })
  })

  it('destroy deletes the session from the store and removes the cookie', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const target = app(session({ store }), (ctx) => {
      ;(ctx.state as State).session.destroy()
      return 'ok'
    })
    const res = await call(target, '/', { headers: cookieHeader(old) })
    expect(await store.get(old)).toBeUndefined()
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-sid=; Max-Age=0;/)
  })

  it('deleting every key is the same as destroy', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const target = app(session({ store }), (ctx) => {
      ;(ctx.state as State).session.delete('cart')
      return 'ok'
    })
    const res = await call(target, '/', { headers: cookieHeader(old) })
    expect(await store.get(old)).toBeUndefined()
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-sid=; Max-Age=0;/)
  })

  it('does not bring back a session destroyed concurrently when another request saves', async () => {
    const store = new MemoryStore()
    const sid = await loggedIn(store)
    let releaseSlow: () => void = () => {}
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const target = app(session({ store }), async (ctx) => {
      const { session } = ctx.state as State
      if (ctx.path === '/logout') {
        session.destroy()
        return 'logged out'
      }
      await slowGate
      session.set('cart', ['apple', 'banana'])
      return 'updated'
    })
    const slow = call(target, `/cart`, { headers: cookieHeader(sid) })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await call(target, `/logout`, { headers: cookieHeader(sid) })
    releaseSlow()
    const res = await slow
    expect(await store.get(sid)).toBeUndefined()
    expect(sidFrom(res)).toBeUndefined()
  })
})

describe('expiry', () => {
  it('uses ttl for the cookie Max-Age and the store expiry', async () => {
    const store = new RecordingStore()
    const target = app(session({ store, ttl: 600 }), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return 'ok'
    })
    const res = await call(target)
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=600;/)
    expect(store.calls).toEqual(['set:600'])
  })

  it('extends the expiry on read-only requests with rolling', async () => {
    const store = new RecordingStore()
    const sid = 'D'.repeat(43)
    await seed(store, sid, { v: 1 }, 600)
    store.calls = []
    const target = app(session({ store, ttl: 600, rolling: true }), (ctx) =>
      (ctx.state as State).session.get('v'),
    )
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(store.calls).toEqual(['update:600'])
    expect(sidFrom(res)).toBe(sid)
  })

  it('updates neither the store nor the cookie on read-only requests without rolling', async () => {
    const store = new RecordingStore()
    const sid = 'E'.repeat(43)
    await seed(store, sid, { v: 1 }, 600)
    store.calls = []
    const target = app(session({ store }), (ctx) =>
      (ctx.state as State).session.get('v'),
    )
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(store.calls).toEqual([])
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('default cookie name', () => {
  const writes = (ctx: { state: unknown }) => {
    ;(ctx.state as State).session.set('v', 1)
    return 'ok'
  }

  it.each([
    [
      '__Host-sid by default, so other subdomains and http pages cannot plant it',
      {},
      '__Host-sid',
    ],
    [
      '__Secure-sid with a domain, as __Host- forbids Domain',
      { domain: 'example.com' },
      '__Secure-sid',
    ],
    ['sid with secure: false, for http development', { secure: false }, 'sid'],
    [
      '__Secure-sid with a path other than /, as __Host- needs Path=/',
      { path: '/app' },
      '__Secure-sid',
    ],
  ])('uses %s', async (_label, cookie, name) => {
    const res = await call(app(session({ cookie }), writes))
    expect(res.headers.getSetCookie()[0]).toMatch(
      new RegExp(`^${name}=[A-Za-z0-9_-]{43};`),
    )
  })

  it('reads the session back under the default name', async () => {
    const store = new MemoryStore()
    const target = app(session({ store }), (ctx) => {
      const { session: current } = ctx.state as State
      if (ctx.path === '/login') {
        current.set('user', 'mixer')
        return 'ok'
      }
      return { user: current.get('user') ?? null }
    })
    const login = await call(target, '/login')
    const cookie = login.headers.getSetCookie()[0]?.split(';')[0] ?? ''
    expect(
      await (await call(target, '/me', { headers: { cookie } })).json(),
    ).toEqual({
      user: 'mixer',
    })
  })
})

describe('absolute lifetime', () => {
  const DAY = 86_400
  const start = new Date('2026-01-01T00:00:00Z')
  const at = (days: number) =>
    vi.setSystemTime(new Date(start.getTime() + days * DAY * 1000))
  const reads = (ctx: { state: unknown }) => ({
    user: (ctx.state as State).session.get('user') ?? null,
  })

  it('ends a session 7 days after it was created by default, even with rolling', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    const store = new MemoryStore()
    const sid = 'H'.repeat(43)
    await seed(store, sid, { user: 'mixer' }, DAY)
    const target = app(session({ store, rolling: true }), reads)
    for (const day of [0.9, 1.8, 2.7, 3.6, 4.5, 5.4, 6.3]) {
      at(day)
      expect(
        await (await call(target, '/', { headers: cookieHeader(sid) })).json(),
      ).toEqual({
        user: 'mixer',
      })
    }
    at(7)
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(await res.json()).toEqual({ user: null })
    vi.useRealTimers()
  })

  it('removes an expired session that is still in the store, and its cookie', async () => {
    const store = new MemoryStore()
    const sid = 'M'.repeat(43)
    // Created 8 days ago and kept longer by the store, as after absoluteTtl was shortened
    await seed(
      store,
      sid,
      { user: 'mixer' },
      30 * DAY,
      Date.now() - 8 * DAY * 1000,
    )
    const res = await call(app(session({ store }), reads), '/', {
      headers: cookieHeader(sid),
    })
    expect(await res.json()).toEqual({ user: null })
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-sid=; Max-Age=0;/)
    expect(await store.get(sid)).toBeUndefined()
  })

  it('caps the cookie and store lifetime to the time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    const store = new RecordingStore()
    const sid = 'I'.repeat(43)
    await seed(store, sid, { v: 1 }, 7 * DAY)
    store.calls = []
    at(6.5)
    const res = await call(
      app(session({ store }), (ctx) => {
        ;(ctx.state as State).session.set('v', 2)
        return 'ok'
      }),
      '/',
      { headers: cookieHeader(sid) },
    )
    expect(store.calls).toEqual([`update:${DAY / 2}`])
    expect(res.headers.getSetCookie()[0]).toMatch(
      new RegExp(`Max-Age=${DAY / 2};`),
    )
    vi.useRealTimers()
  })

  it('gives a new session no longer than absoluteTtl', async () => {
    const store = new RecordingStore()
    const res = await call(
      app(session({ store, absoluteTtl: 3600 }), (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      }),
    )
    expect(store.calls).toEqual(['set:3600'])
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=3600;/)
  })

  it('gives a new session its full lifetime even if the clock moves while saving', async () => {
    let clock = Date.parse('2026-01-01T00:00:00Z')
    vi.spyOn(Date, 'now').mockImplementation(() => clock++)
    const store = new RecordingStore()
    const res = await call(
      app(session({ store, absoluteTtl: 1 }), (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      }),
    )
    expect(store.calls).toEqual(['set:1'])
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=1;/)
  })

  it('restarts the clock on regenerate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    const store = new MemoryStore()
    const old = 'J'.repeat(43)
    await seed(store, old, { user: 'guest' }, DAY)
    const target = app(session({ store, rolling: true }), (ctx) => {
      const { session: current } = ctx.state as State
      if (ctx.path === '/login') {
        current.regenerate()
        current.set('user', 'mixer')
        return 'ok'
      }
      return { user: current.get('user') ?? null }
    })
    at(6)
    const login = await call(target, '/login', { headers: cookieHeader(old) })
    const sid = sidFrom(login) ?? ''
    for (const day of [6.9, 7.8, 8.7, 9.6, 10.5, 11.4, 12.3]) {
      at(day)
      expect(
        await (
          await call(target, '/me', { headers: cookieHeader(sid) })
        ).json(),
      ).toEqual({
        user: 'mixer',
      })
    }
    at(13)
    expect(
      await (await call(target, '/me', { headers: cookieHeader(sid) })).json(),
    ).toEqual({
      user: null,
    })
    vi.useRealTimers()
  })

  it('keeps a session alive past 7 days with absoluteTtl: false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    at(0)
    const store = new MemoryStore()
    const sid = 'K'.repeat(43)
    await seed(store, sid, { user: 'mixer' }, DAY)
    const target = app(
      session({ store, rolling: true, absoluteTtl: false }),
      reads,
    )
    for (let day = 0.9; day < 30; day += 0.9) {
      at(day)
      await call(target, '/', { headers: cookieHeader(sid) })
    }
    expect(
      await (await call(target, '/', { headers: cookieHeader(sid) })).json(),
    ).toEqual({
      user: 'mixer',
    })
    vi.useRealTimers()
  })

  it('does not adopt a stored value that is not a session record', async () => {
    const store = new MemoryStore()
    const sid = 'L'.repeat(43)
    await store.set(sid, { user: 'mixer' }, 60)
    const res = await call(app(session({ store }), reads), '/', {
      headers: cookieHeader(sid),
    })
    expect(await res.json()).toEqual({ user: null })
  })

  it.each([0, -1, 1.5, Number.NaN, true])(
    'rejects an invalid absoluteTtl (%s)',
    (absoluteTtl) => {
      expect(() => session({ absoluteTtl: absoluteTtl as number })).toThrow(
        /absoluteTtl/,
      )
    },
  )
})

describe('options', () => {
  it('accepts a custom cookie name and attributes', async () => {
    const target = app(
      session({
        name: 'app.sid',
        cookie: { secure: false, sameSite: 'Strict' },
      }),
      (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      },
    )
    expect((await call(target)).headers.getSetCookie()[0]).toMatch(
      /^app\.sid=[A-Za-z0-9_-]{43}; Max-Age=86400; Path=\/; HttpOnly; SameSite=Strict$/,
    )
  })

  it('returns 500 when the store fails', async () => {
    const failing: SessionStore = {
      get: async () => undefined,
      set: async () => {
        throw new Error('store down')
      },
      update: async () => false,
      delete: async () => {},
    }
    const original = console.error
    console.error = () => {}
    try {
      const target = app(session({ store: failing }), (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      })
      expect((await call(target)).status).toBe(500)
    } finally {
      console.error = original
    }
  })

  it.each([
    [
      '__Host- with a domain',
      { name: '__Host-sid', cookie: { domain: 'example.com' } },
    ],
    [
      '__Host- without Secure',
      { name: '__Host-sid', cookie: { secure: false } },
    ],
    [
      '__Secure- without Secure',
      { name: '__Secure-sid', cookie: { secure: false } },
    ],
    [
      '__Host- with a path other than /',
      { name: '__Host-sid', cookie: { path: '/app' } },
    ],
  ])(
    'throws at definition for a cookie name browsers would reject (%s)',
    (_label, options) => {
      expect(() => session(options)).toThrow()
    },
  )

  it.each([0, -1, 1.5])('rejects an invalid ttl (%s)', (ttl) => {
    expect(() => session({ ttl })).toThrow()
  })
})

describe('runtime independence', () => {
  it('generates IDs with Web Crypto', async () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const target = app(session(), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return 'ok'
    })
    expect(sidFrom(await call(target))).toBeDefined()
    expect(random).toHaveBeenCalled()
  })

  it('keeps a response with the session cookie out of shared caches when a later component returns a Response', async () => {
    const target = app(session(), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return new Response('raw', {
        headers: { 'Cache-Control': 'public, max-age=60' },
      })
    })
    const res = await call(target)
    expect(sidFrom(res)).toBeDefined()
    expect(res.headers.get('cache-control')).not.toMatch(/public/)
  })
})
