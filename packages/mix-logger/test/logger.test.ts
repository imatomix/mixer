import { HttpError, Mixer } from '@imatomix/mixer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatLogEntry, type LogEntry, logger } from '../src/index.js'
import { app, call } from './helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function collect() {
  const entries: LogEntry[] = []
  return { entries, write: (entry: LogEntry) => void entries.push(entry) }
}

describe('recording', () => {
  it('records the method, path, status, duration, and Content-Length once the Response is ready', async () => {
    const log = collect()
    const target = app(logger({ write: log.write }), () => 'hello')
    await call(target, '/greet', { method: 'POST' })
    expect(log.entries).toHaveLength(1)
    const [entry] = log.entries
    expect(entry).toMatchObject({
      method: 'POST',
      path: '/greet',
      status: 200,
      contentLength: 5,
    })
    expect(entry).not.toHaveProperty('aborted')
    expect(entry?.responseDurationMs).toBeGreaterThanOrEqual(0)
    expect(entry?.time).toBeInstanceOf(Date)
  })

  it('leaves contentLength out when the length is unknown', async () => {
    const log = collect()
    const target = app(
      logger({ write: log.write }),
      () => new ReadableStream({ start: (controller) => controller.close() }),
    )
    await call(target)
    expect(log.entries[0]).not.toHaveProperty('contentLength')
  })

  it('does not record the query', async () => {
    const log = collect()
    const target = app(logger({ write: log.write }), () => 'ok')
    await call(target, '/reset?token=abc&email=a@example.com')
    expect(log.entries[0]?.path).toBe('/reset')
  })

  it('records the full path including basePath', async () => {
    const log = collect()
    const target = new Mixer({ basePath: '/api' }).mix(
      logger({ write: log.write }),
      () => 'ok',
    )
    await call(target, '/api/users')
    expect(log.entries[0]?.path).toBe('/api/users')
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
    await call(app(logger({ write: log.write }), component))
    expect(log.entries.map((entry) => entry.status)).toEqual([status])
  })

  it('does not mix up durations of concurrent requests', async () => {
    const log = collect()
    const target = app(logger({ write: log.write }), async (ctx) => {
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
      log.entries.map((e) => [e.path, e.responseDurationMs]),
    )
    expect(byPath['/slow']).toBeGreaterThanOrEqual(90)
    expect(byPath['/fast']).toBeLessThan(50)
  })
})

describe('output', () => {
  it('writes one line through console.log by default', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await call(
      app(logger(), () => 'hello'),
      '/greet',
    )
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\S+Z GET \/greet 200 \d+\.\dms 5B$/,
    )
  })

  it('does not affect the response when write throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = app(
      logger({
        write: () => {
          throw new Error('disk full')
        },
      }),
      () => 'ok',
    )
    expect(await (await call(target)).text()).toBe('ok')
    expect(await (await call(target)).text()).toBe('ok')
    expect(consoleError).toHaveBeenCalled()
  })

  it('does not wait for an asynchronous write, hands it to waitUntil, and catches its failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const waitUntil = vi.fn()
    let finish: () => void = () => {}
    const target = app(
      logger({
        write: () =>
          new Promise<void>((_resolve, reject) => {
            finish = () => reject(new Error('remote down'))
          }),
      }),
      () => 'ok',
    )
    const res = await target.fetch(
      new Request('http://localhost/'),
      undefined,
      { waitUntil },
    )
    expect(await res.text()).toBe('ok')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    finish()
    await waitUntil.mock.calls[0]?.[0]
    expect(consoleError).toHaveBeenCalled()
  })
})

describe('formatLogEntry', () => {
  const base: LogEntry = {
    time: new Date('2026-01-01T00:00:00Z'),
    method: 'GET',
    path: '/',
    status: 200,
    responseDurationMs: 1.234,
  }

  it('escapes control characters so that log lines cannot be forged', () => {
    const line = formatLogEntry({
      ...base,
      method: 'GET\u001b[31m',
      path: '/a\nFAKE 200 0.0ms\r\u0000',
    })
    expect(line).toBe(
      '2026-01-01T00:00:00.000Z GET\\x1b[31m /a\\nFAKE 200 0.0ms\\r\\x00 200 1.2ms',
    )
    const hasControl = [...line].some((char) => {
      const code = char.charCodeAt(0)
      return code < 0x20 || code === 0x7f
    })
    expect(hasControl).toBe(false)
  })

  it('shows contentLength', () => {
    expect(formatLogEntry({ ...base, contentLength: 10 })).toBe(
      '2026-01-01T00:00:00.000Z GET / 200 1.2ms 10B',
    )
  })
})
