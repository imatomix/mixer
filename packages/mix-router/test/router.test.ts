import { type Component, type Context, HttpError, Mixer } from '@imatomix/mixer'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  all,
  createRouter,
  del,
  get,
  group,
  head,
  methodNotAllowed,
  options,
  type Params,
  patch,
  post,
  put,
  route,
} from '../src/index.js'
import { call } from './helpers.js'

describe('methods', () => {
  it('get responds only when the path and method match', async () => {
    const app = new Mixer().mix(get('/hello', () => 'hello'))
    expect(await (await call(app, `/hello`)).text()).toBe('hello')
    expect((await call(app, `/hello`, { method: 'POST' })).status).toBe(404)
    expect((await call(app, `/other`)).status).toBe(404)
  })

  it('get also responds to HEAD', async () => {
    const app = new Mixer().mix(get('/hello', () => 'hello'))
    const res = await call(app, `/hello`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it.each([
    ['POST', post],
    ['PUT', put],
    ['PATCH', patch],
    ['DELETE', del],
    ['HEAD', head],
    ['OPTIONS', options],
  ] as const)(
    'the %s function responds only to that method',
    async (method, fn) => {
      const app = new Mixer().mix(fn('/x', () => null))
      expect((await call(app, `/x`, { method })).status).toBe(204)
      expect((await call(app, `/x`)).status).toBe(404)
    },
  )

  it('all responds to every method', async () => {
    const app = new Mixer().mix(all('/x', (ctx) => ctx.method))
    expect(await (await call(app, `/x`, { method: 'PUT' })).text()).toBe('PUT')
    expect(await (await call(app, `/x`)).text()).toBe('GET')
  })

  it('route accepts any method, including an array of methods', async () => {
    const app = new Mixer().mix(
      route(['propfind', 'MKCOL'], '/dav', (ctx) => ctx.method),
    )
    expect(await (await call(app, `/dav`, { method: 'PROPFIND' })).text()).toBe(
      'PROPFIND',
    )
    expect(await (await call(app, `/dav`, { method: 'MKCOL' })).text()).toBe(
      'MKCOL',
    )
    expect((await call(app, `/dav`)).status).toBe(404)
  })
})

describe('path patterns', () => {
  it('passes :name as a parameter in the second argument', async () => {
    const app = new Mixer().mix(
      get('/users/:userId/posts/:postId', (_ctx, params) => params),
    )
    expect(await (await call(app, `/users/1/posts/abc`)).json()).toEqual({
      userId: '1',
      postId: 'abc',
    })
  })

  it('URL-decodes parameters', async () => {
    const app = new Mixer().mix(get('/mix/:fruit', (_ctx, { fruit }) => fruit))
    expect(
      await (await call(app, `/mix/${encodeURIComponent('りんご')}`)).text(),
    ).toBe('りんご')
  })

  it('matches literal paths that contain non-ASCII characters', async () => {
    const app = new Mixer().mix(get('/ジュース', () => 'ok'))
    expect(await (await call(app, `/ジュース`)).text()).toBe('ok')
  })

  it('ignores a trailing slash', async () => {
    const app = new Mixer().mix(get('/hello', () => 'ok'))
    expect(await (await call(app, `/hello/`)).text()).toBe('ok')
  })

  it('does not match when the number of segments differs', async () => {
    const app = new Mixer().mix(get('/a/:b', () => 'ok'))
    expect((await call(app, `/a`)).status).toBe(404)
    expect((await call(app, `/a/b/c`)).status).toBe(404)
  })

  it('* matches the rest of the path and puts it in params["*"]', async () => {
    const app = new Mixer().mix(get('/files/*', (_ctx, params) => params))
    expect(await (await call(app, `/files/a/b/c.txt`)).json()).toEqual({
      '*': 'a/b/c.txt',
    })
    expect(await (await call(app, `/files`)).json()).toEqual({ '*': '' })
  })

  it('/* matches every path', async () => {
    const app = new Mixer().mix(all('/*', () => 'fallback'))
    expect(await (await call(app, `/`)).text()).toBe('fallback')
    expect(await (await call(app, `/a/b`)).text()).toBe('fallback')
  })

  it('throws at definition when * is not the last segment', () => {
    expect(() => get('/a/*/b', () => null)).toThrow()
  })

  it.each(['/users/:', '/a/:id/b/:id', '/a/:user-id', '/a/:1st'])(
    'throws at definition for an invalid parameter name (%s)',
    (path) => {
      expect(() => get(path, () => null)).toThrow()
    },
  )

  it('treats a percent-encoded literal path as the same path', async () => {
    const app = new Mixer().mix(
      get(`/${encodeURIComponent('ジュース')}`, () => 'encoded'),
    )
    expect(await (await call(app, `/ジュース`)).text()).toBe('encoded')
  })

  it('reads the query through ctx.url.searchParams', async () => {
    const app = new Mixer().mix(
      get('/search', (ctx) => ctx.url.searchParams.get('q')),
    )
    expect(await (await call(app, `/search?q=mixer`)).text()).toBe('mixer')
  })
})

describe('safety', () => {
  it('does not match a segment that contains / after decoding', async () => {
    const app = new Mixer().mix(
      get('/files/:name', (_ctx, { name }) => name),
      get('/raw/*', (_ctx, params) => params['*']),
    )
    expect((await call(app, `/files/..%2F..%2Fetc`)).status).toBe(404)
    expect((await call(app, `/raw/a/..%2Fetc`)).status).toBe(404)
  })

  it.each(['//admin/secret', '/admin//secret'])(
    'does not match a path with an empty segment in the middle (%s)',
    async (path) => {
      const app = new Mixer().mix(get('/admin/secret', () => 'secret'))
      const { status } = await call(app, path)
      expect(status).toBe(404)
    },
  )

  it('does not match a segment that contains NUL', async () => {
    const app = new Mixer().mix(get('/files/:name', (_ctx, { name }) => name))
    expect((await call(app, `/files/a%00b`)).status).toBe(404)
  })

  it('returns 400 for malformed percent-encoding', async () => {
    const app = new Mixer().mix(get('/files/:name', (_ctx, { name }) => name))
    expect((await call(app, `/files/%E3%81`)).status).toBe(400)
  })

  it('params has no prototype', async () => {
    const app = new Mixer().mix(
      get('/:name', (_ctx, params) => Object.getPrototypeOf(params) === null),
    )
    expect(await (await call(app, `/x`)).json()).toBe(true)
  })

  it('does not leak parameters from routes that did not match', async () => {
    const app = new Mixer().mix(
      get('/a/:x/b', (_ctx, params) => params),
      get('/a/:y/c', (_ctx, params) => params),
    )
    expect(await (await call(app, `/a/1/c`)).json()).toEqual({ y: '1' })
  })
})

describe('chaining handlers', () => {
  it('runs handlers in order and stops at the first returned value', async () => {
    const calls: string[] = []
    const app = new Mixer().mix(
      get(
        '/x',
        () => {
          calls.push('a')
        },
        () => {
          calls.push('b')
          return 'done'
        },
        () => {
          calls.push('c')
        },
      ),
    )
    expect(await (await call(app, `/x`)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('moves on to the next component when no handler returns a value', async () => {
    const app = new Mixer().mix(
      get('/x', () => {}),
      () => 'next component',
    )
    expect(await (await call(app, `/x`)).text()).toBe('next component')
  })

  it('treats 0 and an empty string as responses', async () => {
    const app = new Mixer().mix(
      get('/zero', () => 0),
      () => 'next',
    )
    expect(await (await call(app, `/zero`)).json()).toBe(0)
  })

  it('does not run later handlers after a handler returns a Response', async () => {
    let reached = false
    const app = new Mixer().mix(
      get(
        '/x',
        () => new Response('sent', { status: 201 }),
        () => {
          reached = true
        },
      ),
    )
    const res = await call(app, `/x`)
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('sent')
    expect(reached).toBe(false)
  })

  it('accepts plain Components as handlers', async () => {
    const setHeader = (ctx: Context) => {
      ctx.headers.set('x-mixed', 'yes')
    }
    const app = new Mixer().mix(get('/x', setHeader, () => 'ok'))
    expect((await call(app, `/x`)).headers.get('x-mixed')).toBe('yes')
  })
})

describe('group', () => {
  it('adds a prefix to the routes', async () => {
    const app = new Mixer().mix(
      group(
        '/api/v1',
        get('/users/:id', (_ctx, { id }) => id),
      ),
    )
    expect(await (await call(app, `/api/v1/users/42`)).text()).toBe('42')
    expect((await call(app, `/users/42`)).status).toBe(404)
  })

  it('joins paths when nested', async () => {
    const app = new Mixer().mix(
      group(
        '/api',
        group(
          '/v2',
          get('/', () => 'v2 root'),
        ),
      ),
    )
    expect(await (await call(app, `/api/v2`)).text()).toBe('v2 root')
  })

  it('moves on to the next component when no route responds', async () => {
    const app = new Mixer().mix(
      group(
        '/api',
        get('/a', () => 'a'),
      ),
      () => 'next',
    )
    expect(await (await call(app, `/api/b`)).text()).toBe('next')
  })

  it('rejects parameters and wildcards in a group prefix', () => {
    expect(() => group('/users/:id')).toThrow()
    expect(() => group('/files/*')).toThrow()
  })
})

describe('components inside a group', () => {
  const requireAuth = (ctx: Context) => {
    if (!ctx.request.headers.has('authorization')) throw new HttpError(401)
  }

  it('runs plain components for every request under the prefix, before its routes', async () => {
    const seen: string[] = []
    const app = new Mixer().mix(
      group(
        '/admin',
        (ctx) => {
          seen.push(ctx.path)
        },
        requireAuth,
        get('/users', () => 'users'),
      ),
      () => 'outside',
    )
    expect((await call(app, '/admin/users')).status).toBe(401)
    expect((await call(app, '/admin/unknown')).status).toBe(401)
    expect((await call(app, '/admin')).status).toBe(401)
    expect(
      await (
        await call(app, '/admin/users', { headers: { authorization: 'x' } })
      ).text(),
    ).toBe('users')
    expect(await (await call(app, '/administrator')).text()).toBe('outside')
    expect(await (await call(app, '/other')).text()).toBe('outside')
    // Components see the full path, not one relative to the group
    expect(seen).toEqual([
      '/admin/users',
      '/admin/unknown',
      '/admin',
      '/admin/users',
    ])
  })

  it('answers with the first value a component returns', async () => {
    const app = new Mixer().mix(
      group(
        '/maintenance',
        () => 'closed',
        get('/status', () => 'open'),
      ),
    )
    expect(await (await call(app, '/maintenance/status')).text()).toBe('closed')
  })

  it('combines prefixes when nested', async () => {
    const calls: string[] = []
    const app = new Mixer().mix(
      group(
        '/api',
        () => {
          calls.push('api')
        },
        group(
          '/admin',
          () => {
            calls.push('admin')
          },
          get('/users', () => 'users'),
        ),
        get('/health', () => 'ok'),
      ),
    )
    await call(app, '/api/health')
    expect(calls).toEqual(['api'])
    calls.length = 0
    await call(app, '/api/admin/users')
    expect(calls).toEqual(['api', 'admin'])
  })

  it('matches the prefix below basePath, segment by segment, after decoding', async () => {
    let ran = 0
    const app = new Mixer({ basePath: '/v1' }).mix(
      group('/ジュース', () => {
        ran++
      }),
    )
    await call(app, `/v1/${encodeURIComponent('ジュース')}/x`)
    await call(app, '/ジュース/x')
    expect(ran).toBe(1)
  })

  it('types components with the State and Env of createRouter', () => {
    const { group: typed } = createRouter<{ user?: string }, { KEY: string }>()
    typed('/a', (ctx) => {
      expectTypeOf(ctx.state.user).toEqualTypeOf<string | undefined>()
      expectTypeOf(ctx.env.KEY).toEqualTypeOf<string>()
    })
  })
})

describe('methodNotAllowed', () => {
  const users = () => [
    get('/users', () => 'list'),
    post('/users', () => 'created'),
  ]

  it('answers 405 with Allow when the path matches but no route takes the method', async () => {
    const app = new Mixer().mix(...users(), methodNotAllowed())
    const res = await call(app, '/users', { method: 'DELETE' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST')
    expect(await res.json()).toEqual({ error: 'Method Not Allowed' })
  })

  it('leaves unknown paths to 404', async () => {
    const app = new Mixer().mix(...users(), methodNotAllowed())
    expect((await call(app, '/nothing')).status).toBe(404)
  })

  it('changes nothing when it is not mixed in', async () => {
    const app = new Mixer().mix(...users())
    expect((await call(app, '/users', { method: 'DELETE' })).status).toBe(404)
  })

  it('answers 404 when a route took the method but returned nothing', async () => {
    const app = new Mixer().mix(
      get('/users', () => undefined),
      post('/users', () => 'created'),
      methodNotAllowed(),
    )
    expect((await call(app, '/users')).status).toBe(404)
  })

  it('does not answer 405 when an all() route matches the path', async () => {
    const app = new Mixer().mix(
      get('/users', () => 'list'),
      all('/users', () => undefined),
      methodNotAllowed(),
    )
    expect((await call(app, '/users', { method: 'DELETE' })).status).toBe(404)
  })

  it('lets a later component handle the method first', async () => {
    const app = new Mixer().mix(
      ...users(),
      (ctx) => (ctx.method === 'DELETE' ? 'custom' : undefined),
      methodNotAllowed(),
    )
    expect(await (await call(app, '/users', { method: 'DELETE' })).text()).toBe(
      'custom',
    )
  })

  it('collects methods from grouped routes and lists each once', async () => {
    const app = new Mixer().mix(
      group(
        '/api',
        get('/users', () => 'a'),
        get('/users', () => 'b'),
      ),
      methodNotAllowed(),
    )
    const res = await call(app, '/api/users', { method: 'POST' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
  })

  it('does not answer OPTIONS by itself', async () => {
    const app = new Mixer().mix(...users(), methodNotAllowed())
    const res = await call(app, '/users', { method: 'OPTIONS' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD, POST')
  })
})

describe('types', () => {
  it('infers parameter types from the path', () => {
    expectTypeOf<Params<'/users/:id/posts/:postId'>>().toEqualTypeOf<{
      id: string
      postId: string
    }>()
    expectTypeOf<Params<'/files/:dir/*'>>().toEqualTypeOf<{
      dir: string
      '*': string
    }>()
    expectTypeOf<Params<'/static'>>().toEqualTypeOf<Record<never, never>>()
  })

  it('reports a type error for a parameter that does not exist', () => {
    get('/users/:id', (_ctx, params) => {
      // @ts-expect-error
      return params.name
    })
  })
})

describe('performance and mounting', () => {
  it('decodes the request path once per request, however many routes there are', async () => {
    const routes = Array.from({ length: 100 }, (_, i) =>
      get(`/route${i}/:id`, () => i),
    )
    const app = new Mixer().mix(
      ...routes,
      get('/a/:b', (_ctx, { b }) => b),
    )
    // The first request compiles each route's pattern for its group prefix, so warm up first
    await call(app, '/a/warm')
    const spy = vi.spyOn(globalThis, 'decodeURIComponent')
    const res = await call(app, '/a/b')
    expect(await res.text()).toBe('b')
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
    spy.mockRestore()
  })

  it('matches routes against the path without basePath', async () => {
    const app = new Mixer({ basePath: '/api' }).mix(
      get('/users/:id', (_ctx, { id }) => id),
    )
    expect(await (await call(app, '/api/users/42')).text()).toBe('42')
    expect((await call(app, '/users/42')).status).toBe(404)
  })

  it('can be mixed into an app with typed env', async () => {
    const app = new Mixer<Record<string, unknown>, { GREETING: string }>().mix(
      get('/hello', (ctx) => (ctx.env as { GREETING: string }).GREETING),
    )
    const res = await app.fetch(new Request('http://localhost/hello'), {
      GREETING: 'hi',
    })
    expect(await res.text()).toBe('hi')
  })
})

describe('next() inside a group', () => {
  const jsonErrors: Component = async (ctx, next) => {
    const res = await next()
    if (ctx.error === undefined) return
    return new Response(JSON.stringify({ failed: res.status }), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('wraps the routes of its group, such as a JSON error page for /api only', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = new Mixer({ onError: () => 'html page' }).mix(
      group(
        '/api',
        jsonErrors,
        get('/fail', () => {
          throw new Error('boom')
        }),
      ),
      get('/fail', () => {
        throw new Error('boom')
      }),
    )
    expect(await (await call(app, '/api/fail')).json()).toEqual({ failed: 500 })
    expect(await (await call(app, '/fail')).text()).toBe('html page')
  })

  it('continues to what follows the group when nothing in it answers', async () => {
    const seen: number[] = []
    const app = new Mixer().mix(
      group('/api', async (_ctx, next) => {
        const res = await next()
        seen.push(res.status)
      }),
      get('/api/later', () => 'from outside'),
    )
    expect(await (await call(app, '/api/later')).text()).toBe('from outside')
    expect(seen).toEqual([200])
  })

  it('works in nested groups', async () => {
    const tag =
      (name: string): Component =>
      async (ctx, next) => {
        await next()
        ctx.headers.append('X-Tag', name)
      }
    const app = new Mixer().mix(
      group(
        '/a',
        tag('a'),
        group(
          '/b',
          tag('b'),
          get('/c', () => 'ok'),
        ),
      ),
    )
    const res = await call(app, '/a/b/c')
    expect(await res.text()).toBe('ok')
    expect(res.headers.get('x-tag')).toBe('b, a')
  })

  it('does not run outside its prefix', async () => {
    const app = new Mixer().mix(
      group('/api', async (ctx, next) => {
        await next()
        ctx.headers.set('X-Api', 'yes')
      }),
      get('/page', () => 'page'),
    )
    expect((await call(app, '/page')).headers.get('x-api')).toBeNull()
  })
})
