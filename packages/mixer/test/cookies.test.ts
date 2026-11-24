import { describe, expect, it, vi } from 'vitest'
import { Mixer } from '../src/index.js'
import { call } from './helpers.js'

const setCookies = (res: Response) => res.headers.getSetCookie()

describe('ctx.cookies.get', () => {
  it('returns the value of the cookie whose name matches exactly', async () => {
    const app = new Mixer().mix((ctx) => ({
      sid: ctx.cookies.get('sid') ?? null,
      other: ctx.cookies.get('other_sid') ?? null,
      missing: ctx.cookies.get('missing') ?? null,
    }))
    const res = await call(app, '/', {
      headers: { cookie: 'other_sid=x; sid=abc' },
    })
    expect(await res.json()).toEqual({ sid: 'abc', other: 'x', missing: null })
  })

  it('URL-decodes values, returns the raw value when decoding fails, and strips quotes', async () => {
    const app = new Mixer().mix((ctx) => [
      ctx.cookies.get('a'),
      ctx.cookies.get('b'),
      ctx.cookies.get('c'),
    ])
    const res = await call(app, '/', {
      headers: {
        cookie: `a=${encodeURIComponent('りんご; x')}; b=%E3%81; c="quoted"`,
      },
    })
    expect(await res.json()).toEqual(['りんご; x', '%E3%81', 'quoted'])
  })

  it('get returns the first value and getAll returns all values for a repeated name', async () => {
    const app = new Mixer().mix((ctx) => ({
      first: ctx.cookies.get('sid'),
      all: ctx.cookies.getAll('sid'),
    }))
    const res = await call(app, '/', { headers: { cookie: 'sid=1; sid=2' } })
    expect(await res.json()).toEqual({ first: '1', all: ['1', '2'] })
  })

  it('handles a cookie named __proto__ safely', async () => {
    const app = new Mixer().mix((ctx) => ({
      value: ctx.cookies.get('__proto__'),
      x: ctx.cookies.get('toString') ?? null,
    }))
    const res = await call(app, '/', { headers: { cookie: '__proto__=p' } })
    expect(await res.json()).toEqual({ value: 'p', x: null })
  })
})

describe('ctx.cookies.set', () => {
  it('sets Set-Cookie with secure defaults', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('theme', 'dark')
      return 'ok'
    })
    expect(setCookies(await call(app))).toEqual([
      'theme=dark; Path=/; HttpOnly; Secure; SameSite=Lax',
    ])
  })

  it('accepts attributes and encodes the value', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('pref', 'a b;c', {
        maxAge: 60,
        expires: new Date('2030-01-01T00:00:00Z'),
        path: '/app',
        domain: 'example.com',
        httpOnly: false,
        secure: false,
        sameSite: 'Strict',
        priority: 'High',
      })
      return 'ok'
    })
    expect(setCookies(await call(app))).toEqual([
      'pref=a%20b%3Bc; Max-Age=60; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Path=/app; Domain=example.com; SameSite=Strict; Priority=High',
    ])
  })

  it('adds to existing Set-Cookie headers without removing them', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.append('Set-Cookie', 'legacy=1')
      ctx.cookies.set('a', '1')
      return 'ok'
    })
    const cookies = setCookies(await call(app))
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toBe('legacy=1')
  })

  it('replaces a cookie set again with the same name, Path, and Domain', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('a', '1')
      ctx.cookies.set('a', '2')
      ctx.cookies.set('a', '3', { path: '/other' })
      return 'ok'
    })
    const cookies = setCookies(await call(app))
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toMatch(/^a=2; Path=\/;/)
    expect(cookies[1]).toMatch(/^a=3; Path=\/other;/)
  })

  it('does not send a cookie set before an error; components that must, set it after next()', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Mixer().mix(
      async (ctx, next) => {
        await next()
        ctx.cookies.set('kept', '1')
      },
      (ctx) => {
        ctx.cookies.set('lost', '1')
        throw new Error('boom')
      },
    )
    const res = await call(app)
    expect(res.status).toBe(500)
    expect(setCookies(res)).toEqual([expect.stringMatching(/^kept=1;/)])
  })
})

describe('ctx.cookies.delete', () => {
  it('sends an expired cookie with the same Path and Domain', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.delete('sid', { path: '/app', domain: 'example.com' })
      return 'ok'
    })
    expect(setCookies(await call(app))).toEqual([
      'sid=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/app; Domain=example.com; HttpOnly; Secure; SameSite=Lax',
    ])
  })
})

describe('validation', () => {
  const cases: [
    string,
    (cookies: import('../src/index.js').Context['cookies']) => void,
  ][] = [
    ['the name contains ;', (c) => c.set('a;b', 'x')],
    ['the name is empty', (c) => c.set('', 'x')],
    [
      'the name contains a line break',
      (c) => c.set('a\r\nSet-Cookie: evil', 'x'),
    ],
    ['path contains ;', (c) => c.set('a', 'x', { path: '/; Domain=evil' })],
    ['path does not start with /', (c) => c.set('a', 'x', { path: 'app' })],
    ['domain contains ;', (c) => c.set('a', 'x', { domain: 'a.com; Secure' })],
    ['maxAge is not an integer', (c) => c.set('a', 'x', { maxAge: 1.5 })],
    [
      'maxAge is infinite',
      (c) => c.set('a', 'x', { maxAge: Number.POSITIVE_INFINITY }),
    ],
    [
      'expires is an invalid date',
      (c) => c.set('a', 'x', { expires: new Date('nope') }),
    ],
    [
      'sameSite is invalid',
      (c) => c.set('a', 'x', { sameSite: 'Loose' as 'Lax' }),
    ],
    [
      'SameSite=None without Secure',
      (c) => c.set('a', 'x', { sameSite: 'None', secure: false }),
    ],
    [
      'Partitioned without Secure',
      (c) => c.set('a', 'x', { partitioned: true, secure: false }),
    ],
    [
      '__Secure- without Secure',
      (c) => c.set('__Secure-a', 'x', { secure: false }),
    ],
    [
      '__Host- with a Domain',
      (c) => c.set('__Host-a', 'x', { domain: 'example.com' }),
    ],
    [
      '__Host- with a Path other than /',
      (c) => c.set('__Host-a', 'x', { path: '/app' }),
    ],
  ]

  it.each(cases)('throws when %s', async (_label, act) => {
    let error: unknown
    const app = new Mixer().mix((ctx) => {
      try {
        act(ctx.cookies)
      } catch (e) {
        error = e
      }
      return 'ok'
    })
    const res = await call(app)
    expect(error).toBeInstanceOf(TypeError)
    expect(setCookies(res)).toEqual([])
  })

  it('throws on set after the response is final', async () => {
    let late: (() => void) | undefined
    const app = new Mixer().mix((ctx) => {
      late = () => ctx.cookies.set('a', '1')
      return 'sent'
    })
    await call(app)
    expect(late).toThrow()
  })
})
