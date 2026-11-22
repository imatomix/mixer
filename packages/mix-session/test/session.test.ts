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
    await store.set(valid, { user: 'victim' }, 60)
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
    await store.set(sid, { cart: ['apple'] }, 60)
    const target = app(session({ store }), (ctx) => {
      ;((ctx.state as State).session.get('cart') as string[]).push('banana')
      return 'ok'
    })
    const res = await call(target, '/', { headers: cookieHeader(sid) })
    expect(await store.get(sid)).toEqual({ cart: ['apple', 'banana'] })
    expect(sidFrom(res)).toBe(sid)
  })

  it('does not save or send a cookie when a nested value is only read', async () => {
    const store = new RecordingStore()
    const sid = 'G'.repeat(43)
    await store.set(sid, { cart: ['apple'] }, 60)
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
    await store.set(sid, { cart: ['apple'] }, 60)
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
    expect(await store.get(sid ?? '')).toEqual({
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
    await store.set(sid, { v: 1 }, 600)
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
    await store.set(sid, { v: 1 }, 600)
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
