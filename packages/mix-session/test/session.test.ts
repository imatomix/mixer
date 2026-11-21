import { describe, expect, it } from 'vitest'
import {
  MemoryStore,
  type SessionData,
  type SessionState,
  type SessionStore,
  session,
} from '../src/index.js'
import { serve } from './helpers.js'

const SID = /^sid=([A-Za-z0-9_-]{43});/

function sidFrom(res: Response): string | undefined {
  for (const cookie of res.headers.getSetCookie()) {
    const match = SID.exec(cookie)
    if (match) return match[1]
  }
  return undefined
}

const cookieHeader = (sid: string) => ({ cookie: `sid=${sid}` })

/** ストアへの呼び出しを記録する */
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

describe('作成と読み込み', () => {
  it('書き込むまではストアにも Cookie にも何も作らない', async () => {
    const store = new MemoryStore()
    const url = await serve(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      return { id: session.id ?? null, user: session.get('user') ?? null }
    })
    const res = await fetch(url)
    expect(await res.json()).toEqual({ id: null, user: null })
    expect(res.headers.getSetCookie()).toEqual([])
    expect(store.size).toBe(0)
  })

  it('書き込むとランダムな ID を Cookie に入れ、次のリクエストで読める', async () => {
    const store = new MemoryStore()
    const url = await serve(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      if (ctx.url.pathname === '/login') {
        session.set('user', 'imatomix')
        return 'ok'
      }
      return { id: session.id, user: session.get('user') }
    })
    const login = await fetch(`${url}/login`)
    const sid = sidFrom(login)
    expect(sid).toBeDefined()
    expect(login.headers.getSetCookie()[0]).toBe(
      `sid=${sid}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`,
    )
    expect(login.headers.get('cache-control')).toBe('private, no-store')

    const me = await fetch(`${url}/me`, { headers: cookieHeader(sid ?? '') })
    expect(await me.json()).toEqual({ id: sid, user: 'imatomix' })
    expect(me.headers.getSetCookie()).toEqual([])
  })

  it('ID は毎回異なる', async () => {
    const url = await serve(session(), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return 'ok'
    })
    const ids = new Set<string | undefined>()
    for (let i = 0; i < 5; i++) ids.add(sidFrom(await fetch(url)))
    expect(ids.size).toBe(5)
  })
})

describe('不正な ID', () => {
  const forged = 'A'.repeat(43)

  it('ストアにない ID は採用せず、書き込み時に新しい ID を発行する', async () => {
    const store = new MemoryStore()
    const url = await serve(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      const before = session.id ?? null
      session.set('v', 1)
      return { before }
    })
    const res = await fetch(url, { headers: cookieHeader(forged) })
    expect(await res.json()).toEqual({ before: null })
    const sid = sidFrom(res)
    expect(sid).toBeDefined()
    expect(sid).not.toBe(forged)
    expect(await store.get(forged)).toBeUndefined()
  })

  it.each([
    ['形式が不正', 'sid=short'],
    ['同じ名前の Cookie が複数ある', 'sid=VALID; sid=VALID'],
  ])('%s場合は読み込まない', async (_label, cookie) => {
    const store = new MemoryStore()
    const valid = 'B'.repeat(43)
    await store.set(valid, { user: 'victim' }, 60)
    const url = await serve(session({ store }), (ctx) => ({
      user: (ctx.state as State).session.get('user') ?? null,
    }))
    const res = await fetch(url, {
      headers: { cookie: cookie.replaceAll('VALID', valid) },
    })
    expect(await res.json()).toEqual({ user: null })
  })
})

describe('regenerate と destroy', () => {
  async function loggedIn(store: MemoryStore) {
    const sid = 'C'.repeat(43)
    await store.set(sid, { cart: ['apple'] }, 60)
    return sid
  }

  it('regenerate はデータを保ったまま ID を作り直し、古い ID を消す', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const url = await serve(session({ store }), (ctx) => {
      const { session } = ctx.state as State
      session.regenerate()
      session.set('user', 'imatomix')
      return 'ok'
    })
    const res = await fetch(url, { headers: cookieHeader(old) })
    const sid = sidFrom(res)
    expect(sid).toBeDefined()
    expect(sid).not.toBe(old)
    expect(await store.get(old)).toBeUndefined()
    expect(await store.get(sid ?? '')).toEqual({
      cart: ['apple'],
      user: 'imatomix',
    })
  })

  it('destroy はストアから消し、Cookie も削除する', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const url = await serve(session({ store }), (ctx) => {
      ;(ctx.state as State).session.destroy()
      return 'ok'
    })
    const res = await fetch(url, { headers: cookieHeader(old) })
    expect(await store.get(old)).toBeUndefined()
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=; Max-Age=0;/)
  })

  it('すべてのキーを消すと destroy と同じになる', async () => {
    const store = new MemoryStore()
    const old = await loggedIn(store)
    const url = await serve(session({ store }), (ctx) => {
      ;(ctx.state as State).session.delete('cart')
      return 'ok'
    })
    const res = await fetch(url, { headers: cookieHeader(old) })
    expect(await store.get(old)).toBeUndefined()
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=; Max-Age=0;/)
  })

  it('並行して destroy されたセッションを、別のリクエストの保存で復活させない', async () => {
    const store = new MemoryStore()
    const sid = await loggedIn(store)
    let releaseSlow: () => void = () => {}
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    const url = await serve(session({ store }), async (ctx) => {
      const { session } = ctx.state as State
      if (ctx.url.pathname === '/logout') {
        session.destroy()
        return 'logged out'
      }
      await slowGate
      session.set('cart', ['apple', 'banana'])
      return 'updated'
    })
    const slow = fetch(`${url}/cart`, { headers: cookieHeader(sid) })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await fetch(`${url}/logout`, { headers: cookieHeader(sid) })
    releaseSlow()
    const res = await slow
    expect(await store.get(sid)).toBeUndefined()
    expect(sidFrom(res)).toBeUndefined()
  })
})

describe('期限', () => {
  it('ttl を Cookie の Max-Age とストアの期限に使う', async () => {
    const store = new RecordingStore()
    const url = await serve(session({ store, ttl: 600 }), (ctx) => {
      ;(ctx.state as State).session.set('v', 1)
      return 'ok'
    })
    const res = await fetch(url)
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=600;/)
    expect(store.calls).toEqual(['set:600'])
  })

  it('rolling なら読むだけのリクエストでも期限を延ばす', async () => {
    const store = new RecordingStore()
    const sid = 'D'.repeat(43)
    await store.set(sid, { v: 1 }, 600)
    store.calls = []
    const url = await serve(
      session({ store, ttl: 600, rolling: true }),
      (ctx) => (ctx.state as State).session.get('v'),
    )
    const res = await fetch(url, { headers: cookieHeader(sid) })
    expect(store.calls).toEqual(['update:600'])
    expect(sidFrom(res)).toBe(sid)
  })

  it('rolling でなければ読むだけのリクエストではストアも Cookie も更新しない', async () => {
    const store = new RecordingStore()
    const sid = 'E'.repeat(43)
    await store.set(sid, { v: 1 }, 600)
    store.calls = []
    const url = await serve(session({ store }), (ctx) =>
      (ctx.state as State).session.get('v'),
    )
    const res = await fetch(url, { headers: cookieHeader(sid) })
    expect(store.calls).toEqual([])
    expect(res.headers.getSetCookie()).toEqual([])
  })
})

describe('設定', () => {
  it('Cookie の名前と属性を変更できる', async () => {
    const url = await serve(
      session({
        name: 'app.sid',
        cookie: { secure: false, sameSite: 'Strict' },
      }),
      (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      },
    )
    expect((await fetch(url)).headers.getSetCookie()[0]).toMatch(
      /^app\.sid=[A-Za-z0-9_-]{43}; Max-Age=86400; Path=\/; HttpOnly; SameSite=Strict$/,
    )
  })

  it('ストアが失敗したら 500 を返す', async () => {
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
      const url = await serve(session({ store: failing }), (ctx) => {
        ;(ctx.state as State).session.set('v', 1)
        return 'ok'
      })
      expect((await fetch(url)).status).toBe(500)
    } finally {
      console.error = original
    }
  })

  it.each([0, -1, 1.5])('ttl に不正な値（%s）は指定できない', (ttl) => {
    expect(() => session({ ttl })).toThrow()
  })
})
