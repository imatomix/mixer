import { describe, expect, it } from 'vitest'
import { type CsrfOptions, csrf } from '../src/index.js'
import { app, call } from './helpers.js'

const ok = () => 'ok'

function send(
  headers: Record<string, string>,
  { method = 'POST', options }: { method?: string; options?: CsrfOptions } = {},
) {
  return call(app(csrf(options), ok), '/', { method, headers })
}

describe('safe methods', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets %s through from another site',
    async (method) => {
      const res = await send(
        { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        { method },
      )
      expect(res.status).toBe(200)
    },
  )
})

describe('Sec-Fetch-Site', () => {
  it.each(['same-origin', 'none'])('lets %s through', async (site) => {
    const res = await send({ 'sec-fetch-site': site })
    expect(res.status).toBe(200)
  })

  it.each(['cross-site', 'same-site', 'unknown', ''])(
    'rejects %j with 403',
    async (site) => {
      const res = await send({
        'sec-fetch-site': site,
        origin: 'http://localhost',
      })
      expect(res.status).toBe(403)
      expect(await res.text()).not.toBe('ok')
    },
  )

  it('is preferred over a matching Origin', async () => {
    const res = await send({
      'sec-fetch-site': 'cross-site',
      origin: 'http://localhost',
    })
    expect(res.status).toBe(403)
  })

  it.each(['PUT', 'PATCH', 'DELETE', 'PROPFIND'])(
    'checks %s',
    async (method) => {
      const res = await send({ 'sec-fetch-site': 'cross-site' }, { method })
      expect(res.status).toBe(403)
    },
  )

  it('checks every content type, including text/ping', async () => {
    const res = await send({
      'sec-fetch-site': 'cross-site',
      'content-type': 'text/ping',
    })
    expect(res.status).toBe(403)
  })
})

describe('Origin without Sec-Fetch-Site', () => {
  it('lets the same host through', async () => {
    expect((await send({ origin: 'http://localhost' })).status).toBe(200)
  })

  it.each([
    'https://evil.example',
    'http://localhost:8080',
    'http://sub.localhost',
    'null',
    'not a url',
  ])('rejects %j', async (origin) => {
    expect((await send({ origin })).status).toBe(403)
  })
})

describe('without Sec-Fetch-Site or Origin', () => {
  it('lets the request through as a non-browser client', async () => {
    expect((await send({})).status).toBe(200)
  })
})

describe('trustedOrigins', () => {
  const options = { trustedOrigins: ['https://admin.example'] }

  it('lets a trusted origin through even when the browser says cross-site', async () => {
    const res = await send(
      { 'sec-fetch-site': 'cross-site', origin: 'https://admin.example' },
      { options },
    )
    expect(res.status).toBe(200)
  })

  it('lets a trusted origin through without Sec-Fetch-Site', async () => {
    const res = await send({ origin: 'https://admin.example' }, { options })
    expect(res.status).toBe(200)
  })

  it('compares the whole origin', async () => {
    const res = await send(
      { 'sec-fetch-site': 'cross-site', origin: 'http://admin.example' },
      { options },
    )
    expect(res.status).toBe(403)
  })

  it.each([
    'null',
    '*',
    'admin.example',
    'https://admin.example/',
    'https://admin.example/path',
    'https://*.example',
    'https://Admin.example',
  ])('rejects %j when the app is built', (origin) => {
    expect(() => csrf({ trustedOrigins: [origin] })).toThrow(/trustedOrigins/)
  })
})

describe('allow', () => {
  it('lets requests it accepts through without checking', async () => {
    const target = app(
      csrf({ allow: (ctx) => ctx.url.pathname.startsWith('/webhooks/') }),
      ok,
    )
    const headers = { 'sec-fetch-site': 'cross-site' }
    expect(
      (await call(target, '/webhooks/a', { method: 'POST', headers })).status,
    ).toBe(200)
    expect(
      (await call(target, '/other', { method: 'POST', headers })).status,
    ).toBe(403)
  })

  it('may be async', async () => {
    const res = await send(
      { 'sec-fetch-site': 'cross-site' },
      { options: { allow: async () => true } },
    )
    expect(res.status).toBe(200)
  })
})
