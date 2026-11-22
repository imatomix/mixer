import { describe, expect, it } from 'vitest'
import { Mixer, redirect } from '../src/index.js'
import { call } from './helpers.js'

const respond = (make: () => Response) => call(new Mixer().mix(make))

describe('redirect', () => {
  it('answers 302 with the path in Location and no body', async () => {
    const res = await respond(() => redirect('/login'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
    expect(await res.text()).toBe('')
  })

  it('takes 301, 303, 307, and 308, and rejects other statuses', async () => {
    for (const status of [301, 303, 307, 308] as const) {
      expect((await respond(() => redirect('/a', { status }))).status).toBe(
        status,
      )
    }
    expect(() => redirect('/a', { status: 200 as never })).toThrow(/status/)
  })

  it('keeps the query and fragment, and encodes characters a header cannot carry', async () => {
    const res = await respond(() => redirect('/ジュース?q=1#top'))
    expect(res.headers.get('location')).toBe(
      `/${encodeURIComponent('ジュース')}?q=1#top`,
    )
  })

  it.each([
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/%2F%2Fevil.example',
    '/%2f/evil.example',
    '/%5Cevil.example',
    '/a%0Ab',
    '/a b',
    '/a\tb',
    '/\nevil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'login',
    './login',
    '/./a',
    '/a/../b',
    '/%2e%2e/b',
    '/%zz',
    '',
    `/${'a'.repeat(9_000)}`,
  ])('rejects %j by default', (location) => {
    expect(() => redirect(location)).toThrow(/unsafe redirect location/)
  })

  it('uses fallback instead of an unsafe or missing location', async () => {
    for (const location of ['//evil.example', null, undefined]) {
      const res = await respond(() => redirect(location, { fallback: '/' }))
      expect(res.headers.get('location')).toBe('/')
    }
    expect(redirect('/next', { fallback: '/' }).headers.get('location')).toBe(
      '/next',
    )
  })

  it('throws for an unsafe fallback', () => {
    expect(() => redirect('/a', { fallback: 'https://evil.example' })).toThrow(
      /unsafe redirect location/,
    )
  })

  it('allows only the exact origins listed in allowedOrigins', () => {
    const allowedOrigins = ['https://accounts.example.com']
    expect(
      redirect('https://accounts.example.com/login?x=1', {
        allowedOrigins,
      }).headers.get('location'),
    ).toBe('https://accounts.example.com/login?x=1')
    for (const location of [
      'https://accounts.example.com.evil/login',
      'http://accounts.example.com/login',
      'https://user@accounts.example.com/login',
      'https://evil.example',
    ]) {
      expect(() => redirect(location, { allowedOrigins })).toThrow(
        /unsafe redirect location/,
      )
    }
    expect(
      redirect('https://evil.example', {
        allowedOrigins,
        fallback: '/',
      }).headers.get('location'),
    ).toBe('/')
  })

  it.each([
    'https://example.com/path',
    'https://example.com?q=1',
    'https://user:pass@example.com',
    'ftp://example.com',
    'https://*.example.com',
    'example.com',
  ])(
    'rejects an allowedOrigins entry that is not a plain origin (%s)',
    (origin) => {
      expect(() => redirect('/a', { allowedOrigins: [origin] })).toThrow(
        /allowedOrigins/,
      )
    },
  )

  it('keeps cookies set before redirecting, out of shared caches', async () => {
    const res = await call(
      new Mixer().mix((ctx) => {
        ctx.cookies.set('session', 'abc')
        return redirect('/home', { status: 303 })
      }),
    )
    expect(res.status).toBe(303)
    expect(res.headers.getSetCookie()[0]).toMatch(/^session=abc;/)
    expect(res.headers.get('cache-control')).toBe('private')
  })

  it('does not add basePath to the location', async () => {
    const res = await call(
      new Mixer({ basePath: '/app' }).mix(() => redirect('/login')),
      '/app/x',
    )
    expect(res.headers.get('location')).toBe('/login')
  })

  it('does not put the rejected location into the error message unescaped', () => {
    expect(() => redirect('/a\r\nX-Injected: 1')).toThrow(
      /unsafe redirect location/,
    )
    let message = ''
    try {
      redirect('/a\r\nX-Injected: 1')
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toMatch(/[\r\n]/)
  })
})
