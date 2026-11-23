import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serve } from '../src/bun.js'
import { Mixer } from '../src/index.js'

type Fetch = (request: Request, server: FakeServer) => Promise<Response>
interface FakeServer {
  port: number
  requestIP(request: Request): { address: string } | null
  stop: ReturnType<typeof vi.fn>
}

let started: { hostname?: string; port?: number; fetch: Fetch } | undefined
const fakeServer: FakeServer = {
  port: 4321,
  requestIP: () => ({ address: '203.0.113.5' }),
  stop: vi.fn(async () => {}),
}

beforeEach(() => {
  started = undefined
  vi.stubGlobal('Bun', {
    serve(options: { hostname?: string; port?: number; fetch: Fetch }) {
      started = options
      return fakeServer
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const app = new Mixer().mix((ctx) => ({
  host: ctx.url.host,
  ip: ctx.ip ?? null,
  envIsEmpty: ctx.env === undefined,
}))

function send(host: string | undefined, path = '/') {
  if (!started) throw new Error('serve() did not start Bun.serve')
  const headers = new Headers()
  if (host !== undefined) headers.set('host', host)
  return started.fetch(
    new Request(`http://${host ?? 'localhost'}${path}`, { headers }),
    fakeServer,
  )
}

describe('serve() on Bun', () => {
  it('listens on 127.0.0.1 and any free port by default, and reports the port', async () => {
    const server = await serve(app)
    expect(started).toMatchObject({ hostname: '127.0.0.1', port: 0 })
    expect(server.port).toBe(4321)
  })

  it('passes the hostname and port it is given', async () => {
    await serve(app, { hostname: '0.0.0.0', port: 3000 })
    expect(started).toMatchObject({ hostname: '0.0.0.0', port: 3000 })
  })

  it('hands requests to the app with the peer address, not the Bun server as env', async () => {
    await serve(app)
    const res = await send('localhost:4321')
    expect(await res.json()).toEqual({
      host: 'localhost:4321',
      ip: '203.0.113.5',
      envIsEmpty: true,
    })
  })

  it.each(['evil.example', 'evil.example:4321', 'localhost.evil.example'])(
    'rejects the host name %s with 400, which stops DNS rebinding',
    async (host) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await serve(app)
      const res = await send(host)
      expect(res.status).toBe(400)
    },
  )

  it.each(['localhost', 'app.localhost', '127.0.0.1:4321', '[::1]:4321'])(
    'accepts the local host name %s',
    async (host) => {
      await serve(app)
      expect((await send(host)).status).toBe(200)
    },
  )

  it.each([
    '[:::]',
    '999.999.999.999',
    'localhost:0',
    'localhost,evil.example',
  ])(
    'returns 400 for malformed Host %s before calling the app',
    async (host) => {
      const fetch = vi.fn(async () => new Response('unexpected'))
      await serve({ fetch })
      if (!started) throw new Error('serve() did not start Bun.serve')
      const response = await started.fetch(
        new Request('http://localhost/', { headers: { host } }),
        fakeServer,
      )
      expect(response.status).toBe(400)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('rejects a URL authority that differs from the validated Host', async () => {
    const fetch = vi.fn(async () => new Response('unexpected'))
    await serve({ fetch })
    if (!started) throw new Error('serve() did not start Bun.serve')
    const response = await started.fetch(
      new Request('http://evil.example/foo', {
        headers: { host: 'localhost' },
      }),
      fakeServer,
    )
    expect(response.status).toBe(400)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a request without a Host header', async () => {
    await serve(app)
    expect((await send(undefined)).status).toBe(400)
  })

  it('accepts host names listed in allowedHosts, or any with true', async () => {
    await serve(app, { allowedHosts: ['app.example.com'] })
    expect((await send('app.example.com')).status).toBe(200)
    await serve(app, { allowedHosts: true })
    expect((await send('anything.example')).status).toBe(200)
  })

  it('accepts an explicitly allowed IPv4-mapped IPv6 host', async () => {
    await serve(app, { allowedHosts: ['::ffff:192.0.2.1'] })
    expect((await send('[::ffff:c000:201]')).status).toBe(200)
  })

  it('rejects allowedHosts entries with a port or a wildcard', async () => {
    await expect(
      serve(app, { allowedHosts: ['*.example.com'] }),
    ).rejects.toThrow(/allowedHosts/)
  })

  it('serves a plain fetch handler too', async () => {
    await serve({ fetch: async () => new Response('plain') })
    expect(await (await send('localhost')).text()).toBe('plain')
  })

  it.each(['fetch', 'handle'] as const)(
    'returns an empty 500 and logs synchronous and asynchronous %s failures',
    async (method) => {
      const error = new Error('adapter-test-secret')
      const log = vi.spyOn(console, 'error').mockImplementation(() => {})
      for (const fail of [
        () => {
          throw error
        },
        () => Promise.reject(error),
      ]) {
        await serve({
          fetch: async () => new Response('unused'),
          [method]: fail,
        })
        const response = await send('localhost')
        expect(response.status).toBe(500)
        expect(await response.text()).toBe('')
        expect(log).toHaveBeenLastCalledWith(error)
      }
    },
  )

  it('stops the Bun server on close', async () => {
    const server = await serve(app)
    await server.close()
    expect(fakeServer.stop).toHaveBeenCalled()
  })
})
