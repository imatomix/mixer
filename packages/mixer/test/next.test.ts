// The guarantees around the response, written with next(): which hold by design and which depend on order
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Component, HttpError, Mixer } from '../src/index.js'
import { call } from './helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})

/** What a security-header module looks like with next() */
const stamp: Component = async (ctx, next) => {
  await next()
  ctx.headers.set('X-Stamp', 'yes')
}

describe('headers added after next()', () => {
  it.each<[string, Component]>([
    ['a normal response', () => 'ok'],
    [
      'an HttpError',
      () => {
        throw new HttpError(403)
      },
    ],
    ['a returned Response', () => new Response('raw', { status: 201 })],
    [
      'a returned Response with immutable headers',
      () => Response.redirect('http://localhost/next', 302),
    ],
    [
      'a value that cannot be serialized',
      () => {
        const circular: Record<string, unknown> = {}
        circular.self = circular
        return circular
      },
    ],
  ])('reach %s', async (_label, handler) => {
    quiet()
    const res = await call(new Mixer().mix(stamp, handler))
    expect(res.headers.get('x-stamp')).toBe('yes')
  })

  it('reach the 404 when nothing answers', async () => {
    const res = await call(new Mixer().mix(stamp))
    expect(res.status).toBe(404)
    expect(res.headers.get('x-stamp')).toBe('yes')
  })

  it('reach the response from onError', async () => {
    const app = new Mixer({ onError: () => ({ handled: true }) }).mix(
      stamp,
      () => {
        throw new Error('boom')
      },
    )
    quiet()
    const res = await call(app)
    expect(await res.json()).toEqual({ handled: true })
    expect(res.headers.get('x-stamp')).toBe('yes')
  })

  it('ORDER-DEPENDENT: are lost when a component outside replaces the response', async () => {
    const replacer: Component = async (_ctx, next) => {
      await next()
      return new Response('replaced')
    }
    const app = new Mixer().mix(replacer, stamp, () => 'ok')
    const res = await call(app)
    expect(await res.text()).toBe('replaced')
    expect(res.headers.get('x-stamp')).toBeNull()
  })

  it('survive a replacement made inside them', async () => {
    const replacer: Component = async (_ctx, next) => {
      await next()
      return new Response('replaced')
    }
    const res = await call(new Mixer().mix(stamp, replacer, () => 'ok'))
    expect(res.headers.get('x-stamp')).toBe('yes')
  })
})

describe('cookies set after next()', () => {
  const remember: Component = async (ctx, next) => {
    await next()
    ctx.cookies.set('sid', 'abc')
  }

  it('reach normal and error responses, and those are kept out of shared caches', async () => {
    quiet()
    for (const handler of [
      () => 'ok',
      () => {
        throw new Error('boom')
      },
    ]) {
      const res = await call(new Mixer().mix(remember, handler))
      expect(res.headers.getSetCookie()).toEqual([
        expect.stringMatching(/^sid=abc;/),
      ])
      expect(res.headers.get('cache-control')).toMatch(/private/)
    }
  })

  it('a cookie a handler set before throwing is not sent', async () => {
    quiet()
    const res = await call(
      new Mixer().mix((ctx) => {
        ctx.cookies.set('half', 'done')
        throw new Error('boom')
      }),
    )
    expect(res.status).toBe(500)
    expect(res.headers.getSetCookie()).toEqual([])
  })

  it('setting a cookie after the response is final throws', async () => {
    let late: (() => void) | undefined
    await call(
      new Mixer().mix((ctx) => {
        late = () => ctx.cookies.set('late', '1')
        return 'ok'
      }),
    )
    expect(late).toThrow()
  })
})

describe('observing the final response', () => {
  it('sees the status and headers of the response, including errors and 404', async () => {
    const seen: number[] = []
    const observe: Component = async (_ctx, next) => {
      const res = await next()
      seen.push(res.status)
    }
    quiet()
    const app = new Mixer().mix(observe, (ctx) => {
      if (ctx.path === '/boom') throw new Error('boom')
      if (ctx.path === '/ok') return 'ok'
    })
    await call(app, '/ok')
    await call(app, '/boom')
    await call(app, '/missing')
    expect(seen).toEqual([200, 500, 404])
  })
})

describe('ctx.error and transactions', () => {
  it('lets a wrapper roll back on an error and commit otherwise', async () => {
    const log: string[] = []
    const transaction: Component = async (ctx, next) => {
      log.push('begin')
      await next()
      log.push(ctx.error === undefined ? 'commit' : 'rollback')
    }
    quiet()
    const app = new Mixer().mix(transaction, (ctx) => {
      if (ctx.path === '/fail') throw new Error('boom')
      return 'ok'
    })
    await call(app, '/ok')
    await call(app, '/fail')
    expect(log).toEqual(['begin', 'commit', 'begin', 'rollback'])
  })

  it('a 500 a handler returns on purpose is not an error', async () => {
    let error: unknown = 'unset'
    const app = new Mixer().mix(
      async (ctx, next) => {
        await next()
        error = ctx.error
      },
      (ctx) => {
        ctx.status = 500
        return 'chosen'
      },
    )
    expect((await call(app)).status).toBe(500)
    expect(error).toBeUndefined()
  })
})

describe('scoped error pages', () => {
  it('lets a wrapper turn errors under /api into JSON', async () => {
    const apiErrors: Component = async (ctx, next) => {
      const res = await next()
      if (!ctx.path.startsWith('/api/') || ctx.error === undefined) return
      return new Response(JSON.stringify({ failed: true }), {
        status: res.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    quiet()
    const app = new Mixer({ onError: () => 'html error page' }).mix(
      apiErrors,
      () => {
        throw new Error('boom')
      },
    )
    expect(await (await call(app, '/api/x')).json()).toEqual({ failed: true })
    expect(await (await call(app, '/page')).text()).toBe('html error page')
  })
})

describe('misuse of next()', () => {
  it('answers 500 when next() is called twice', async () => {
    quiet()
    const res = await call(
      new Mixer().mix(
        async (_ctx, next) => {
          await next()
          await next()
        },
        () => 'ok',
      ),
    )
    expect(res.status).toBe(500)
  })

  it('answers 500 when next() is not awaited', async () => {
    quiet()
    const res = await call(
      new Mixer().mix(
        (_ctx, next) => {
          void next()
          return undefined
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return 'ok'
        },
      ),
    )
    expect(res.status).toBe(500)
  })

  it('turns a throw after next() into an error response and cancels the inner body', async () => {
    quiet()
    let cancelled = false
    const res = await call(
      new Mixer().mix(
        async (_ctx, next) => {
          await next()
          throw new Error('after')
        },
        () =>
          new ReadableStream({
            cancel() {
              cancelled = true
            },
          }),
      ),
    )
    expect(res.status).toBe(500)
    expect(cancelled).toBe(true)
  })

  it('PITFALL: headers captured before next() still point at the old draft', async () => {
    const res = await call(
      new Mixer().mix(
        async (ctx, next) => {
          const headers = ctx.headers
          await next()
          headers.set('X-Late', 'lost')
        },
        () => 'ok',
      ),
    )
    expect(res.headers.get('x-late')).toBeNull()
  })
})

describe('what mixer still guarantees for every response', () => {
  it('cannot be undone by a wrapper', async () => {
    const app = new Mixer().mix(
      async (ctx, next) => {
        await next()
        ctx.headers.delete('X-Content-Type-Options')
        ctx.headers.set('Cache-Control', 'public, max-age=60')
        ctx.cookies.set('sid', 'x')
      },
      () => 'ok',
    )
    const res = await call(app, '/', { method: 'HEAD' })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('private, max-age=60')
    expect(res.body).toBeNull()
  })

  it('changing ctx.status after next() changes the response', async () => {
    const res = await call(
      new Mixer().mix(
        async (ctx, next) => {
          await next()
          ctx.status = 202
        },
        () => 'ok',
      ),
    )
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('ok')
  })
})

describe('fixes from the review', () => {
  it('drops the body when ctx.status becomes 204 after next()', async () => {
    const res = await call(
      new Mixer().mix(
        async (ctx, next) => {
          await next()
          ctx.status = 204
        },
        () => 'ok',
      ),
    )
    expect(res.status).toBe(204)
    expect(res.body).toBeNull()
  })

  it('does not report a body that a wrapper piped into a new one', async () => {
    const reports: string[] = []
    const app = new Mixer().mix(
      (ctx) => {
        ctx.onErrorReport(({ phase }) => {
          reports.push(phase)
        })
      },
      async (ctx, next) => {
        const res = await next()
        const upper = res.body?.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  new TextDecoder().decode(chunk).toUpperCase(),
                ),
              )
            },
          }),
        )
        ctx.headers.delete('Content-Length')
        return new Response(upper, { headers: ctx.headers })
      },
      () => 'ok',
    )
    const res = await call(app)
    expect(await res.text()).toBe('OK')
    expect(reports).toEqual([])
  })

  it('answers 500 when the value from onError cannot be sent', async () => {
    quiet()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const res = await call(new Mixer({ onError: () => circular }).mix())
    expect(res.status).toBe(500)
  })

  it('does not bring back a cookie from before an error when another is set', async () => {
    quiet()
    const res = await call(
      new Mixer().mix(
        async (ctx, next) => {
          ctx.cookies.set('before', '1')
          await next()
          ctx.cookies.set('after', '1')
        },
        () => {
          throw new Error('boom')
        },
      ),
    )
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^after=1;/),
    ])
  })

  it('answers 500 when a wrapper returns a plain value after next()', async () => {
    quiet()
    const res = await call(
      new Mixer().mix(
        async (_ctx, next) => {
          await next()
          return 'replaced'
        },
        () => ({ a: 1 }),
      ),
    )
    expect(res.status).toBe(500)
  })
})

describe('second review', () => {
  it('replaces a cookie set before next() when the same one is set after it', async () => {
    const res = await call(
      new Mixer().mix(
        async (ctx, next) => {
          ctx.cookies.set('sid', 'first')
          await next()
          ctx.cookies.set('sid', 'second')
        },
        () => 'ok',
      ),
    )
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^sid=second;/),
    ])
  })

  it('replaces a cookie across nested wrappers', async () => {
    const setTo =
      (value: string): Component =>
      async (ctx, next) => {
        await next()
        ctx.cookies.set('sid', value)
      }
    const res = await call(
      new Mixer().mix(setTo('outer'), setTo('inner'), () => 'ok'),
    )
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^sid=outer;/),
    ])
  })

  it('does not carry the original error headers into the 500 when onError fails', async () => {
    quiet()
    const res = await call(
      new Mixer({
        onError: () => {
          throw new Error('onError broke')
        },
      }).mix(() => {
        throw new HttpError(401, 'Sign in', {
          headers: { 'WWW-Authenticate': 'Bearer' },
        })
      }),
    )
    expect(res.status).toBe(500)
    expect(res.headers.get('www-authenticate')).toBeNull()
  })

  it('fails loudly when a kept next() is called after the component returned', async () => {
    let kept: (() => Promise<Response>) | undefined
    await call(
      new Mixer().mix(
        (_ctx, next) => {
          kept = next
        },
        () => 'ok',
      ),
    )
    await expect(kept?.()).rejects.toThrow(/after/)
  })
})

describe('untested paths from the second review', () => {
  it('HEAD through several wrappers sends no body, keeps their headers, and cancels the stream', async () => {
    let cancelled = false
    const add =
      (name: string): Component =>
      async (ctx, next) => {
        await next()
        ctx.headers.set(name, 'yes')
      }
    const app = new Mixer().mix(
      add('X-A'),
      add('X-B'),
      add('X-C'),
      () =>
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
    )
    const res = await call(app, '/', { method: 'HEAD' })
    expect(res.body).toBeNull()
    expect([
      res.headers.get('x-a'),
      res.headers.get('x-b'),
      res.headers.get('x-c'),
    ]).toEqual(['yes', 'yes', 'yes'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(cancelled).toBe(true)
  })

  it('streams a body unchanged through several wrappers', async () => {
    const pass: Component = async (ctx, next) => {
      await next()
      ctx.headers.append('X-Seen', '1')
    }
    const app = new Mixer().mix(
      pass,
      pass,
      pass,
      () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('a'))
            controller.enqueue(new TextEncoder().encode('b'))
            controller.close()
          },
        }),
    )
    const res = await call(app)
    expect(await res.text()).toBe('ab')
    expect(res.headers.get('x-seen')).toBe('1, 1, 1')
  })

  it('runs 50 nested wrappers', async () => {
    const pass: Component = async (_ctx, next) => {
      await next()
    }
    const app = new Mixer().mix(...Array(50).fill(pass), () => 'deep')
    expect(await (await call(app)).text()).toBe('deep')
  })
})

describe('PR review', () => {
  it("adds the parent's headers and cookies to a response from another mixer app", async () => {
    const child = new Mixer().mix(() => 'from child')
    const parent = new Mixer().mix((ctx) => {
      ctx.cookies.set('token', '123')
      ctx.headers.set('X-Parent', 'yes')
      return child.fetch(ctx.request)
    })
    const res = await call(parent)
    expect(await res.text()).toBe('from child')
    expect(res.headers.get('x-parent')).toBe('yes')
    expect(res.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^token=123;/),
    ])
  })

  it.each<[string, Component]>([
    [
      'keeps it',
      async (_ctx, next) => {
        await (await next()).text()
      },
    ],
    [
      'returns it',
      async (_ctx, next) => {
        const res = await next()
        await res.text()
        return res
      },
    ],
  ])(
    'answers 500 when a wrapper reads the body and %s',
    async (_label, wrapper) => {
      quiet()
      const res = await call(new Mixer().mix(wrapper, () => 'ok'))
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    },
  )
})

describe('a next() left running', () => {
  it('cancels the response the rest produces after the component has returned', async () => {
    quiet()
    let cancelled = false
    let finished: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      finished = resolve
    })
    const res = await call(
      new Mixer().mix(
        (_ctx, next) => {
          void next()
          return undefined
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return new ReadableStream({
            cancel() {
              cancelled = true
              finished()
            },
          })
        },
      ),
    )
    expect(res.status).toBe(500)
    await done
    expect(cancelled).toBe(true)
  })
})
