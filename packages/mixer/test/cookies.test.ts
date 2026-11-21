import { describe, expect, it } from 'vitest'
import { serve } from './helpers.js'

const setCookies = (res: Response) => res.headers.getSetCookie()

describe('ctx.cookies.get', () => {
  it('名前が完全一致する Cookie の値を返す', async () => {
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

  it('値を URL デコードし、壊れていれば生の値を返す。引用符は外す', async () => {
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

  it('同じ名前が複数あれば get は最初の値、getAll はすべてを返す', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        first: ctx.cookies.get('sid'),
        all: ctx.cookies.getAll('sid'),
      })),
    )
    const res = await fetch(url, { headers: { cookie: 'sid=1; sid=2' } })
    expect(await res.json()).toEqual({ first: '1', all: ['1', '2'] })
  })

  it('__proto__ という名前の Cookie も安全に扱う', async () => {
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
  it('安全な既定値で Set-Cookie を付ける', async () => {
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

  it('属性を指定でき、値はエンコードする', async () => {
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

  it('既存の Set-Cookie を消さずに追加する', async () => {
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

  it('同じ名前・Path・Domain を設定し直すと後の値で置き換える', async () => {
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

  it('エラー応答にも Set-Cookie が残る', async () => {
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
  it('同じ Path・Domain で、期限切れの Cookie を送る', async () => {
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

describe('検証', () => {
  const cases: [
    string,
    (cookies: import('../src/index.js').Context['cookies']) => void,
  ][] = [
    ['名前に ; を含む', (c) => c.set('a;b', 'x')],
    ['名前が空', (c) => c.set('', 'x')],
    ['名前に改行を含む', (c) => c.set('a\r\nSet-Cookie: evil', 'x')],
    ['path に ; を含む', (c) => c.set('a', 'x', { path: '/; Domain=evil' })],
    ['path が / で始まらない', (c) => c.set('a', 'x', { path: 'app' })],
    ['domain に ; を含む', (c) => c.set('a', 'x', { domain: 'a.com; Secure' })],
    ['maxAge が小数', (c) => c.set('a', 'x', { maxAge: 1.5 })],
    [
      'maxAge が無限大',
      (c) => c.set('a', 'x', { maxAge: Number.POSITIVE_INFINITY }),
    ],
    [
      'expires が不正な日付',
      (c) => c.set('a', 'x', { expires: new Date('nope') }),
    ],
    ['sameSite が不正', (c) => c.set('a', 'x', { sameSite: 'Loose' as 'Lax' })],
    [
      'SameSite=None で Secure でない',
      (c) => c.set('a', 'x', { sameSite: 'None', secure: false }),
    ],
    [
      'Partitioned で Secure でない',
      (c) => c.set('a', 'x', { partitioned: true, secure: false }),
    ],
    [
      '__Secure- で Secure でない',
      (c) => c.set('__Secure-a', 'x', { secure: false }),
    ],
    [
      '__Host- で Domain を指定',
      (c) => c.set('__Host-a', 'x', { domain: 'example.com' }),
    ],
    [
      '__Host- で Path が / 以外',
      (c) => c.set('__Host-a', 'x', { path: '/app' }),
    ],
  ]

  it.each(cases)('%s 場合は例外を投げる', async (_label, act) => {
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

  it('応答を送った後の set は例外を投げる', async () => {
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
