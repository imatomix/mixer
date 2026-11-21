import { type Context, HttpError } from '@imatomix/mixer'
import { describe, expect, it } from 'vitest'
import { cors } from '../src/index.js'
import { serve } from './helpers.js'

const ok = () => 'ok'

function preflight(
  url: string,
  origin: string,
  headers: Record<string, string> = {},
) {
  return fetch(url, {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'PUT', ...headers },
  })
}

describe('通常のリクエスト', () => {
  it('既定では Access-Control-Allow-Origin: * を付けて次へ進む', async () => {
    const url = await serve(cors(), ok)
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('Origin ヘッダがなければ CORS ヘッダを付けない', async () => {
    const url = await serve(cors(), ok)
    const res = await fetch(url)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('origin を限定しているときは、Origin ヘッダがなくても Vary: Origin を付ける', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('許可した Origin を返し、Vary: Origin を付ける', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://a.example',
    )
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('許可していない Origin には CORS ヘッダを付けないが、処理は続ける', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, {
      headers: { origin: 'https://evil.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
    expect(await res.text()).toBe('ok')
  })

  it.each([
    ['配列', ['https://a.example', 'https://b.example']],
    ['正規表現', /^https:\/\/[a-z]+\.example$/],
    ['関数', (origin: string) => origin.endsWith('.example')],
    ['非同期関数', async (origin: string) => origin === 'https://b.example'],
  ] as const)('origin に%sを指定できる', async (_label, origin) => {
    const url = await serve(cors({ origin }), ok)
    const res = await fetch(url, { headers: { origin: 'https://b.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://b.example',
    )
  })

  it('g フラグ付きの正規表現でも毎回同じ判定をする', async () => {
    const url = await serve(cors({ origin: [/^https:\/\/a\.example$/g] }), ok)
    const headers = { origin: 'https://a.example' }
    for (let i = 0; i < 3; i++) {
      const res = await fetch(url, { headers })
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://a.example',
      )
    }
  })

  it.each([
    ['アンカーなしの', /https:\/\/a\.example/],
    ['選択（|）を含む', /^https:\/\/a\.example|https:\/\/b\.example$/],
  ])(
    '%s正規表現でも Origin 全体と一致したときだけ許可する',
    async (_label, origin) => {
      const url = await serve(cors({ origin }), ok)
      const allowed = await fetch(url, {
        headers: { origin: 'https://a.example' },
      })
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://a.example',
      )
      for (const evil of [
        'https://a.example.evil',
        'https://evil.test?https://a.example',
      ]) {
        const res = await fetch(url, { headers: { origin: evil } })
        expect(res.headers.get('access-control-allow-origin')).toBeNull()
      }
    },
  )

  it('origin の関数は ctx を受け取る', async () => {
    const url = await serve(
      cors({
        origin: (_origin, ctx: Context) =>
          ctx.url.pathname.startsWith('/public'),
      }),
      ok,
    )
    const headers = { origin: 'https://a.example' }
    expect(
      (await fetch(`${url}/public`, { headers })).headers.get(
        'access-control-allow-origin',
      ),
    ).toBe('https://a.example')
    expect(
      (await fetch(`${url}/private`, { headers })).headers.get(
        'access-control-allow-origin',
      ),
    ).toBeNull()
  })

  it('正規表現の部分一致で意図しない Origin を許可しない', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, {
      headers: { origin: 'https://a.example.evil' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('credentials と exposeHeaders を付ける', async () => {
    const url = await serve(
      cors({
        origin: 'https://a.example',
        credentials: true,
        exposeHeaders: ['X-Total-Count', 'X-Request-Id'],
      }),
      ok,
    )
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-expose-headers')).toBe(
      'X-Total-Count, X-Request-Id',
    )
  })

  it('後続で HttpError になってもエラー応答に CORS ヘッダが残る', async () => {
    const url = await serve(cors(), () => {
      throw new HttpError(403, 'Forbidden')
    })
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('preflight', () => {
  it('その場で 204 を返し、後続には進まない', async () => {
    let reached = false
    const url = await serve(cors(), () => {
      reached = true
      return 'should not reach'
    })
    const res = await preflight(url, 'https://a.example')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toBe(
      'GET, HEAD, POST, PUT, PATCH, DELETE',
    )
    expect(res.headers.get('access-control-max-age')).toBe('600')
    expect(reached).toBe(false)
  })

  it('既定ではリクエストされたヘッダを許可し、Vary に加える', async () => {
    const url = await serve(cors(), ok)
    const res = await preflight(url, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'content-type, authorization',
    )
    expect(res.headers.get('vary')).toContain('Access-Control-Request-Headers')
  })

  it('allowHeaders を指定するとそれだけを許可する', async () => {
    const url = await serve(cors({ allowHeaders: ['Content-Type'] }), ok)
    const res = await preflight(url, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type')
  })

  it('methods と maxAge を変更できる', async () => {
    const url = await serve(cors({ methods: ['GET', 'POST'], maxAge: 60 }), ok)
    const res = await preflight(url, 'https://a.example')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(res.headers.get('access-control-max-age')).toBe('60')
  })

  it('許可していない Origin には CORS ヘッダなしの 204 を返す', async () => {
    let reached = false
    const url = await serve(cors({ origin: 'https://a.example' }), () => {
      reached = true
    })
    const res = await preflight(url, 'https://evil.example')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(reached).toBe(false)
  })

  it('preflight ではない OPTIONS は横取りせず次へ進む', async () => {
    const url = await serve(cors(), (ctx) =>
      ctx.method === 'OPTIONS' ? 'app options' : undefined,
    )
    const withoutRequestMethod = await fetch(url, {
      method: 'OPTIONS',
      headers: { origin: 'https://a.example' },
    })
    expect(await withoutRequestMethod.text()).toBe('app options')
    const withoutOrigin = await fetch(url, { method: 'OPTIONS' })
    expect(await withoutOrigin.text()).toBe('app options')
  })
})

describe('設定の検証', () => {
  it("origin: '*' と credentials: true の組み合わせは定義時にエラーになる", () => {
    expect(() => cors({ credentials: true })).toThrow()
    expect(() => cors({ origin: '*', credentials: true })).toThrow()
  })

  it.each([-1, 1.5, Number.NaN])(
    'maxAge に不正な値（%s）は指定できない',
    (maxAge) => {
      expect(() => cors({ maxAge })).toThrow()
    },
  )
})
