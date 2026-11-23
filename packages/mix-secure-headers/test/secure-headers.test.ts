import { type Component, HttpError, Mixer } from '@imatomix/mixer'
import { describe, expect, it, vi } from 'vitest'
import { type SecureHeadersOptions, secureHeaders } from '../src/index.js'
import { app, call } from './helpers.js'

const ok = () => 'ok'

async function headersFor(
  options?: SecureHeadersOptions,
  ...components: Component[]
) {
  const res = await call(app(secureHeaders(options), ...components, ok))
  return res.headers
}

describe('defaults', () => {
  it('adds X-Frame-Options and Referrer-Policy only', async () => {
    const headers = await headersFor()
    expect(headers.get('x-frame-options')).toBe('DENY')
    expect(headers.get('referrer-policy')).toBe(
      'strict-origin-when-cross-origin',
    )
    for (const name of [
      'strict-transport-security',
      'content-security-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
      'permissions-policy',
      'x-xss-protection',
    ]) {
      expect(headers.get(name)).toBeNull()
    }
  })

  it('adds them to 404 responses when nothing matches', async () => {
    const res = await call(app(secureHeaders()))
    expect(res.status).toBe(404)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('adds them to HttpError responses', async () => {
    const res = await call(
      app(secureHeaders(), () => {
        throw new HttpError(403)
      }),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('adds them to responses from onError', async () => {
    const target = new Mixer({ onError: () => ({ custom: true }) }).mix(
      secureHeaders(),
      () => {
        throw new Error('boom')
      },
    )
    const res = await call(target)
    expect(await res.json()).toEqual({ custom: true })
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('adds them to the 500 when an onBeforeSend hook throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call(
      app(secureHeaders(), (ctx) => {
        ctx.onBeforeSend(() => {
          throw new Error('hook broke')
        })
        return 'ok'
      }),
    )
    expect(res.status).toBe(500)
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    consoleError.mockRestore()
  })

  it('adds them to a returned Response that lacks them', async () => {
    const res = await call(app(secureHeaders(), () => new Response('raw')))
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('overriding', () => {
  it('keeps a header a later component set', async () => {
    const headers = await headersFor(undefined, (ctx) => {
      ctx.headers.set('X-Frame-Options', 'SAMEORIGIN')
    })
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN')
  })

  it("keeps a returned Response's own header", async () => {
    const res = await call(
      app(
        secureHeaders(),
        () =>
          new Response('raw', {
            headers: { 'Referrer-Policy': 'no-referrer' },
          }),
      ),
    )
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('lets a later onResponseHeaders listener remove a header', async () => {
    const headers = await headersFor(undefined, (ctx) => {
      ctx.onResponseHeaders((headers) => headers.delete('X-Frame-Options'))
    })
    expect(headers.get('x-frame-options')).toBeNull()
  })

  it('turns off a default with false', async () => {
    const headers = await headersFor({
      frameOptions: false,
      referrerPolicy: false,
    })
    expect(headers.get('x-frame-options')).toBeNull()
    expect(headers.get('referrer-policy')).toBeNull()
  })

  it('changes the values of the defaults', async () => {
    const headers = await headersFor({
      frameOptions: 'SAMEORIGIN',
      referrerPolicy: 'no-referrer',
    })
    expect(headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
  })
})

describe('hsts', () => {
  it('sends one year without subdomains for true', async () => {
    const headers = await headersFor({ hsts: true })
    expect(headers.get('strict-transport-security')).toBe('max-age=31536000')
  })

  it('takes maxAge, includeSubDomains, and preload', async () => {
    const headers = await headersFor({
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    })
    expect(headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    )
  })

  it.each([
    { maxAge: -1 },
    { maxAge: 1.5 },
    { maxAge: 31536000, preload: true },
    { maxAge: 86400, includeSubDomains: true, preload: true },
  ])('rejects %j', (hsts) => {
    expect(() => secureHeaders({ hsts })).toThrow(/hsts/)
  })
})

describe('csp', () => {
  it('builds the header from directives', async () => {
    const headers = await headersFor({
      csp: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'https://img.example'],
        'upgrade-insecure-requests': [],
      },
    })
    expect(headers.get('content-security-policy')).toBe(
      "default-src 'self'; img-src 'self' https://img.example; upgrade-insecure-requests",
    )
  })

  it('takes a string as is', async () => {
    const headers = await headersFor({ csp: "default-src 'none'" })
    expect(headers.get('content-security-policy')).toBe("default-src 'none'")
  })

  it.each([
    [{ 'default-src': ["'self'; script-src *"] }],
    [{ 'default-src': ["'self' *"] }],
    [{ 'default-src': ["'self',script-src *"] }],
    [{ 'default src': ["'self'"] }],
    [{ 'default-src;': ["'self'"] }],
    [{}],
    ["default-src 'self'\r\nX-Injected: 1"],
    [''],
  ])('rejects %j', (csp) => {
    expect(() => secureHeaders({ csp })).toThrow(/csp/)
  })
})

describe('other opt-in headers', () => {
  it('adds COOP, CORP, and Permissions-Policy when given', async () => {
    const headers = await headersFor({
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'same-site',
      permissionsPolicy: 'camera=(), geolocation=(self)',
    })
    expect(headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(headers.get('cross-origin-resource-policy')).toBe('same-site')
    expect(headers.get('permissions-policy')).toBe(
      'camera=(), geolocation=(self)',
    )
  })
})

describe('invalid options', () => {
  it.each<[SecureHeadersOptions, RegExp]>([
    [{ frameOptions: 'ALLOW-FROM x' as 'DENY' }, /frameOptions/],
    [{ referrerPolicy: 'everything' as 'no-referrer' }, /referrerPolicy/],
    [
      { crossOriginOpenerPolicy: 'open' as 'same-origin' },
      /crossOriginOpenerPolicy/,
    ],
    [
      { crossOriginResourcePolicy: 'any' as 'same-site' },
      /crossOriginResourcePolicy/,
    ],
    [{ permissionsPolicy: 'camera=()\nX: 1' }, /permissionsPolicy/],
  ])('rejects %j', (options, message) => {
    expect(() => secureHeaders(options)).toThrow(message)
  })
})
