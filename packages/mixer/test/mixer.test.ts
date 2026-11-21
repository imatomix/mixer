import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, Mixer, type ResponseInfo } from '../src/index.js'
import { call, trackedStream } from './helpers.js'

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

  it('builds error responses from a fresh draft that keeps only CORS, Vary, and Set-Cookie', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.headers.set('Access-Control-Allow-Origin', '*')
      ctx.headers.set('Vary', 'Origin')
      ctx.headers.set('Location', '/elsewhere')
      ctx.headers.set('Cache-Control', 'public, max-age=60')
      ctx.headers.set('Content-Disposition', 'attachment')
      ctx.cookies.set('a', '1')
      throw new HttpError(403)
    })
    const res = await call(app)
    expect(res.status).toBe(403)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('vary')).toBe('Origin')
    expect(res.headers.getSetCookie()).toHaveLength(1)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-disposition')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('private')
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

describe('onBeforeSend', () => {
  it('runs hooks in registration order and lets them change the draft', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.onBeforeSend(() => {
        ctx.headers.append('x-order', 'first')
      })
      ctx.onBeforeSend(async () => {
        await Promise.resolve()
        ctx.headers.append('x-order', 'second')
        ctx.status = 202
      })
      return 'ok'
    })
    const res = await call(app)
    expect(res.status).toBe(202)
    expect(res.headers.get('x-order')).toBe('first, second')
  })

  it('sees state changed by later components', async () => {
    const app = new Mixer<{ visits?: number }>()
      .mix((ctx) => {
        ctx.onBeforeSend(() => {
          ctx.headers.set('x-visits', String(ctx.state.visits))
        })
      })
      .mix((ctx) => {
        ctx.state.visits = 3
        return 'ok'
      })
    expect((await call(app)).headers.get('x-visits')).toBe('3')
  })

  it('runs before error responses as well', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.onBeforeSend(() => {
        ctx.cookies.set('saved', '1')
      })
      throw new HttpError(400)
    })
    const res = await call(app)
    expect(res.status).toBe(400)
    expect(res.headers.getSetCookie()[0]).toMatch(/^saved=1;/)
  })

  it('returns 500 when a hook fails while sending the value from onError', async () => {
    quiet()
    let calls = 0
    const app = new Mixer({ onError: () => ({ message: 'custom' }) }).mix(
      (ctx) => {
        ctx.onBeforeSend(() => {
          calls++
          throw new Error('session store down')
        })
        throw new HttpError(404)
      },
    )
    const res = await call(app)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(calls).toBe(1)
  })

  it('keeps a captured ctx.cookies handle writing to the error response', async () => {
    const app = new Mixer().mix(
      (ctx) => {
        const cookies = ctx.cookies
        ctx.onBeforeSend(() => {
          cookies.delete('token')
        })
      },
      () => {
        throw new HttpError(401)
      },
    )
    const res = await call(app)
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()[0]).toMatch(/^token=; Max-Age=0;/)
  })

  it('returns 500 when a hook fails, does not run hooks again, cancels the stream, and keeps earlier cookies', async () => {
    quiet()
    let calls = 0
    const { stream, state } = trackedStream(['never'])
    const app = new Mixer().mix((ctx) => {
      ctx.onBeforeSend(() => {
        ctx.cookies.set('first', '1')
      })
      ctx.onBeforeSend(() => {
        calls++
        throw new Error('store down')
      })
      return stream
    })
    const res = await call(app)
    expect(res.status).toBe(500)
    expect(calls).toBe(1)
    expect(state.cancelled).toBe(true)
    expect(res.headers.getSetCookie()[0]).toMatch(/^first=1;/)
  })
})

describe('onResponse', () => {
  it('runs once with a snapshot of the final response', async () => {
    const seen: ResponseInfo[] = []
    const app = new Mixer().mix((ctx) => {
      ctx.onResponse((info) => {
        seen.push(info)
      })
      ctx.status = 201
      return 'ok'
    })
    const res = await call(app)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.status).toBe(201)
    expect(seen[0]?.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.status).toBe(201)
  })

  it.each([
    [
      '404',
      new Mixer().mix((ctx) => {
        ctx.onResponse(record)
      }),
      404,
    ],
    [
      'onError',
      new Mixer({ onError: () => 'handled' }).mix((ctx) => {
        ctx.onResponse(record)
        throw new Error('boom')
      }),
      500,
    ],
    [
      'a failing onBeforeSend',
      new Mixer().mix((ctx) => {
        ctx.onResponse(record)
        ctx.onBeforeSend(() => {
          throw new Error('hook failed')
        })
        return 'ok'
      }),
      500,
    ],
  ])('runs once for %s', async (_label, app, status) => {
    quiet()
    recorded.length = 0
    await call(app)
    expect(recorded).toEqual([status])
  })

  it('does not change the response when the snapshot is modified', async () => {
    const app = new Mixer().mix((ctx) => {
      ctx.onResponse((info) => {
        info.headers.set('x-late', 'yes')
      })
      return 'ok'
    })
    expect((await call(app)).headers.get('x-late')).toBeNull()
  })

  it('logs a failing hook without breaking the response or other hooks', async () => {
    const error = quiet()
    let second = false
    const app = new Mixer().mix((ctx) => {
      ctx.onResponse(() => {
        throw new Error('log failed')
      })
      ctx.onResponse(async () => {
        second = true
      })
      return 'ok'
    })
    const res = await call(app)
    expect(res.status).toBe(200)
    expect(second).toBe(true)
    expect(error).toHaveBeenCalled()
  })

  it('throws when a cookie is set after the response is final', async () => {
    let thrown: unknown
    const app = new Mixer().mix((ctx) => {
      ctx.onResponse(() => {
        try {
          ctx.cookies.set('late', '1')
        } catch (e) {
          thrown = e
        }
      })
      return 'ok'
    })
    await call(app)
    expect(thrown).toBeInstanceOf(Error)
  })
})

const recorded: number[] = []
function record(info: ResponseInfo) {
  recorded.push(info.status)
}

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
