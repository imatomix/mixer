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

describe('simple requests', () => {
  it('adds Access-Control-Allow-Origin: * by default and moves on', async () => {
    const url = await serve(cors(), ok)
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-credentials')).toBeNull()
    expect(res.headers.get('vary')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('adds no CORS headers when there is no Origin header', async () => {
    const url = await serve(cors(), ok)
    const res = await fetch(url)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(await res.text()).toBe('ok')
  })

  it('adds Vary: Origin even without an Origin header when origins are restricted', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('returns the allowed Origin and adds Vary: Origin', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://a.example',
    )
    expect(res.headers.get('vary')).toBe('Origin')
  })

  it('adds no CORS headers for a disallowed Origin but keeps processing', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, {
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
    const url = await serve(cors({ origin }), ok)
    const res = await fetch(url, { headers: { origin: 'https://b.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'https://b.example',
    )
  })

  it('gives the same result every time for a regular expression with the g flag', async () => {
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
    ['an unanchored', /https:\/\/a\.example/],
    ['an alternation (|)', /^https:\/\/a\.example|https:\/\/b\.example$/],
  ])(
    'allows an Origin only on a full match with %s regular expression',
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

  it('passes ctx to the origin function', async () => {
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

  it('does not allow an unintended Origin through a partial match', async () => {
    const url = await serve(cors({ origin: 'https://a.example' }), ok)
    const res = await fetch(url, {
      headers: { origin: 'https://a.example.evil' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('adds credentials and exposeHeaders', async () => {
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

  it('keeps CORS headers on error responses from later HttpErrors', async () => {
    const url = await serve(cors(), () => {
      throw new HttpError(403, 'Forbidden')
    })
    const res = await fetch(url, { headers: { origin: 'https://a.example' } })
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('preflight', () => {
  it('responds with 204 immediately and does not move on', async () => {
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

  it('allows the requested headers by default and adds them to Vary', async () => {
    const url = await serve(cors(), ok)
    const res = await preflight(url, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'content-type, authorization',
    )
    expect(res.headers.get('vary')).toContain('Access-Control-Request-Headers')
  })

  it('allows only the given allowHeaders', async () => {
    const url = await serve(cors({ allowHeaders: ['Content-Type'] }), ok)
    const res = await preflight(url, 'https://a.example', {
      'access-control-request-headers': 'content-type, authorization',
    })
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type')
  })

  it('accepts custom methods and maxAge', async () => {
    const url = await serve(cors({ methods: ['GET', 'POST'], maxAge: 60 }), ok)
    const res = await preflight(url, 'https://a.example')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(res.headers.get('access-control-max-age')).toBe('60')
  })

  it('returns 204 without CORS headers for a disallowed Origin', async () => {
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

  it('does not intercept OPTIONS requests that are not preflights', async () => {
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

describe('configuration validation', () => {
  it("throws at definition for origin: '*' with credentials: true", () => {
    expect(() => cors({ credentials: true })).toThrow()
    expect(() => cors({ origin: '*', credentials: true })).toThrow()
  })

  it.each([-1, 1.5, Number.NaN])('rejects an invalid maxAge (%s)', (maxAge) => {
    expect(() => cors({ maxAge })).toThrow()
  })
})
