import {
  type ErrorReport,
  type ExecutionContextLike,
  Mixer,
} from '@imatomix/mixer'
import { describe, expect, it } from 'vitest'
import { get, group, methodNotAllowed, mount, post } from '../src/index.js'
import { call } from './helpers.js'

function admin(basePath = '/admin') {
  return new Mixer<Record<string, unknown>, unknown>({ basePath }).mix(
    get('/', () => 'admin home'),
    get('/users', (ctx) => `users via ${ctx.path}`),
  )
}

describe('mount', () => {
  it('hands the prefix and everything below it to a mixer app', async () => {
    const app = new Mixer().mix(mount('/admin', admin()), () => 'outer')
    expect(await (await call(app, '/admin')).text()).toBe('admin home')
    expect(await (await call(app, '/admin/users')).text()).toBe(
      'users via /users',
    )
    expect(await (await call(app, '/administrator')).text()).toBe('outer')
    expect(await (await call(app, '/')).text()).toBe('outer')
  })

  it('answers every method, including the mounted app’s own 404, and keeps methodNotAllowed out', async () => {
    const app = new Mixer().mix(
      get('/admin/users', () => 'outer route'),
      mount('/admin', admin()),
      methodNotAllowed(),
      () => 'outer',
    )
    const res = await call(app, '/admin/users', { method: 'POST' })
    expect(res.status).toBe(404)
    expect(res.headers.has('allow')).toBe(false)
  })

  it('passes the environment and waitUntil to a mixer app', async () => {
    const waited: Promise<unknown>[] = []
    const inner = new Mixer<Record<string, unknown>, { name: string }>({
      basePath: '/admin',
    }).mix((ctx) => {
      ctx.waitUntil(Promise.resolve('background'))
      return `env ${ctx.env.name}`
    })
    const app = new Mixer<Record<string, unknown>, { name: string }>().mix(
      mount('/admin', inner),
    )
    const executionContext: ExecutionContextLike = {
      waitUntil: (promise) => {
        waited.push(promise)
      },
    }
    const res = await app.fetch(
      new Request('http://localhost/admin'),
      { name: 'prod' },
      executionContext,
    )
    expect(await res.text()).toBe('env prod')
    expect(waited.length).toBeGreaterThan(0)
  })

  it('passes the peer address, so the mounted app applies its own trustedProxies', async () => {
    const ipOf = (trustedProxies?: string[]) =>
      new Mixer({
        basePath: '/admin',
        ...(trustedProxies ? { trustedProxies } : {}),
      }).mix((ctx) => String(ctx.ip))
    const request = () =>
      new Request('http://localhost/admin', {
        headers: { 'x-forwarded-for': '203.0.113.7' },
      })

    const trusting = new Mixer({ trustedProxies: ['10.0.0.1'] }).mix(
      mount('/admin', ipOf()),
    )
    // The outer app trusts the proxy, but the mounted one does not, so it sees the proxy
    expect(
      await (
        await trusting.handle(request(), { remoteAddress: '10.0.0.1' })
      ).text(),
    ).toBe('10.0.0.1')

    const inner = new Mixer().mix(mount('/admin', ipOf(['10.0.0.1'])))
    expect(
      await (
        await inner.handle(request(), { remoteAddress: '10.0.0.1' })
      ).text(),
    ).toBe('203.0.113.7')

    const platform = new Mixer().mix(mount('/admin', ipOf()))
    expect(
      await (
        await platform.handle(request(), { clientIp: '198.51.100.2' })
      ).text(),
    ).toBe('198.51.100.2')
  })

  it('reports a fetch handler’s failed background work in the outer app, and leaves a mixer app’s to that app', async () => {
    const outerReports: ErrorReport[] = []
    const innerReports: ErrorReport[] = []
    const failing = Promise.reject(new Error('background failed'))
    failing.catch(() => {})
    const inner = new Mixer({ basePath: '/admin' }).mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          innerReports.push(report)
        })
      },
      (ctx) => {
        ctx.waitUntil(failing)
        return 'admin'
      },
    )
    const handler = (
      _request: Request,
      _env: unknown,
      executionContext: ExecutionContextLike,
    ) => {
      executionContext.waitUntil(failing)
      return new Response('legacy')
    }
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          outerReports.push(report)
        })
      },
      mount('/admin', inner),
      mount('/legacy', handler),
    )

    await (await call(app, '/admin')).text()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(innerReports.map((report) => report.phase)).toEqual(['waitUntil'])
    expect(outerReports).toEqual([])

    await (await call(app, '/legacy')).text()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(outerReports.map((report) => report.phase)).toEqual(['waitUntil'])
  })

  it('calls other fetch handlers with the request, the environment, and waitUntil', async () => {
    const seen: unknown[] = []
    const waited: Promise<unknown>[] = []
    const handler = {
      fetch: (
        request: Request,
        env: unknown,
        executionContext: ExecutionContextLike,
      ) => {
        seen.push(new URL(request.url).pathname, env)
        executionContext.waitUntil(Promise.resolve())
        return new Response('object handler')
      },
    }
    const fn = (request: Request) =>
      new Response(`function handler ${new URL(request.url).pathname}`)
    const app = new Mixer<Record<string, unknown>, string>().mix(
      mount('/legacy', handler),
      mount('/auth', fn),
    )
    const executionContext = {
      waitUntil: (p: Promise<unknown>) => void waited.push(p),
    }
    const first = await app.fetch(
      new Request('http://localhost/legacy/x'),
      'env',
      executionContext,
    )
    expect(await first.text()).toBe('object handler')
    expect(seen).toEqual(['/legacy/x', 'env'])
    expect(waited.length).toBeGreaterThan(0)
    const second = await app.fetch(
      new Request('http://localhost/auth/sign-in'),
      'env',
      executionContext,
    )
    expect(await second.text()).toBe('function handler /auth/sign-in')
  })

  it('works inside a group, with the full path as basePath', async () => {
    const app = new Mixer().mix(
      group('/v1', mount('/admin', admin('/v1/admin'))),
    )
    expect(await (await call(app, '/v1/admin/users')).text()).toBe(
      'users via /users',
    )
  })

  it('fails clearly when the outer app already read the body', async () => {
    const reports: ErrorReport[] = []
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport((report) => {
          reports.push(report)
        })
      },
      async (ctx) => {
        await ctx.text()
      },
      mount(
        '/admin',
        new Mixer({ basePath: '/admin' }).mix(post('/', (ctx) => ctx.text())),
      ),
    )
    const res = await call(app, '/admin', { method: 'POST', body: 'hello' })
    expect(res.status).toBe(500)
    expect(String((reports[0]?.error as Error | undefined)?.message)).toMatch(
      /already read/,
    )
  })

  it('lets outer components wrap the mounted app’s responses, errors included', async () => {
    const inner = new Mixer({
      basePath: '/admin',
      onError: () => new Response('inner error page', { status: 500 }),
    }).mix(() => {
      throw new Error('inner failure')
    })
    const app = new Mixer().mix(
      async (ctx, next) => {
        await next()
        ctx.headers.set('X-Outer', 'yes')
      },
      mount('/admin', inner),
    )
    const res = await call(app, '/admin')
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('inner error page')
    expect(res.headers.get('x-outer')).toBe('yes')
  })

  it('rejects :param and * in the prefix', () => {
    expect(() => mount('/:id', admin())).toThrow(/cannot be used/)
    expect(() => mount('/files/*', admin())).toThrow(/cannot be used/)
  })
})
