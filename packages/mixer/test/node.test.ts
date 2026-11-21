import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Mixer } from '../src/index.js'
import { type Server, serve } from '../src/node.js'
import { trackedStream } from './helpers.js'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

async function start(app: Mixer): Promise<Server> {
  const server = await serve(app, { port: 0, hostname: '127.0.0.1' })
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
