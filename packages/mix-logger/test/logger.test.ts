import { HttpError, Mixer } from '@imatomix/mixer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatLogEvent,
  type LogEvent,
  type LoggerOptions,
  type LoggerState,
  logger,
} from '../src/index.js'
import { call } from './helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function collect() {
  const events: LogEvent[] = []
  return { events, write: (event: LogEvent) => void events.push(event) }
}

function logged(
  options: LoggerOptions,
  ...components: Parameters<Mixer<LoggerState>['mix']>
) {
  return new Mixer<LoggerState>().mix(logger(options), ...components)
}

describe('access events', () => {
  it('records the method, path, status, duration, Content-Length, and request ID', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, () => 'hello'),
      '/greet',
      {
        method: 'POST',
      },
    )
    expect(log.events).toHaveLength(1)
    const [event] = log.events
    expect(event).toMatchObject({
      kind: 'access',
      level: 'info',
      method: 'POST',
      path: '/greet',
      status: 200,
      contentLength: 5,
    })
    expect(event?.requestId).toMatch(UUID)
    expect(event?.durationMs).toBeGreaterThanOrEqual(0)
    expect(event?.time).toBeInstanceOf(Date)
  })

  it('leaves contentLength out when the length is unknown', async () => {
    const log = collect()
    await call(
      logged(
        { write: log.write },
        () => new ReadableStream({ start: (controller) => controller.close() }),
      ),
    )
    expect(log.events[0]).not.toHaveProperty('contentLength')
  })

  it('does not record the query', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, () => 'ok'),
      '/reset?token=abc&email=a@example.com',
    )
    expect(log.events[0]?.path).toBe('/reset')
  })

  it('records the full path including basePath', async () => {
    const log = collect()
    const target = new Mixer<LoggerState>({ basePath: '/api' }).mix(
      logger({ write: log.write }),
      () => 'ok',
    )
    await call(target, '/api/users')
    expect(log.events[0]?.path).toBe('/api/users')
  })

  it.each([
    [
      'an HttpError',
      () => {
        throw new HttpError(403)
      },
      403,
    ],
    ['no response', () => undefined, 404],
  ])('records the status for %s', async (_label, component, status) => {
    const log = collect()
    await call(logged({ write: log.write }, component))
    expect(log.events.map((event) => event.status)).toEqual([status])
  })

  it('does not mix up durations of concurrent requests', async () => {
    const log = collect()
    const target = logged({ write: log.write }, async (ctx) => {
      if (ctx.path === '/slow') {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return 'ok'
    })
    const slow = call(target, '/slow')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await call(target, '/fast')
    await slow
    const byPath = Object.fromEntries(
      log.events.map((event) => [event.path, event.durationMs]),
    )
    expect(byPath['/slow']).toBeGreaterThanOrEqual(90)
    expect(byPath['/fast']).toBeLessThan(50)
  })
})

describe('request-scoped logs', () => {
  it('gives handlers a logger whose events carry the request ID, method, and path', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, (ctx) => {
        ctx.state.log.info('created', { todoId: 7 })
        ctx.state.log.warn('slow')
        return 'ok'
      }),
      '/todos',
      { method: 'POST' },
    )
    const [created, slow, access] = log.events
    expect(created).toMatchObject({
      kind: 'app',
      level: 'info',
      message: 'created',
      method: 'POST',
      path: '/todos',
      fields: { todoId: 7 },
    })
    expect(slow).toMatchObject({ kind: 'app', level: 'warn', message: 'slow' })
    expect(created?.requestId).toBe(access?.requestId)
    expect(slow?.requestId).toBe(access?.requestId)
  })

  it('exposes the request ID to handlers', async () => {
    const log = collect()
    const res = await call(
      logged({ write: log.write }, (ctx) => ctx.state.log.requestId),
    )
    expect(await res.text()).toBe(log.events[0]?.requestId)
  })

  it('uses a different ID for every request', async () => {
    const log = collect()
    const target = logged({ write: log.write }, () => 'ok')
    await call(target)
    await call(target)
    expect(log.events[0]?.requestId).not.toBe(log.events[1]?.requestId)
  })
})

describe('error events', () => {
  it('records an unexpected error with its stack and the request ID', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, () => {
        throw new TypeError('boom')
      }),
      '/todos',
    )
    const [error, access] = log.events
    expect(error).toMatchObject({
      kind: 'error',
      level: 'error',
      phase: 'handling',
      path: '/todos',
      error: { name: 'TypeError', message: 'boom' },
    })
    expect(error?.error?.stack).toContain('TypeError: boom')
    expect(error?.requestId).toBe(access?.requestId)
    expect(access?.status).toBe(500)
  })

  it('records errors after the response, such as a failing waitUntil', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, (ctx) => {
        ctx.waitUntil(Promise.reject('plain value'))
        return 'ok'
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log.events).toContainEqual(
      expect.objectContaining({
        kind: 'error',
        phase: 'waitUntil',
        error: { message: 'plain value' },
      }),
    )
  })

  it('keeps mixer from logging the error on its own', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = collect()
    await call(
      logged({ write: log.write }, () => {
        throw new Error('boom')
      }),
    )
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('X-Request-Id', () => {
  it('sends the request ID on every response, including errors', async () => {
    const log = collect()
    const target = logged({ write: log.write }, (ctx) => {
      if (ctx.path === '/fail') throw new Error('boom')
      if (ctx.path === '/missing') return undefined
      return 'ok'
    })
    for (const path of ['/', '/fail', '/missing']) {
      const res = await call(target, path)
      expect(res.headers.get('x-request-id')).toMatch(UUID)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('replaces a value a handler set, so the response matches the logs', async () => {
    const log = collect()
    const res = await call(
      logged({ write: log.write }, (ctx) => {
        ctx.headers.set('X-Request-Id', 'other')
        return 'ok'
      }),
    )
    expect(res.headers.get('x-request-id')).toBe(log.events[0]?.requestId)
  })

  it("keeps a returned Response's own value, which then differs from the logs", async () => {
    const log = collect()
    const res = await call(
      logged(
        { write: log.write },
        () => new Response('ok', { headers: { 'X-Request-Id': 'upstream' } }),
      ),
    )
    expect(res.headers.get('x-request-id')).toBe('upstream')
    expect(log.events[0]?.requestId).not.toBe('upstream')
  })

  it('uses another header name or none', async () => {
    const renamed = await call(
      logged({ write: () => {}, header: 'X-Correlation-Id' }, () => 'ok'),
    )
    expect(renamed.headers.get('x-correlation-id')).toMatch(UUID)
    expect(renamed.headers.get('x-request-id')).toBeNull()

    const none = await call(
      logged({ write: () => {}, header: false }, () => 'ok'),
    )
    expect(none.headers.get('x-request-id')).toBeNull()
  })

  it('rejects a header name that is not a token', () => {
    expect(() => logger({ header: 'X Request Id' })).toThrow(/header/)
  })
})

describe('requestId option', () => {
  it('takes an ID from the request, such as one the platform added', async () => {
    const log = collect()
    await call(
      logged(
        {
          write: log.write,
          requestId: (ctx) => ctx.request.headers.get('cf-ray') ?? undefined,
        },
        () => 'ok',
      ),
      '/',
      { headers: { 'cf-ray': '8a1b2c3d4e5f6a7b-NRT' } },
    )
    expect(log.events[0]?.requestId).toBe('8a1b2c3d4e5f6a7b-NRT')
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['with a line break', 'a\nb'],
    ['with spaces', 'a b'],
    ['too long', 'a'.repeat(129)],
  ])('generates one when the value is %s', async (_label, value) => {
    const log = collect()
    await call(logged({ write: log.write, requestId: () => value }, () => 'ok'))
    expect(log.events[0]?.requestId).toMatch(UUID)
  })

  it('ignores an incoming X-Request-Id by default', async () => {
    const log = collect()
    await call(
      logged({ write: log.write }, () => 'ok'),
      '/',
      {
        headers: { 'x-request-id': 'forged' },
      },
    )
    expect(log.events[0]?.requestId).toMatch(UUID)
  })
})

describe('output', () => {
  it('writes one JSON line per event through console.log by default', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(
      logged({}, (ctx) => {
        ctx.state.log.info('hi\nFAKE', { n: 1 })
        return 'hello'
      }),
      '/greet',
    )
    expect(consoleLog).toHaveBeenCalledTimes(2)
    const lines = consoleLog.mock.calls.map((args) => String(args[0]))
    for (const line of lines) expect(line).not.toMatch(/[\n\r]/)
    const [app, access] = lines.map((line) => JSON.parse(line))
    expect(app).toMatchObject({
      kind: 'app',
      level: 'info',
      message: 'hi\nFAKE',
      n: 1,
      path: '/greet',
    })
    expect(access).toMatchObject({ kind: 'access', status: 200 })
    expect(access.time).toMatch(/^\d{4}-\d{2}-\d{2}T\S+Z$/)
  })

  it('writes error events through console.error', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await call(
      logged({}, () => {
        throw new Error('boom')
      }),
    )
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toMatchObject({
      kind: 'error',
      error: { name: 'Error', message: 'boom' },
    })
    expect(consoleLog).toHaveBeenCalledTimes(1)
  })

  it('keeps the fixed fields when a handler passes fields with the same names', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(
      logged({}, (ctx) => {
        ctx.state.log.info('x', { requestId: 'forged', level: 'error' })
        return 'ok'
      }),
    )
    const app = JSON.parse(String(consoleLog.mock.calls[0]?.[0]))
    expect(app.requestId).not.toBe('forged')
    expect(app.level).toBe('info')
  })

  it('keeps the fixed fields when the fields object has its own toJSON', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(
      logged({}, (ctx) => {
        ctx.state.log.info('x', {
          toJSON: () => ({ requestId: 'forged', level: 'error' }),
        })
        return 'ok'
      }),
    )
    const app = JSON.parse(String(consoleLog.mock.calls[0]?.[0]))
    expect(app.requestId).not.toBe('forged')
    expect(app).toMatchObject({ level: 'info', kind: 'app', message: 'x' })
  })

  it('writes fields that JSON cannot hold without failing', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    const circular: Record<string, unknown> = {}
    circular.self = circular
    await call(
      logged({}, (ctx) => {
        ctx.state.log.info('odd', {
          big: 10n,
          error: new Error('inner'),
          circular,
        })
        return 'ok'
      }),
    )
    const app = JSON.parse(String(consoleLog.mock.calls[0]?.[0]))
    expect(app.message).toBe('odd')
  })

  it("writes one text line per event with write: 'text'", async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(
      logged({ write: 'text' }, () => 'hello'),
      '/greet',
    )
    expect(consoleLog.mock.calls[0]?.[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\S+Z INFO GET \/greet 200 \d+\.\dms 5B [0-9a-f-]{36}$/,
    )
  })

  it('does not affect the response when write throws, and says which request it was for', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = logged(
      {
        write: () => {
          throw new Error('disk full')
        },
      },
      () => 'ok',
    )
    const res = await call(target, '/todos')
    expect(await res.text()).toBe('ok')
    expect(consoleError).toHaveBeenCalledWith(
      'mix-logger: write failed',
      {
        requestId: res.headers.get('x-request-id'),
        method: 'GET',
        path: '/todos',
      },
      expect.objectContaining({ message: 'disk full' }),
    )
  })

  it('hands an asynchronous write to waitUntil and catches its failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()
    const target = logged(
      { write: () => Promise.reject(new Error('remote down')) },
      () => 'ok',
    )
    const res = await target.fetch(
      new Request('http://localhost/'),
      undefined,
      {
        waitUntil,
      },
    )
    expect(await res.text()).toBe('ok')
    expect(waitUntil).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(consoleError).toHaveBeenCalledWith(
      'mix-logger: write failed',
      { requestId: expect.stringMatching(UUID), method: 'GET', path: '/' },
      expect.objectContaining({ message: 'remote down' }),
    )
  })
})

describe('formatLogEvent', () => {
  const base = {
    time: new Date('2026-01-01T00:00:00Z'),
    requestId: 'id-1',
    method: 'GET',
    path: '/',
  }

  it('escapes control characters so that log lines cannot be forged', () => {
    const line = formatLogEvent({
      ...base,
      kind: 'app',
      level: 'info',
      method: 'GET\u001b[31m',
      path: '/a\nFAKE\r\u0000',
      message: 'm\n2026-01-01 INFO fake',
    })
    expect(line).toBe(
      '2026-01-01T00:00:00.000Z INFO GET\\x1b[31m /a\\nFAKE\\r\\x00 m\\n2026-01-01 INFO fake id-1',
    )
  })

  it('shows an access event', () => {
    expect(
      formatLogEvent({
        ...base,
        kind: 'access',
        level: 'info',
        status: 200,
        durationMs: 1.234,
        contentLength: 10,
      }),
    ).toBe('2026-01-01T00:00:00.000Z INFO GET / 200 1.2ms 10B id-1')
  })

  it('shows an error with its stack frames on the following lines', () => {
    const line = formatLogEvent({
      ...base,
      kind: 'error',
      level: 'error',
      phase: 'handling',
      error: {
        name: 'Error',
        message: 'bad\ninput',
        stack: 'Error: bad\ninput\n    at handler (app.ts:1:1)',
      },
    })
    expect(line).toBe(
      '2026-01-01T00:00:00.000Z ERROR GET / (handling) Error: bad\\ninput id-1\n    at handler (app.ts:1:1)',
    )
  })
})
