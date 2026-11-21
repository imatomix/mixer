import { describe, expect, it } from 'vitest'
import { serve } from './helpers.js'

const setCookies = (res: Response) => res.headers.getSetCookie()

describe('ctx.cookies.get', () => {
  it('returns the value of the cookie whose name matches exactly', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        sid: ctx.cookies.get('sid') ?? null,
        other: ctx.cookies.get('other_sid') ?? null,
        missing: ctx.cookies.get('missing') ?? null,
      })),
    )
    const res = await fetch(url, {
      headers: { cookie: 'other_sid=x; sid=abc' },
    })
    expect(await res.json()).toEqual({ sid: 'abc', other: 'x', missing: null })
  })

  it('URL-decodes values, returns the raw value when decoding fails, and strips quotes', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => [
        ctx.cookies.get('a'),
        ctx.cookies.get('b'),
        ctx.cookies.get('c'),
      ]),
    )
    const res = await fetch(url, {
      headers: {
        cookie: `a=${encodeURIComponent('りんご; x')}; b=%E3%81; c="quoted"`,
      },
    })
    expect(await res.json()).toEqual(['りんご; x', '%E3%81', 'quoted'])
  })

  it('get returns the first value and getAll returns all values for a repeated name', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        first: ctx.cookies.get('sid'),
        all: ctx.cookies.getAll('sid'),
      })),
    )
    const res = await fetch(url, { headers: { cookie: 'sid=1; sid=2' } })
    expect(await res.json()).toEqual({ first: '1', all: ['1', '2'] })
  })

  it('handles a cookie named __proto__ safely', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        value: ctx.cookies.get('__proto__'),
        x: ctx.cookies.get('toString') ?? null,
      })),
    )
    const res = await fetch(url, { headers: { cookie: '__proto__=p' } })
    expect(await res.json()).toEqual({ value: 'p', x: null })
  })
})

describe('ctx.cookies.set', () => {
  it('sets Set-Cookie with secure defaults', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.cookies.set('theme', 'dark')
        return 'ok'
      }),
    )
    expect(setCookies(await fetch(url))).toEqual([
      'theme=dark; Path=/; HttpOnly; Secure; SameSite=Lax',
    ])
  })

  it('accepts attributes and encodes the value', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
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
      }),
    )
    expect(setCookies(await fetch(url))).toEqual([
      'pref=a%20b%3Bc; Max-Age=60; Expires=Tue, 01 Jan 2030 00:00:00 GMT; Path=/app; Domain=example.com; SameSite=Strict; Priority=High',
    ])
  })

  it('adds to existing Set-Cookie headers without removing them', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.res.setHeader('Set-Cookie', 'legacy=1')
        ctx.cookies.set('a', '1')
        return 'ok'
      }),
    )
    const cookies = setCookies(await fetch(url))
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toBe('legacy=1')
  })

  it('replaces a cookie set again with the same name, Path, and Domain', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.cookies.set('a', '1')
        ctx.cookies.set('a', '2')
        ctx.cookies.set('a', '3', { path: '/other' })
        return 'ok'
      }),
    )
    const cookies = setCookies(await fetch(url))
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toMatch(/^a=2; Path=\/;/)
    expect(cookies[1]).toMatch(/^a=3; Path=\/other;/)
  })

  it('keeps Set-Cookie on error responses', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.cookies.set('a', '1')
        throw new Error('boom')
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    expect(setCookies(res)).toHaveLength(1)
  })
})

describe('ctx.cookies.delete', () => {
  it('sends an expired cookie with the same Path and Domain', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.cookies.delete('sid', { path: '/app', domain: 'example.com' })
        return 'ok'
      }),
    )
    expect(setCookies(await fetch(url))).toEqual([
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
    const url = await serve((app) =>
      app.mix((ctx) => {
        try {
          act(ctx.cookies)
        } catch (e) {
          error = e
        }
        return 'ok'
      }),
    )
    const res = await fetch(url)
    expect(error).toBeInstanceOf(TypeError)
    expect(setCookies(res)).toEqual([])
  })

  it('throws on set after the response has been sent', async () => {
    let error: unknown
    const url = await serve((app) =>
      app.mix(async (ctx) => {
        await ctx.send(200, 'sent')
        try {
          ctx.cookies.set('a', '1')
        } catch (e) {
          error = e
        }
      }),
    )
    await fetch(url)
    expect(error).toBeInstanceOf(Error)
  })
})
