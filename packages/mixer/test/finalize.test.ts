import { describe, expect, it, vi } from 'vitest'
import { Mixer } from '../src/index.js'
import { call, trackedStream } from './helpers.js'

const respondWith = (value: unknown) => new Mixer().mix(() => value)

describe('return values', () => {
  it('returns a string as text/plain with Content-Length', async () => {
    const res = await call(respondWith('hello'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('hello')
  })

  it('sets Content-Length in bytes for multibyte characters', async () => {
    const res = await call(respondWith('こんにちは'))
    expect(res.headers.get('content-length')).toBe('15')
    expect(await res.text()).toBe('こんにちは')
  })

  it('returns objects, numbers, and booleans as JSON', async () => {
    const res = await call(respondWith({ ok: true }))
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(await res.json()).toEqual({ ok: true })
    expect(await (await call(respondWith(0))).json()).toBe(0)
    expect(await (await call(respondWith(false))).json()).toBe(false)
  })

  it('returns an empty string as a value', async () => {
    const res = await call(respondWith(''))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('returns 204 for null', async () => {
    const res = await call(respondWith(null))
    expect(res.status).toBe(204)
    expect(res.headers.get('content-type')).toBeNull()
    expect(res.headers.get('content-length')).toBeNull()
  })

  it('keeps a custom status for null, such as 304, and keeps ETag', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.status = 304
      ctx.headers.set('ETag', 'W/"1"')
      ctx.headers.set('Content-Type', 'text/plain')
      return null
    })
    const res = await call(app)
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('W/"1"')
    expect(res.headers.get('content-type')).toBeNull()
    expect(await res.text()).toBe('')
  })

  it.each([204, 205, 304])(
    'cancels a stream returned with the bodyless status %s',
    async (status) => {
      const { stream, state } = trackedStream(['never'])
      const app = new Mixer().mix((ctx) => {
        ctx.status = status
        return stream
      })
      const res = await call(app)
      expect(res.status).toBe(status)
      expect(await res.text()).toBe('')
      expect(state.cancelled).toBe(true)
    },
  )

  it('returns bytes as octet-stream', async () => {
    const res = await call(respondWith(new Uint8Array([1, 2, 3])))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-length')).toBe('3')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it('streams a ReadableStream', async () => {
    const { stream } = trackedStream(['a', 'b'])
    const res = await call(respondWith(stream))
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(await res.text()).toBe('ab')
  })

  it('uses the type of a Blob', async () => {
    const res = await call(respondWith(new Blob(['x'], { type: 'text/csv' })))
    expect(res.headers.get('content-type')).toBe('text/csv')
  })

  it('does not override a Content-Type set on the draft', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Content-Type', 'text/html; charset=utf-8')
      return '<h1>hi</h1>'
    })
    expect((await call(app)).headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    )
  })

  it('uses ctx.status for returned values', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.status = 201
      return { created: true }
    })
    expect((await call(app)).status).toBe(201)
  })
})

describe('returning a Response', () => {
  it('prefers its own headers and adds missing draft headers', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Access-Control-Allow-Origin', '*')
      ctx.headers.set('X-Shared', 'draft')
      return new Response('direct', {
        status: 201,
        headers: { 'X-Shared': 'response' },
      })
    })
    const res = await call(app)
    expect(res.status).toBe(201)
    expect(res.headers.get('x-shared')).toBe('response')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.text()).toBe('direct')
  })

  it('merges draft headers into a Response whose headers are immutable', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Access-Control-Allow-Origin', '*')
      return Response.redirect('http://localhost/next', 302)
    })
    const res = await call(app)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost/next')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('turns Response.error() into 500', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call(respondWith(Response.error()))).status).toBe(500)
    error.mockRestore()
  })

  it('turns a Response whose body was already read into 500', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const used = new Response('used')
    await used.text()
    expect((await call(respondWith(used))).status).toBe(500)
    error.mockRestore()
  })

  it('keeps Set-Cookie from both, and the Response wins for the same cookie', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('a', 'draft')
      ctx.cookies.set('b', 'draft')
      const headers = new Headers()
      headers.append('Set-Cookie', 'b=response; Path=/')
      headers.append('Set-Cookie', 'c=response; Path=/')
      return new Response('ok', { headers })
    })
    const cookies = (await call(app)).headers.getSetCookie()
    expect(cookies.find((c) => c.startsWith('a='))).toMatch(/^a=draft;/)
    expect(cookies.filter((c) => c.startsWith('b='))).toEqual([
      'b=response; Path=/',
    ])
    expect(cookies.find((c) => c.startsWith('c='))).toBe('c=response; Path=/')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('cookies without a Path on a returned Response', () => {
  it('resolves the default path from the request path before deduplicating', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('sid', 'draft')
      return new Response('ok', { headers: { 'Set-Cookie': 'sid=returned' } })
    })
    const cookies = (await call(app, '/account/login')).headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies.some((c) => c.startsWith('sid=draft;'))).toBe(true)
    expect(cookies).toContain('sid=returned')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('compares whole Path values that contain =', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('sid', 'draft', { path: '/a=b' })
      return new Response('ok', {
        headers: { 'Set-Cookie': 'sid=returned; Path=/a=c' },
      })
    })
    const cookies = (await call(app)).headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('treats a missing Path at the root as Path=/', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('sid', 'draft')
      return new Response('ok', { headers: { 'Set-Cookie': 'sid=returned' } })
    })
    const cookies = (await call(app, '/login')).headers.getSetCookie()
    expect(cookies).toEqual(['sid=returned'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('finalizing', () => {
  it('always sets X-Content-Type-Options: nosniff', async () => {
    expect(
      (await call(respondWith('x'))).headers.get('x-content-type-options'),
    ).toBe('nosniff')
    const res = await call(
      respondWith(
        new Response('x', { headers: { 'X-Content-Type-Options': 'sniff' } }),
      ),
    )
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('forces Cache-Control: private on responses that set cookies', async () => {
    const res = await call(
      respondWith(
        new Response('x', {
          headers: {
            'Set-Cookie': 'sid=1; Path=/',
            'Cache-Control': 'public, max-age=60',
          },
        }),
      ),
    )
    const cacheControl = res.headers.get('cache-control') ?? ''
    expect(cacheControl).toContain('private')
    expect(cacheControl).not.toContain('public')
  })

  it('keeps Cache-Control: no-store on responses that set cookies', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.cookies.set('a', '1')
      ctx.headers.set('Cache-Control', 'no-store')
      return 'ok'
    })
    expect((await call(app)).headers.get('cache-control')).toBe('no-store')
  })

  it('drops the body for HEAD, cancels the stream, and keeps Content-Length', async () => {
    const { stream, state } = trackedStream(['hello'])
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Content-Length', '5')
      return stream
    })
    const res = await call(app, '/', { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('')
    expect(state.cancelled).toBe(true)
  })

  it('keeps Content-Type and Content-Length for HEAD of a string', async () => {
    const res = await call(respondWith('hello'), '/', { method: 'HEAD' })
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('')
  })
})
