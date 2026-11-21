import { request } from 'node:http'
import type { Context } from '@imatomix/mixer'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  all,
  del,
  get,
  head,
  namespace,
  options,
  type Params,
  patch,
  post,
  put,
  route,
} from '../src/index.js'
import { serve } from './helpers.js'

describe('methods', () => {
  it('get responds only when the path and method match', async () => {
    const url = await serve(get('/hello', () => 'hello'))
    expect(await (await fetch(`${url}/hello`)).text()).toBe('hello')
    expect((await fetch(`${url}/hello`, { method: 'POST' })).status).toBe(404)
    expect((await fetch(`${url}/other`)).status).toBe(404)
  })

  it('get also responds to HEAD', async () => {
    const url = await serve(get('/hello', () => 'hello'))
    const res = await fetch(`${url}/hello`, { method: 'HEAD' })
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
      const url = await serve(fn('/x', () => null))
      expect((await fetch(`${url}/x`, { method })).status).toBe(204)
      expect((await fetch(`${url}/x`)).status).toBe(404)
    },
  )

  it('all responds to every method', async () => {
    const url = await serve(all('/x', (ctx) => ctx.method))
    expect(await (await fetch(`${url}/x`, { method: 'PUT' })).text()).toBe(
      'PUT',
    )
    expect(await (await fetch(`${url}/x`)).text()).toBe('GET')
  })

  it('route accepts any method, including an array of methods', async () => {
    const url = await serve(
      route(['propfind', 'MKCOL'], '/dav', (ctx) => ctx.method),
    )
    expect(
      await (await fetch(`${url}/dav`, { method: 'PROPFIND' })).text(),
    ).toBe('PROPFIND')
    expect(await (await fetch(`${url}/dav`, { method: 'MKCOL' })).text()).toBe(
      'MKCOL',
    )
    expect((await fetch(`${url}/dav`)).status).toBe(404)
  })
})

describe('path patterns', () => {
  it('passes :name as a parameter in the second argument', async () => {
    const url = await serve(
      get('/users/:userId/posts/:postId', (_ctx, params) => params),
    )
    expect(await (await fetch(`${url}/users/1/posts/abc`)).json()).toEqual({
      userId: '1',
      postId: 'abc',
    })
  })

  it('URL-decodes parameters', async () => {
    const url = await serve(get('/mix/:fruit', (_ctx, { fruit }) => fruit))
    expect(
      await (await fetch(`${url}/mix/${encodeURIComponent('りんご')}`)).text(),
    ).toBe('りんご')
  })

  it('matches literal paths that contain non-ASCII characters', async () => {
    const url = await serve(get('/ジュース', () => 'ok'))
    expect(await (await fetch(`${url}/ジュース`)).text()).toBe('ok')
  })

  it('ignores a trailing slash', async () => {
    const url = await serve(get('/hello', () => 'ok'))
    expect(await (await fetch(`${url}/hello/`)).text()).toBe('ok')
  })

  it('does not match when the number of segments differs', async () => {
    const url = await serve(get('/a/:b', () => 'ok'))
    expect((await fetch(`${url}/a`)).status).toBe(404)
    expect((await fetch(`${url}/a/b/c`)).status).toBe(404)
  })

  it('* matches the rest of the path and puts it in params["*"]', async () => {
    const url = await serve(get('/files/*', (_ctx, params) => params))
    expect(await (await fetch(`${url}/files/a/b/c.txt`)).json()).toEqual({
      '*': 'a/b/c.txt',
    })
    expect(await (await fetch(`${url}/files`)).json()).toEqual({ '*': '' })
  })

  it('/* matches every path', async () => {
    const url = await serve(all('/*', () => 'fallback'))
    expect(await (await fetch(`${url}/`)).text()).toBe('fallback')
    expect(await (await fetch(`${url}/a/b`)).text()).toBe('fallback')
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
    const url = await serve(
      get(`/${encodeURIComponent('ジュース')}`, () => 'encoded'),
    )
    expect(await (await fetch(`${url}/ジュース`)).text()).toBe('encoded')
  })

  it('reads the query through ctx.url.searchParams', async () => {
    const url = await serve(
      get('/search', (ctx) => ctx.url.searchParams.get('q')),
    )
    expect(await (await fetch(`${url}/search?q=mixer`)).text()).toBe('mixer')
  })
})

describe('safety', () => {
  it('does not match a segment that contains / after decoding', async () => {
    const url = await serve(
      get('/files/:name', (_ctx, { name }) => name),
      get('/raw/*', (_ctx, params) => params['*']),
    )
    expect((await fetch(`${url}/files/..%2F..%2Fetc`)).status).toBe(404)
    expect((await fetch(`${url}/raw/a/..%2Fetc`)).status).toBe(404)
  })

  it.each(['//admin/secret', '/admin//secret'])(
    'does not match a path with an empty segment in the middle (%s)',
    async (path) => {
      const url = await serve(get('/admin/secret', () => 'secret'))
      const { hostname, port } = new URL(url)
      const status = await new Promise<number>((resolve, reject) => {
        request({ hostname, port, path }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
          .on('error', reject)
          .end()
      })
      expect(status).toBe(404)
    },
  )

  it('does not match a segment that contains NUL', async () => {
    const url = await serve(get('/files/:name', (_ctx, { name }) => name))
    expect((await fetch(`${url}/files/a%00b`)).status).toBe(404)
  })

  it('returns 400 for malformed percent-encoding', async () => {
    const url = await serve(get('/files/:name', (_ctx, { name }) => name))
    expect((await fetch(`${url}/files/%E3%81`)).status).toBe(400)
  })

  it('params has no prototype', async () => {
    const url = await serve(
      get('/:name', (_ctx, params) => Object.getPrototypeOf(params) === null),
    )
    expect(await (await fetch(`${url}/x`)).json()).toBe(true)
  })

  it('does not leak parameters from routes that did not match', async () => {
    const url = await serve(
      get('/a/:x/b', (_ctx, params) => params),
      get('/a/:y/c', (_ctx, params) => params),
    )
    expect(await (await fetch(`${url}/a/1/c`)).json()).toEqual({ y: '1' })
  })
})

describe('chaining handlers', () => {
  it('runs handlers in order and stops at the first returned value', async () => {
    const calls: string[] = []
    const url = await serve(
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
    expect(await (await fetch(`${url}/x`)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('moves on to the next component when no handler returns a value', async () => {
    const url = await serve(
      get('/x', () => {}),
      () => 'next component',
    )
    expect(await (await fetch(`${url}/x`)).text()).toBe('next component')
  })

  it('treats 0 and an empty string as responses', async () => {
    const url = await serve(
      get('/zero', () => 0),
      () => 'next',
    )
    expect(await (await fetch(`${url}/zero`)).json()).toBe(0)
  })

  it('does not run later handlers after ctx.send', async () => {
    let reached = false
    const url = await serve(
      get(
        '/x',
        (ctx) => ctx.send(201, 'sent'),
        () => {
          reached = true
        },
      ),
    )
    const res = await fetch(`${url}/x`)
    expect(res.status).toBe(201)
    expect(reached).toBe(false)
  })

  it('accepts plain Components as handlers', async () => {
    const setHeader = (ctx: Context) => {
      ctx.res.setHeader('x-mixed', 'yes')
    }
    const url = await serve(get('/x', setHeader, () => 'ok'))
    expect((await fetch(`${url}/x`)).headers.get('x-mixed')).toBe('yes')
  })
})

describe('namespace', () => {
  it('adds a prefix to the routes', async () => {
    const api = namespace('/api/v1')
    const url = await serve(api(get('/users/:id', (_ctx, { id }) => id)))
    expect(await (await fetch(`${url}/api/v1/users/42`)).text()).toBe('42')
    expect((await fetch(`${url}/users/42`)).status).toBe(404)
  })

  it('joins paths when nested', async () => {
    const url = await serve(
      namespace('/api')(namespace('/v2')(get('/', () => 'v2 root'))),
    )
    expect(await (await fetch(`${url}/api/v2`)).text()).toBe('v2 root')
  })

  it('moves on to the next component when no route responds', async () => {
    const url = await serve(
      namespace('/api')(get('/a', () => 'a')),
      () => 'next',
    )
    expect(await (await fetch(`${url}/api/b`)).text()).toBe('next')
  })

  it('rejects parameters and wildcards in a namespace path', () => {
    expect(() => namespace('/users/:id')).toThrow()
    expect(() => namespace('/files/*')).toThrow()
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
