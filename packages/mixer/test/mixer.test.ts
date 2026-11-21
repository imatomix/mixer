import { connect } from 'node:net'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { HttpError, Mixer } from '../src/index.js'
import { serve } from './helpers.js'

describe('responses', () => {
  it('returns a returned string as text/plain', async () => {
    const url = await serve((app) => app.mix(() => 'Hello Mixer'))
    const res = await fetch(url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('Hello Mixer')
  })

  it('returns a returned object as JSON', async () => {
    const url = await serve((app) => app.mix(() => ({ ok: true })))
    const res = await fetch(url)
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 0, false, and an empty string as values', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        const value = ctx.url.searchParams.get('v')
        if (value === 'zero') return 0
        if (value === 'false') return false
        return ''
      }),
    )
    expect(await (await fetch(`${url}?v=zero`)).json()).toBe(0)
    expect(await (await fetch(`${url}?v=false`)).json()).toBe(false)
    const empty = await fetch(url)
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('')
  })

  it('uses ctx.status for the status of a returned value', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.status = 201
        return { created: true }
      }),
    )
    expect((await fetch(url)).status).toBe(201)
  })

  it('returns 204 for null', async () => {
    const url = await serve((app) => app.mix(() => null))
    const res = await fetch(url)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('returns a Buffer as octet-stream and keeps the status', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ctx.send(202, Buffer.from([1, 2, 3]))),
    )
    const res = await fetch(url)
    expect(res.status).toBe(202)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })

  it('streams a Readable as is', async () => {
    const url = await serve((app) => app.mix(() => Readable.from(['a', 'b'])))
    expect(await (await fetch(url)).text()).toBe('ab')
  })

  it('does not override a Content-Type that was set earlier', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8')
        return '<h1>hi</h1>'
      }),
    )
    expect((await fetch(url)).headers.get('content-type')).toBe(
      'text/html; charset=utf-8',
    )
  })

  it('sets Content-Length in bytes for multibyte characters', async () => {
    const url = await serve((app) => app.mix(() => 'こんにちは'))
    const res = await fetch(url)
    expect(res.headers.get('content-length')).toBe('15')
    expect(await res.text()).toBe('こんにちは')
  })
})

describe('chaining components', () => {
  it('runs components in mix order and stops at the first returned value', async () => {
    const calls: string[] = []
    const url = await serve((app) =>
      app
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
        ),
    )
    expect(await (await fetch(url)).text()).toBe('done')
    expect(calls).toEqual(['a', 'b'])
  })

  it('passes values to later components through ctx.state', async () => {
    const url = await serve<{ user?: string }>((app) =>
      app
        .mix((ctx) => {
          ctx.state.user = 'imatomix'
        })
        .mix((ctx) => `hello ${ctx.state.user}`),
    )
    expect(await (await fetch(url)).text()).toBe('hello imatomix')
  })

  it('does not run later components after responding through res directly', async () => {
    const after = vi.fn()
    const url = await serve((app) =>
      app
        .mix((ctx) => {
          ctx.res.statusCode = 418
          ctx.res.end('teapot')
        })
        .mix(after),
    )
    const res = await fetch(url)
    expect(res.status).toBe(418)
    expect(await res.text()).toBe('teapot')
    expect(after).not.toHaveBeenCalled()
  })

  it('does not add properties to req and res', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({
        reqHasBody: 'body' in ctx.req,
        resHasSend: 'send' in ctx.res,
      })),
    )
    expect(await (await fetch(url)).json()).toEqual({
      reqHasBody: false,
      resHasSend: false,
    })
  })

  it('returns 404 when no component responds', async () => {
    const url = await serve((app) => app.mix(() => {}))
    const res = await fetch(url)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not Found' })
  })
})

describe('error handling', () => {
  it('returns the status and message of an HttpError', async () => {
    const url = await serve((app) =>
      app.mix(() => {
        throw new HttpError(403, 'Forbidden')
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('turns unexpected errors into 500 and hides the details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = await serve((app) =>
      app.mix(() => {
        throw new Error('secret detail')
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal Server Error' })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('lets onError replace the error response', async () => {
    const url = await serve(
      (app) =>
        app.mix(() => {
          throw new Error('boom')
        }),
      {
        onError: (error, ctx) =>
          ctx.send(503, { message: (error as Error).message }),
      },
    )
    const res = await fetch(url)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ message: 'boom' })
  })
  it('returns the default error response when onError does not respond', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const url = await serve(
      (app) =>
        app.mix(() => {
          throw new Error('boom')
        }),
      { onError: () => {} },
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    consoleError.mockRestore()
  })

  it.each([200, 302, 99, 600, 404.5])(
    'HttpError rejects a status that is not 4xx or 5xx (%s)',
    (status) => {
      expect(() => new HttpError(status)).toThrow(RangeError)
    },
  )
})

describe('request body', () => {
  const echoBody = (app: Mixer) =>
    app.mix(async (ctx) => ({ body: await ctx.body() }))

  it('parses application/json as JSON', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'ミキサー' }),
    })
    expect(await res.json()).toEqual({ body: { name: 'ミキサー' } })
  })

  it('parses forms and turns repeated keys into arrays', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams('a=1&b=2&b=3'),
    })
    expect(await res.json()).toEqual({ body: { a: '1', b: ['2', '3'] } })
  })

  it('treats __proto__ and constructor as plain keys', async () => {
    const url = await serve((app) =>
      app.mix(async (ctx) => {
        const body = (await ctx.body()) as Record<string, unknown>
        return {
          keys: Object.keys(body),
          proto: Object.getPrototypeOf(body),
          body,
        }
      }),
    )
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams('__proto__=x&constructor=y&constructor=z'),
    })
    expect(await res.json()).toEqual({
      keys: ['__proto__', 'constructor'],
      proto: null,
      body: { ['__proto__']: 'x', constructor: ['y', 'z'] },
    })
  })

  it('treats text/* as a string', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, { method: 'POST', body: 'plain text' })
    expect(await res.json()).toEqual({ body: 'plain text' })
  })

  it('returns undefined for an empty body', async () => {
    const url = await serve((app) =>
      app.mix(async (ctx) => ({
        isUndefined: (await ctx.body()) === undefined,
      })),
    )
    expect(await (await fetch(url)).json()).toEqual({ isUndefined: true })
  })

  it('returns the same content however many times body() and text() are called', async () => {
    const url = await serve((app) =>
      app.mix(async (ctx) => ({
        text: await ctx.text(),
        body: await ctx.body(),
        again: await ctx.text(),
      })),
    )
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"x":1}',
    })
    expect(await res.json()).toEqual({
      text: '{"x":1}',
      body: { x: 1 },
      again: '{"x":1}',
    })
  })

  it('restores multibyte characters split across chunks', async () => {
    const url = await serve((app) => app.mix((ctx) => ctx.text()))
    const encoded = Buffer.from('あいう')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.subarray(0, 4))
        controller.enqueue(encoded.subarray(4))
        controller.close()
      },
    })
    const res = await fetch(url, { method: 'POST', body, duplex: 'half' })
    expect(await res.text()).toBe('あいう')
  })

  it('returns 400 for invalid JSON', async () => {
    const url = await serve(echoBody)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{broken',
    })
    expect(res.status).toBe(400)
  })

  it('returns 413 for a body over the limit', async () => {
    const url = await serve(echoBody, { bodyLimit: 10 })
    const res = await fetch(url, { method: 'POST', body: 'x'.repeat(100) })
    expect(res.status).toBe(413)
  })

  it('returns 413 when the body exceeds the limit without Content-Length', async () => {
    const url = await serve(echoBody, { bodyLimit: 10 })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(Buffer.from('xxxxx'))
        controller.close()
      },
    })
    const res = await fetch(url, { method: 'POST', body, duplex: 'half' })
    expect(res.status).toBe(413)
  })
})

describe('server', () => {
  it('gives each instance its own server', async () => {
    const urlA = await serve((app) => app.mix(() => 'A'))
    const urlB = await serve((app) => app.mix(() => 'B'))
    expect(urlA).not.toBe(urlB)
    expect(await (await fetch(urlA)).text()).toBe('A')
    expect(await (await fetch(urlB)).text()).toBe('B')
  })

  it('can pass handler to any http server', async () => {
    const { createServer } = await import('node:http')
    const app = new Mixer().mix(() => 'via handler')
    const server = createServer(app.handler)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    try {
      expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe(
        'via handler',
      )
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('throws when listen is called twice', async () => {
    const app = new Mixer()
    await app.listen(0, '127.0.0.1')
    try {
      await expect(app.listen(0, '127.0.0.1')).rejects.toThrow(
        'already listening',
      )
    } finally {
      await app.close()
    }
  })
})

describe('onBeforeSend', () => {
  it('runs hooks in registration order right before responding and lets them add headers', async () => {
    const url = await serve((app) =>
      app
        .mix((ctx) => {
          ctx.onBeforeSend(() => {
            ctx.res.appendHeader('x-order', 'first')
          })
          ctx.onBeforeSend(async () => {
            await Promise.resolve()
            ctx.res.appendHeader('x-order', 'second')
          })
        })
        .mix(() => 'ok'),
    )
    const res = await fetch(url)
    expect(res.headers.get('x-order')).toBe('first, second')
    expect(await res.text()).toBe('ok')
  })

  it('lets hooks see state changed by later components', async () => {
    const url = await serve<{ visits?: number }>((app) =>
      app
        .mix((ctx) => {
          ctx.onBeforeSend(() => {
            ctx.res.setHeader('x-visits', String(ctx.state.visits))
          })
        })
        .mix((ctx) => {
          ctx.state.visits = 3
          return 'ok'
        }),
    )
    expect((await fetch(url)).headers.get('x-visits')).toBe('3')
  })

  it('lets hooks change ctx.status', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          ctx.status = 202
        })
        return 'ok'
      }),
    )
    expect((await fetch(url)).status).toBe(202)
  })

  it('runs before error responses as well', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          ctx.res.setHeader('x-hooked', 'yes')
        })
        throw new HttpError(400)
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(400)
    expect(res.headers.get('x-hooked')).toBe('yes')
  })

  it('returns 500 when a hook fails and does not run the hooks again', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          calls++
          throw new Error('hook failed')
        })
        return 'ok'
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    expect(calls).toBe(1)
    consoleError.mockRestore()
  })
})

describe('onBeforeSend failures', () => {
  it('destroys the stream that was about to be sent when a hook fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let destroyed = false
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.onBeforeSend(() => {
          throw new Error('store down')
        })
        const stream = new Readable({ read() {} })
        stream.on('close', () => {
          destroyed = true
        })
        return stream
      }),
    )
    const res = await fetch(url)
    expect(res.status).toBe(500)
    await new Promise((resolve) => setImmediate(resolve))
    expect(destroyed).toBe(true)
    consoleError.mockRestore()
  })
})

describe('ctx.url', () => {
  it('does not treat a path starting with // as a host name', async () => {
    const url = await serve((app) =>
      app.mix((ctx) => ({ host: ctx.url.host, pathname: ctx.url.pathname })),
    )
    const res = await fetch(`${url}//admin/secret?x=1`)
    expect(await res.json()).toEqual({
      host: 'localhost',
      pathname: '//admin/secret',
    })
  })
  it('returns 400 for an unparsable request target', async () => {
    const url = new URL(await serve((app) => app.mix(() => 'ok')))
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.end(
          'GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
        )
      })
      let data = ''
      socket.on('data', (chunk) => {
        data += chunk
      })
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(response).toMatch(/^HTTP\/1\.1 400/)
  })
})

describe('HEAD', () => {
  it('destroys a stream body without reading it and sends only the headers', async () => {
    let read = false
    let destroyed = false
    const url = await serve((app) =>
      app.mix((ctx) => {
        ctx.res.setHeader('Content-Length', '5')
        const stream = new Readable({
          read() {
            read = true
            this.push('hello')
            this.push(null)
          },
        })
        stream.on('close', () => {
          destroyed = true
        })
        return stream
      }),
    )
    const res = await fetch(url, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('5')
    expect(await res.text()).toBe('')
    await new Promise((resolve) => setImmediate(resolve))
    expect(read).toBe(false)
    expect(destroyed).toBe(true)
  })
})
