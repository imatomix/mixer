import { type Context, HttpError } from '@imatomix/mixer'
import { describe, expect, it } from 'vitest'
import { cors } from '../src/index.js'
import { type App, app, call } from './helpers.js'

const ok = () => 'ok'

function preflight(
  target: App,
  origin: string,
  headers: Record<string, string> = {},
) {
  return call(target, '/', {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'PUT', ...headers },
  })
}

describe('simple requests', () => {
  it('adds Access-Control-Allow-Origin: * by default and moves on', async () => {
    const target = app(cors({ origin: '*' }), ok)
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('adds no CORS headers when there is no Origin header', async () => {
    const target = app(cors({ origin: '*' }), ok)
    const res = await call(target)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('adds Vary: Origin even without an Origin header when origins are restricted', async () => {
    const target = app(cors({ origin: 'https://a.example' }), ok)
    const res = await call(target)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('returns the allowed Origin and adds Vary: Origin', async () => {
    const target = app(cors({ origin: 'https://a.example' }), ok)
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://a.example',
    )
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('adds no CORS headers for a disallowed Origin but keeps processing', async () => {
    const target = app(cors({ origin: 'https://a.example' }), ok)
    const res = await call(target, '/', {
      headers: { origin: 'https://evil.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
    expect(await res.text()).toBe('ok')
  })

  it.each([
    ['an array', ['https://a.example', 'https://b.example']],
    ['a regular expression', /^https:\/\/[a-z]+\.example$/],
    ['a function', (origin: string) => origin.endsWith('.example')],
    [
      'an async function',
      async (origin: string) => origin === 'https://b.example',
    ],
  ] as const)('accepts %s as origin', async (_label, origin) => {
    const target = app(cors({ origin }), ok)
    const res = await call(target, '/', {
      headers: { origin: 'https://b.example' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://b.example',
    )
  })

  it('gives the same result every time for a regular expression with the g flag', async () => {
    const target = app(cors({ origin: [/^https:\/\/a\.example$/g] }), ok)
    const headers = { origin: 'https://a.example' }
    for (let i = 0; i < 3; i++) {
      const res = await call(target, '/', { headers })
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://a.example',
      )
    }
  })

  it.each([
    ['an unanchored', /https:\/\/a\.example/],
    ['an alternation (|)', /^https:\/\/a\.example|https:\/\/b\.example$/],
  ])(
    'allows an Origin only on a full match with %s regular expression',
    async (_label, origin) => {
      const target = app(cors({ origin }), ok)
      const allowed = await call(target, '/', {
        headers: { origin: 'https://a.example' },
      })
      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://a.example',
      )
      for (const evil of [
        'https://a.example.evil',
        'https://evil.test?https://a.example',
      ]) {
        const res = await call(target, '/', { headers: { origin: evil } })
        expect(res.headers.get('access-control-allow-origin')).toBeNull()
      }
    },
  )

  it('passes ctx to the origin function', async () => {
    const target = app(
      cors({
        origin: (_origin, ctx: Context) => ctx.path.startsWith('/public'),
      }),
      ok,
    )
    const headers = { origin: 'https://a.example' }
    expect(
      (await call(target, '/public', { headers })).headers.get(
        'access-control-allow-origin',
      ),
    ).toBe('https://a.example')
    expect(
      (await call(target, '/private', { headers })).headers.get(
        'access-control-allow-origin',
      ),
    ).toBeNull()
  })

  it('does not allow an unintended Origin through a partial match', async () => {
    const target = app(cors({ origin: 'https://a.example' }), ok)
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example.evil' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('adds credentials and exposeHeaders', async () => {
    const target = app(
      cors({
        origin: 'https://a.example',
        credentials: true,
        exposeHeaders: ['X-Total-Count', 'X-Request-Id'],
      }),
      ok,
    )
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('access-control-expose-headers')).toBe(
      'X-Total-Count, X-Request-Id',
    )
  })

  it('keeps CORS headers on error responses from later HttpErrors', async () => {
    const target = app(cors({ origin: '*' }), () => {
      throw new HttpError(403, 'Forbidden')
    })
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('keeps the allowed Origin, credentials, and Vary on error responses', async () => {
    const target = app(
      cors({ origin: 'https://a.example', credentials: true }),
      () => {
        throw new HttpError(403, 'Forbidden')
      },
    )
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://a.example',
    )
    expect(res.headers.get('access-control-allow-credentials')).toBe('true')
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('adds CORS headers to a Response returned by a later component', async () => {
    const target = app(
      cors({ origin: 'https://a.example' }),
      () => new Response('raw', { headers: { Vary: 'Accept-Encoding' } }),
    )
    const res = await call(target, '/', {
      headers: { origin: 'https://a.example' },
    })
    expect(await res.text()).toBe('raw')
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://a.example',
    )
    expect(res.headers.get('vary')).toContain('Origin')
    expect(res.headers.get('vary')).toContain('Accept-Encoding')
  })
})

describe('preflight', () => {
  it('responds with 204 immediately and does not move on', async () => {
    let reached = false
    const target = app(cors({ origin: '*' }), () => {
      reached = true
      return 'should not reach'
    })
    const res = await preflight(target, 'https://a.example')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toBe(
      'GET, HEAD, POST, PUT, PATCH, DELETE',
    )
    expect(res.headers.get('access-control-max-age')).toBe('600')
    expect(reached).toBe(false)
  })

  it('allows the requested headers by default and adds them to Vary', async () => {
    const target = app(cors({ origin: '*' }), ok)
    const res = await preflight(target, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'content-type, authorization',
    )
    expect(res.headers.get('vary')).toContain('Access-Control-Request-Headers')
  })

  it('allows only the given allowHeaders', async () => {
    const target = app(
      cors({ origin: '*', allowHeaders: ['Content-Type'] }),
      ok,
    )
    const res = await preflight(target, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type')
  })

  it('accepts custom methods and maxAge', async () => {
    const target = app(
      cors({ origin: '*', methods: ['GET', 'POST'], maxAge: 60 }),
      ok,
    )
    const res = await preflight(target, 'https://a.example')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(res.headers.get('access-control-max-age')).toBe('60')
  })

  it('returns 204 without CORS headers for a disallowed Origin', async () => {
    let reached = false
    const target = app(cors({ origin: 'https://a.example' }), () => {
      reached = true
    })
    const res = await preflight(target, 'https://evil.example')
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('access-control-allow-methods')).toBeNull()
    expect(reached).toBe(false)
  })

  it('does not intercept OPTIONS requests that are not preflights', async () => {
    const target = app(cors({ origin: '*' }), (ctx) =>
      ctx.method === 'OPTIONS' ? 'app options' : undefined,
    )
    const withoutRequestMethod = await call(target, '/', {
      method: 'OPTIONS',
      headers: { origin: 'https://a.example' },
    })
    expect(await withoutRequestMethod.text()).toBe('app options')
    const withoutOrigin = await call(target, '/', { method: 'OPTIONS' })
    expect(await withoutOrigin.text()).toBe('app options')
  })
})

describe('configuration validation', () => {
  it('requires origin, so that allowing every site is a choice written in code', () => {
    // @ts-expect-error origin is required
    expect(() => cors()).toThrow(/origin/)
    // @ts-expect-error origin is required
    expect(() => cors({})).toThrow(/origin/)
    // @ts-expect-error origin is required
    expect(() => cors({})).toThrow(TypeError)
    expect(() => cors({ origin: '*' })).not.toThrow()
  })

  it("throws at definition for origin: '*' with credentials: true", () => {
    expect(() => cors({ origin: '*', credentials: true })).toThrow(
      /credentials/,
    )
    expect(() => cors({ origin: '*', credentials: true })).toThrow(TypeError)
  })

  it.each([-1, 1.5, Number.NaN])('rejects an invalid maxAge (%s)', (maxAge) => {
    expect(() => cors({ origin: '*', maxAge })).toThrow(/maxAge/)
    expect(() => cors({ origin: '*', maxAge })).toThrow(RangeError)
  })
})
