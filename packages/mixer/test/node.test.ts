import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Mixer } from '../src/index.js'
import { type ServeOptions, type Server, serve } from '../src/node.js'
import { trackedStream } from './helpers.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

// The host names used by the request tests below
const TEST_HOSTS = ['a.test', 'app.test', 'example.com']

async function start(
  app: Mixer,
  options: ServeOptions = { allowedHosts: TEST_HOSTS },
): Promise<Server> {
  const server = await serve(app, {
    port: 0,
    hostname: '127.0.0.1',
    ...options,
  })
  servers.push(server)
  return server
}

/** Sends a raw HTTP request, so that malformed requests can be tested */
function raw(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request))
    let data = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      data += chunk
    })
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
  })
}

const status = (response: string) => Number(response.split(' ')[1])
const body = (response: string) =>
  response.slice(response.indexOf('\r\n\r\n') + 4)

describe('serve', () => {
  it('serves strings, JSON, and streams', async () => {
    const server = await start(
      new Mixer().mix((ctx) => {
        if (ctx.path === '/json') return { ok: true }
        if (ctx.path === '/stream') return trackedStream(['a', 'b']).stream
        return 'hello'
      }),
    )
    const base = `http://127.0.0.1:${server.port}`
    expect(await (await fetch(base)).text()).toBe('hello')
    expect(await (await fetch(`${base}/json`)).json()).toEqual({ ok: true })
    expect(await (await fetch(`${base}/stream`)).text()).toBe('ab')
  })

  it('writes every Set-Cookie header', async () => {
    const server = await start(
      new Mixer().mix((ctx) => {
        ctx.cookies.set('a', '1')
        ctx.cookies.set('b', '2')
        return 'ok'
      }),
    )
    const res = await fetch(`http://127.0.0.1:${server.port}`)
    expect(res.headers.getSetCookie()).toHaveLength(2)
  })

  it('passes a streamed request body', async () => {
    const server = await start(new Mixer().mix((ctx) => ctx.text()))
    const res = await fetch(`http://127.0.0.1:${server.port}`, {
      method: 'POST',
      body: 'posted body',
    })
    expect(await res.text()).toBe('posted body')
  })

  it('reports the real port and stops accepting connections after close', async () => {
    const server = await serve(
      new Mixer().mix(() => 'ok'),
      {
        port: 0,
        hostname: '127.0.0.1',
      },
    )
    expect(server.port).toBeGreaterThan(0)
    await server.close()
    await expect(fetch(`http://127.0.0.1:${server.port}`)).rejects.toThrow()
  })
})

describe('request URL', () => {
  const echoUrl = () =>
    new Mixer().mix((ctx) => ({
      host: ctx.url.host,
      pathname: ctx.url.pathname,
      path: ctx.path,
      query: ctx.url.search,
    }))

  it('does not treat a path starting with // as a host name', async () => {
    const server = await start(echoUrl())
    const res = await raw(
      server.port,
      'GET //admin/secret?x=1 HTTP/1.1\r\nHost: app.test\r\nConnection: close\r\n\r\n',
    )
    expect(JSON.parse(body(res))).toEqual({
      host: 'app.test',
      pathname: '//admin/secret',
      path: '//admin/secret',
      query: '?x=1',
    })
  })

  it('takes only the path and query from an absolute-form target', async () => {
    const server = await start(echoUrl())
    const res = await raw(
      server.port,
      'GET http://other.test/a?b=1 HTTP/1.1\r\nHost: app.test\r\nConnection: close\r\n\r\n',
    )
    expect(JSON.parse(body(res))).toMatchObject({
      host: 'app.test',
      path: '/a',
      query: '?b=1',
    })
  })

  it.each([
    ['a missing Host', 'GET / HTTP/1.1\r\nConnection: close\r\n\r\n'],
    [
      'two Host headers',
      'GET / HTTP/1.1\r\nHost: a.test\r\nHost: b.test\r\nConnection: close\r\n\r\n',
    ],
    [
      'userinfo in Host',
      'GET / HTTP/1.1\r\nHost: user@a.test\r\nConnection: close\r\n\r\n',
    ],
    [
      'an invalid port',
      'GET / HTTP/1.1\r\nHost: a.test:99999\r\nConnection: close\r\n\r\n',
    ],
    [
      'a path in Host',
      'GET / HTTP/1.1\r\nHost: a.test/evil\r\nConnection: close\r\n\r\n',
    ],
    [
      'an asterisk target',
      'OPTIONS * HTTP/1.1\r\nHost: a.test\r\nConnection: close\r\n\r\n',
    ],
  ])('returns 400 for %s', async (_label, request) => {
    const server = await start(echoUrl())
    expect(status(await raw(server.port, request))).toBe(400)
  })

  it('accepts a Host with an explicit default port', async () => {
    const server = await start(echoUrl())
    const res = await raw(
      server.port,
      'GET /a HTTP/1.1\r\nHost: example.com:80\r\nConnection: close\r\n\r\n',
    )
    expect(status(res)).toBe(200)
    expect(JSON.parse(body(res))).toMatchObject({
      host: 'example.com',
      path: '/a',
    })
  })

  it('returns 400 for port 0 in Host', async () => {
    const server = await start(echoUrl())
    const res = await raw(
      server.port,
      'GET / HTTP/1.1\r\nHost: a.test:0\r\nConnection: close\r\n\r\n',
    )
    expect(status(res)).toBe(400)
  })

  it('accepts an IPv6 host with a port', async () => {
    const server = await start(echoUrl())
    const res = await raw(
      server.port,
      'GET / HTTP/1.1\r\nHost: [::1]:8080\r\nConnection: close\r\n\r\n',
    )
    expect(status(res)).toBe(200)
    expect(JSON.parse(body(res)).host).toBe('[::1]:8080')
  })
})

describe('connections', () => {
  it('responds 413 with Connection: close without reading a body over the limit', async () => {
    const server = await start(
      new Mixer({ bodyLimit: 10 }).mix(async (ctx) => ({
        body: await ctx.text(),
      })),
    )
    const res = await raw(
      server.port,
      `POST / HTTP/1.1\r\nHost: a.test\r\nContent-Length: 100\r\n\r\n${'x'.repeat(20)}`,
    )
    expect(status(res)).toBe(413)
    expect(res.toLowerCase()).toContain('connection: close')
  })

  it('cancels the response stream when the client disconnects mid-stream', async () => {
    let cancelled = false
    let sent = 0
    const server = await start(
      new Mixer().mix(
        () =>
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              sent++
              await new Promise((resolve) => setTimeout(resolve, 20))
              controller.enqueue(new TextEncoder().encode('chunk'))
            },
            cancel() {
              cancelled = true
            },
          }),
      ),
    )
    await new Promise<void>((resolve, reject) => {
      const socket = connect(server.port, '127.0.0.1', () =>
        socket.write('GET / HTTP/1.1\r\nHost: a.test\r\n\r\n'),
      )
      socket.once('data', () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', reject)
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(cancelled).toBe(true)
    const sentAtCancel = sent
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(sent).toBe(sentAtCancel)
  })

  it('aborts ctx.request.signal when the client disconnects during processing', async () => {
    let aborted: boolean | undefined
    const server = await start(
      new Mixer().mix(async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.request.signal.addEventListener('abort', () => resolve())
          setTimeout(resolve, 1000)
        })
        aborted = ctx.request.signal.aborted
        return 'late'
      }),
    )
    await new Promise<void>((resolve) => {
      const socket = connect(server.port, '127.0.0.1', () => {
        socket.write('GET / HTTP/1.1\r\nHost: a.test\r\n\r\n')
        setTimeout(() => {
          socket.destroy()
          resolve()
        }, 50)
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(aborted).toBe(true)
  })
})

describe('allowed hosts', () => {
  const request = (host: string) =>
    `GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`

  it('rejects a host name that is not allowed with an empty 400, without calling the app', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let called = false
    const server = await start(
      new Mixer().mix(() => {
        called = true
        return 'reached'
      }),
      {},
    )
    const res = await raw(server.port, request('evil.example'))
    expect(status(res)).toBe(400)
    expect(body(res)).toBe('')
    expect(called).toBe(false)
  })

  it.each([
    'localhost',
    'localhost:3000',
    'app.localhost',
    '127.0.0.1:8080',
    '[::1]:8080',
  ])('accepts %s by default', async (host) => {
    const server = await start(
      new Mixer().mix(() => 'ok'),
      {},
    )
    expect(status(await raw(server.port, request(host)))).toBe(200)
  })

  it.each([
    'evil.example',
    'localhost.evil.example',
    'evillocalhost',
    '127.0.0.2',
    '10.0.0.1',
  ])('rejects %s by default', async (host) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const server = await start(
      new Mixer().mix(() => 'ok'),
      {},
    )
    expect(status(await raw(server.port, request(host)))).toBe(400)
  })

  it('adds names from allowedHosts by exact match, ignoring case, the port, and a trailing dot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const server = await start(
      new Mixer().mix(() => 'ok'),
      {
        allowedHosts: ['Example.com'],
      },
    )
    for (const host of ['example.com', 'EXAMPLE.COM:8080', 'example.com.']) {
      expect(status(await raw(server.port, request(host)))).toBe(200)
    }
    expect(status(await raw(server.port, request('sub.example.com')))).toBe(400)
    expect(status(await raw(server.port, request('localhost')))).toBe(200)
  })

  it('accepts any well-formed host with allowedHosts: true', async () => {
    const server = await start(
      new Mixer().mix(() => 'ok'),
      {
        allowedHosts: true,
      },
    )
    expect(status(await raw(server.port, request('anything.example')))).toBe(
      200,
    )
    expect(status(await raw(server.port, request('a.test/evil')))).toBe(400)
  })

  it('warns once per server about rejected host names', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const server = await start(
      new Mixer().mix(() => 'ok'),
      {},
    )
    await raw(server.port, request('evil.example'))
    await raw(server.port, request('other.example'))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('allowedHosts')
    warn.mockRestore()
  })

  it.each([
    'example.com:80',
    '',
    'exa mple.com',
    'http://example.com',
    '*.example.com',
  ])('throws for an invalid allowedHosts entry (%j)', async (host) => {
    await expect(
      serve(new Mixer(), {
        port: 0,
        hostname: '127.0.0.1',
        allowedHosts: [host],
      }),
    ).rejects.toThrow()
  })

  it('accepts a scoped IPv6 address as hostname', async () => {
    const loopback = Object.entries(networkInterfaces()).find(([, infos]) =>
      infos?.some((info) => info.address === '::1'),
    )?.[0]
    if (!loopback) return
    const server = await serve(
      new Mixer().mix(() => 'ok'),
      {
        port: 0,
        hostname: `::1%${loopback}`,
      },
    )
    servers.push(server)
    expect(server.port).toBeGreaterThan(0)
  })

  it('listens on the loopback address when hostname is omitted', async () => {
    const server = await serve(
      new Mixer().mix(() => 'ok'),
      { port: 0 },
    )
    servers.push(server)
    expect(status(await raw(server.port, request('localhost')))).toBe(200)
    const external = Object.values(networkInterfaces())
      .flat()
      .find((info) => info?.family === 'IPv4' && !info.internal)?.address
    if (external) {
      await expect(
        new Promise((resolve, reject) => {
          const socket = connect(server.port, external, () => {
            socket.destroy()
            resolve('connected')
          })
          socket.on('error', reject)
        }),
      ).rejects.toThrow()
    }
  })
})

describe('close', () => {
  /** Starts a server whose handler waits until `release` is called */
  async function startHeld() {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let started: () => void = () => {}
    const handling = new Promise<void>((resolve) => {
      started = resolve
    })
    let aborted = false
    const server = await serve(
      new Mixer().mix(async (ctx) => {
        ctx.request.signal.addEventListener('abort', () => {
          aborted = true
        })
        started()
        await Promise.race([
          held,
          new Promise((resolve) =>
            ctx.request.signal.addEventListener('abort', resolve),
          ),
        ])
        return 'done'
      }),
      { port: 0, hostname: '127.0.0.1' },
    )
    return { server, release, handling, wasAborted: () => aborted }
  }

  const request = (port: number) =>
    raw(
      port,
      'GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
    )

  it('waits for requests in progress, and answers them with Connection: close', async () => {
    const { server, release, handling } = await startHeld()
    const response = request(server.port)
    await handling
    let closed = false
    const closing = server.close().then(() => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(closed).toBe(false)
    release()
    const res = await response
    expect(status(res)).toBe(200)
    expect(res).toMatch(/\r\nconnection: close\r\n/i)
    await closing
    expect(closed).toBe(true)
  })

  it('stops accepting new connections once closing', async () => {
    const { server, release, handling } = await startHeld()
    const response = request(server.port)
    await handling
    const closing = server.close()
    await expect(
      new Promise((resolve, reject) => {
        const socket = connect(server.port, '127.0.0.1', () => {
          socket.destroy()
          resolve('connected')
        })
        socket.on('error', reject)
      }),
    ).rejects.toThrow()
    release()
    await response
    await closing
  })

  it('cuts requests still in progress after the timeout, aborting their signal', async () => {
    const { server, handling, wasAborted } = await startHeld()
    request(server.port).catch(() => {})
    await handling
    const start = performance.now()
    await server.close({ timeout: 50 })
    expect(performance.now() - start).toBeLessThan(1_000)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wasAborted()).toBe(true)
  })

  it('does not wait for idle keep-alive connections', async () => {
    const server = await serve(
      new Mixer().mix(() => 'ok'),
      {
        port: 0,
        hostname: '127.0.0.1',
      },
    )
    const socket = connect(server.port, '127.0.0.1')
    await new Promise<void>((resolve) => {
      socket.on('data', () => resolve())
      socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n')
    })
    const start = performance.now()
    await server.close()
    expect(performance.now() - start).toBeLessThan(1_000)
    socket.destroy()
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid timeout (%s)',
    async (timeout) => {
      const server = await start(new Mixer())
      await expect(server.close({ timeout })).rejects.toThrow(/timeout/)
    },
  )
})
