import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Component, HttpError, Mixer } from '../src/index.js'
import { call } from './helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

describe('chaining components', () => {
  it('runs components in mix order and stops at the first returned value', async () => {
    const calls: string[] = []
    const app = new Mixer()
      .mix(() => {
        calls.push('a')
      })
      .mix(
        () => {
          calls.push('b')
          return 'done'
        },
        () => {
          calls.push('c')
        },
      )
    expect(await (await call(app)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('passes values to later components through ctx.state', async () => {
    const app = new Mixer<{ user?: string }>()
      .mix((ctx) => {
        ctx.state.user = 'imatomix'
      })
      .mix((ctx) => `hello ${ctx.state.user}`)
    expect(await (await call(app)).text()).toBe('hello imatomix')
  })

  it('exposes the request, URL, and method', async () => {
    const app = new Mixer().mix((ctx) => ({
      method: ctx.method,
      pathname: ctx.url.pathname,
      query: ctx.url.searchParams.get('q'),
      header: ctx.request.headers.get('x-test'),
    }))
    const res = await call(app, '/a?q=1', {
      method: 'POST',
      headers: { 'x-test': 'yes' },
    })
    expect(await res.json()).toEqual({
      method: 'POST',
      pathname: '/a',
      query: '1',
      header: 'yes',
    })
  })

  it('returns 404 when no component responds', async () => {
    const res = await call(new Mixer().mix(() => {}))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not Found' })
  })

  it('works when fetch is detached from the app', async () => {
    const { fetch } = new Mixer().mix(() => 'detached')
    expect(await (await fetch(new Request('http://localhost/'))).text()).toBe(
      'detached',
    )
  })
})

describe('error handling', () => {
  it('returns the status and message of an HttpError', async () => {
    const app = new Mixer().mix(() => {
      throw new HttpError(403, 'Forbidden')
    })
    const res = await call(app)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('turns unexpected errors into 500 and hides the details', async () => {
    const error = quiet()
    const app = new Mixer().mix(() => {
      throw new Error('secret detail')
    })
    const res = await call(app)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(error).toHaveBeenCalled()
  })

  it('builds error responses from fresh headers, so nothing meant for the normal response leaks', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Access-Control-Allow-Origin', '*')
      ctx.headers.set('Location', '/elsewhere')
      ctx.headers.set('Cache-Control', 'public, max-age=60')
      ctx.cookies.set('a', '1')
      throw new HttpError(403)
    })
    const res = await call(app)
    expect(res.status).toBe(403)
    for (const name of [
      'access-control-allow-origin',
      'location',
      'cache-control',
    ]) {
      expect(res.headers.get(name)).toBeNull()
    }
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('sends headers given to an HttpError, such as Retry-After', async () => {
    const app = new Mixer().mix(() => {
      throw new HttpError(429, 'Too Many Requests', {
        headers: { 'Retry-After': '60' },
      })
    })
    const res = await call(app)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
    expect(await res.json()).toEqual({ error: 'Too Many Requests' })
  })

  it('keeps HttpError headers when onError builds the response', async () => {
    const app = new Mixer({
      onError: (_error, ctx) => ({ auth: ctx.headers.get('www-authenticate') }),
    }).mix(() => {
      throw new HttpError(401, 'Unauthorized', {
        headers: { 'WWW-Authenticate': 'Bearer' },
      })
    })
    const res = await call(app)
    expect(res.headers.get('www-authenticate')).toBe('Bearer')
    expect(await res.json()).toEqual({ auth: 'Bearer' })
  })

  it('keeps HttpError headers when onError falls back to the default response', async () => {
    const app = new Mixer({ onError: () => undefined }).mix(() => {
      throw new HttpError(405, undefined, { headers: { Allow: 'GET, HEAD' } })
    })
    const res = await call(app)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('sends the HttpError cookies once when onError falls back to the default response, without its own edits', async () => {
    quiet()
    const app = new Mixer({
      onError: (_error, ctx) => {
        ctx.cookies.delete('token')
        return undefined
      },
    }).mix(() => {
      throw new HttpError(401, undefined, {
        headers: { 'Set-Cookie': 'token=active; Path=/' },
      })
    })
    expect((await call(app)).headers.getSetCookie()).toEqual([
      'token=active; Path=/',
    ])
  })

  it('uses only the Vary of the HttpError, not one set before the error', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Vary', 'Origin')
      throw new HttpError(406, undefined, {
        headers: { Vary: 'Accept-Language' },
      })
    })
    expect((await call(app)).headers.get('vary')).toBe('Accept-Language')
  })

  it('exposes the headers of an HttpError and rejects invalid values', () => {
    const error = new HttpError(405, undefined, { headers: { Allow: 'GET' } })
    expect(error.headers.get('allow')).toBe('GET')
    expect(new HttpError(400).headers).toBeInstanceOf(Headers)
    expect(
      () =>
        new HttpError(400, undefined, {
          headers: { 'X-Bad': 'a\r\nSet-Cookie: x=1' },
        }),
    ).toThrow(TypeError)
  })

  it('lets onError return a value that goes through finalizing', async () => {
    const app = new Mixer({
      onError: (error, ctx) => {
        expect(ctx.status).toBe(500)
        return { message: (error as Error).message }
      },
    }).mix(() => {
      throw new Error('boom')
    })
    const res = await call(app)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ message: 'boom' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('starts onError with the status of an HttpError', async () => {
    const app = new Mixer({
      onError: (_error, ctx) => ({ status: ctx.status }),
    }).mix(() => {
      throw new HttpError(409)
    })
    const res = await call(app)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ status: 409 })
  })

  it.each([
    ['returns undefined', () => undefined],
    [
      'throws',
      () => {
        throw new Error('handler failed')
      },
    ],
  ])(
    'uses the default error response when onError %s',
    async (_label, onError) => {
      quiet()
      const app = new Mixer({ onError }).mix(() => {
        throw new Error('boom')
      })
      const res = await call(app)
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    },
  )

  it.each([200, 302, 99, 600, 404.5])(
    'HttpError rejects a status that is not 4xx or 5xx (%s)',
    (status) => {
      expect(() => new HttpError(status)).toThrow(RangeError)
    },
  )
})

describe('basePath', () => {
  const app = new Mixer({ basePath: '/api' }).mix((ctx) => ({ path: ctx.path }))

  it('removes basePath from ctx.path', async () => {
    expect(await (await call(app, '/api/users')).json()).toEqual({
      path: '/users',
    })
    expect(await (await call(app, '/api')).json()).toEqual({ path: '/' })
  })

  it('returns 404 outside basePath, comparing segment by segment', async () => {
    expect((await call(app, '/apix/users')).status).toBe(404)
    expect((await call(app, '/other')).status).toBe(404)
  })

  it('uses the whole path as ctx.path without basePath', async () => {
    const plain = new Mixer().mix((ctx) => ctx.path)
    expect(await (await call(plain, '/a/b')).text()).toBe('/a/b')
  })
})

describe('env and waitUntil', () => {
  it('passes env and executionContext.waitUntil from fetch', async () => {
    const waitUntil = vi.fn()
    const app = new Mixer<Record<string, unknown>, { KEY: string }>().mix(
      (ctx) => {
        ctx.waitUntil(Promise.resolve('later'))
        return ctx.env.KEY
      },
    )
    const res = await app.fetch(
      new Request('http://localhost/'),
      { KEY: 'value' },
      { waitUntil },
    )
    expect(await res.text()).toBe('value')
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('logs a failing waitUntil promise without an execution context', async () => {
    const error = quiet()
    const app = new Mixer().mix((ctx) => {
      ctx.waitUntil(Promise.reject(new Error('background failed')))
      return 'ok'
    })
    expect((await call(app)).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(error).toHaveBeenCalled()
  })
})

describe('client address', () => {
  const addresses = (ctx: {
    ip: string | undefined
    remoteAddress: string | undefined
  }) => ({
    ip: ctx.ip ?? null,
    remoteAddress: ctx.remoteAddress ?? null,
  })
  const request = (headers: Record<string, string> = {}) =>
    new Request('http://localhost/', { headers })

  it('leaves both undefined through fetch, which has no connection to report', async () => {
    const res = await new Mixer().mix(addresses).fetch(request())
    expect(await res.json()).toEqual({ ip: null, remoteAddress: null })
  })

  it('uses remoteAddress from handle, normalized, and ignores X-Forwarded-For without trustedProxies', async () => {
    const res = await new Mixer()
      .mix(addresses)
      .handle(request({ 'x-forwarded-for': '1.1.1.1' }), {
        remoteAddress: '::ffff:203.0.113.9',
      })
    expect(await res.json()).toEqual({
      ip: '203.0.113.9',
      remoteAddress: '203.0.113.9',
    })
  })

  it('resolves the client behind trusted proxies', async () => {
    const res = await new Mixer({ trustedProxies: ['10.0.0.0/8'] })
      .mix(addresses)
      .handle(request({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }), {
        remoteAddress: '10.0.0.2',
      })
    expect(await res.json()).toEqual({
      ip: '198.51.100.7',
      remoteAddress: '10.0.0.2',
    })
  })

  it('takes clientIp as already resolved and never reads X-Forwarded-For for it', async () => {
    const res = await new Mixer({ trustedProxies: ['10.0.0.0/8'] })
      .mix(addresses)
      .handle(request({ 'x-forwarded-for': '6.6.6.6' }), {
        clientIp: '10.0.0.3',
      })
    expect(await res.json()).toEqual({ ip: '10.0.0.3', remoteAddress: null })
  })

  it('leaves invalid addresses undefined', async () => {
    const res = await new Mixer().mix(addresses).handle(request(), {
      remoteAddress: 'nonsense',
      clientIp: 'fe80::1%eth0',
    })
    expect(await res.json()).toEqual({ ip: null, remoteAddress: null })
  })

  it('passes env and executionContext through handle, also when detached', async () => {
    const waitUntil = vi.fn()
    const { handle } = new Mixer<
      Record<string, unknown>,
      { KEY: string }
    >().mix((ctx) => {
      ctx.waitUntil(Promise.resolve())
      return ctx.env.KEY
    })
    const res = await handle(request(), {
      env: { KEY: 'value' },
      executionContext: { waitUntil },
    })
    expect(await res.text()).toBe('value')
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid trustedProxies', () => {
    expect(() => new Mixer({ trustedProxies: ['example.com'] })).toThrow(
      /trustedProxies/,
    )
  })
})

describe('error reports', () => {
  type Report = { error: unknown; phase: string }
  const request = () => new Request('http://localhost/')

  function reporting(...components: Component[]) {
    const reports: Report[] = []
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      ...components,
    )
    return { app, reports }
  }

  it('reports an error a component threw', async () => {
    const boom = new Error('boom')
    const { app, reports } = reporting(() => {
      throw boom
    })
    expect((await call(app)).status).toBe(500)
    expect(reports).toEqual([{ error: boom, phase: 'handling' }])
  })

  it('reports an HttpError of 500 or more but not one below 500', async () => {
    const unavailable = new HttpError(503)
    const { app, reports } = reporting((ctx) => {
      if (ctx.url.pathname === '/503') throw unavailable
      throw new HttpError(403)
    })
    await call(app, '/403')
    await call(app, '/missing-is-404-too')
    await call(app, '/503')
    expect(reports).toEqual([{ error: unavailable, phase: 'handling' }])
  })

  it('reports the original error even when onError turns it into a response', async () => {
    const boom = new Error('boom')
    const reports: Report[] = []
    const app = new Mixer({ onError: () => ({ handled: true }) }).mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      () => {
        throw boom
      },
    )
    expect(await (await call(app)).json()).toEqual({ handled: true })
    expect(reports).toEqual([{ error: boom, phase: 'handling' }])
  })

  it('reports an onError failure', async () => {
    const boom = new Error('boom')
    const broken = new Error('onError broke')
    const reports: Report[] = []
    const app = new Mixer({
      onError: () => {
        throw broken
      },
    }).mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      () => {
        throw boom
      },
    )
    expect((await call(app)).status).toBe(500)
    expect(reports).toEqual([
      { error: boom, phase: 'handling' },
      { error: broken, phase: 'onError' },
    ])
  })

  it.each([
    ['without an execution context', undefined],
    ['with an execution context', { waitUntil: vi.fn() }],
  ])('reports a failing waitUntil promise %s', async (_, executionContext) => {
    const broken = new Error('background failed')
    const reports: Report[] = []
    const { handle } = new Mixer().mix((ctx) => {
      ctx.onErrorReport((report) => {
        reports.push(report)
      })
      ctx.waitUntil(Promise.reject(broken))
      return 'ok'
    })
    expect((await handle(request(), { executionContext })).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reports).toEqual([{ error: broken, phase: 'waitUntil' }])
    if (executionContext) {
      expect(executionContext.waitUntil).toHaveBeenCalledTimes(1)
    }
  })

  it('reports a stream that fails to cancel', async () => {
    const broken = new Error('cancel failed')
    const { app, reports } = reporting(
      async (_ctx, next) => {
        await next()
        throw new Error('wrapper broke')
      },
      () =>
        new ReadableStream({
          cancel() {
            throw broken
          },
        }),
    )
    await call(app)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reports).toContainEqual({ error: broken, phase: 'streamCancel' })
  })

  it('keeps an asynchronous listener alive on platforms that stop after the response', async () => {
    const waitUntil = vi.fn()
    let finish: () => void = () => {}
    const { handle } = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve
            }),
        )
      },
      () => {
        throw new Error('boom')
      },
    )
    expect(
      (await handle(request(), { executionContext: { waitUntil } })).status,
    ).toBe(500)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    finish()
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined()
  })

  it('keeps a failing listener from affecting the response or other listeners', async () => {
    const error = quiet()
    const reports: Report[] = []
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport(() => {
          throw new Error('listener broke')
        })
        ctx.onErrorReport(async () => {
          throw new Error('async listener broke')
        })
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      () => {
        throw new Error('boom')
      },
    )
    expect((await call(app)).status).toBe(500)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reports).toHaveLength(1)
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('logs with the method and path when nobody listens', async () => {
    const error = quiet()
    const boom = new Error('boom')
    const app = new Mixer().mix(() => {
      throw boom
    })
    await call(app, '/todos?secret=1', { method: 'POST' })
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith('mixer: POST /todos (handling)', boom)
  })

  it('does not log to the console when a listener takes the report', async () => {
    const error = quiet()
    const { app } = reporting(() => {
      throw new Error('boom')
    })
    await call(app)
    expect(error).not.toHaveBeenCalled()
  })
})

describe('onError and state', () => {
  type AppState = { log: { requestId: string } }

  it('types ctx.state as possibly incomplete, because components may not have run', () => {
    new Mixer<AppState>({
      onError: (_error, ctx) => {
        // @ts-expect-error log is undefined when the request never reached the component that sets it
        ctx.state.log.requestId
        return ctx.state.log?.requestId ?? null
      },
    })
  })

  it('runs onError for a request outside basePath, where no component ran', async () => {
    const app = new Mixer<AppState>({
      basePath: '/app',
      onError: (_error, ctx) => ({
        status: ctx.status,
        requestId: ctx.state.log?.requestId ?? 'none',
      }),
    }).mix((ctx) => {
      ctx.state.log = { requestId: 'abc' }
    })
    const res = await call(app, '/outside')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ status: 404, requestId: 'none' })
  })
})

describe('public surface of ctx', () => {
  it('does not expose the operations mixer runs on it', async () => {
    let names: string[] = []
    const app = new Mixer().mix((ctx) => {
      names = [
        'draft',
        'resetDraft',
        'runBeforeSend',
        'runOnResponse',
        'reportError',
        'applyResponseHeaders',
      ].filter((name) => name in ctx)
      return 'ok'
    })
    await call(app)
    expect(names).toEqual([])
  })
})
