import { request } from 'node:http'
import { Readable } from 'node:stream'
import { HttpError } from '@imatomix/mixer'
import { describe, expect, it, vi } from 'vitest'
import { formatLogEntry, type LogEntry, logger } from '../src/index.js'
import { serve } from './helpers.js'

/** Entries are recorded after the response finishes, so wait for them */
function collect() {
  const entries: LogEntry[] = []
  let notify: () => void = () => {}
  return {
    entries,
    write: (entry: LogEntry) => {
      entries.push(entry)
      notify()
    },
    next: () =>
      new Promise<void>((resolve) => {
        notify = resolve
      }),
  }
}

describe('recording', () => {
  it('records the method, path, status, duration, and Content-Length', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), () => 'hello')
    const recorded = log.next()
    await (await fetch(`${url}/greet`, { method: 'POST' })).text()
    await recorded
    expect(log.entries).toHaveLength(1)
    const [entry] = log.entries
    expect(entry).toMatchObject({
      method: 'POST',
      path: '/greet',
      status: 200,
      contentLength: 5,
      aborted: false,
    })
    expect(entry?.durationMs).toBeGreaterThanOrEqual(0)
    expect(entry?.time).toBeInstanceOf(Date)
  })

  it('does not record the query', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), () => 'ok')
    const recorded = log.next()
    await (await fetch(`${url}/reset?token=abc&email=a@example.com`)).text()
    await recorded
    expect(log.entries[0]?.path).toBe('/reset')
  })

  it('records the status of error responses', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), () => {
      throw new HttpError(403)
    })
    const recorded = log.next()
    await (await fetch(url)).text()
    await recorded
    expect(log.entries[0]?.status).toBe(403)
  })

  it('does not mix up durations of concurrent requests', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), async (ctx) => {
      if (ctx.url.pathname === '/slow') {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      return 'ok'
    })
    const slow = fetch(`${url}/slow`).then((res) => res.text())
    await new Promise((resolve) => setTimeout(resolve, 20))
    await (await fetch(`${url}/fast`)).text()
    await slow
    await new Promise((resolve) => setTimeout(resolve, 20))
    const byPath = Object.fromEntries(
      log.entries.map((e) => [e.path, e.durationMs]),
    )
    expect(byPath['/slow']).toBeGreaterThanOrEqual(90)
    expect(byPath['/fast']).toBeLessThan(50)
  })

  it('records an interrupted response once, as aborted', async () => {
    const log = collect()
    const url = new URL(
      await serve(logger({ write: log.write }), () =>
        Readable.from(
          (async function* () {
            yield 'first'
            await new Promise((resolve) => setTimeout(resolve, 200))
            yield 'second'
          })(),
        ),
      ),
    )
    const recorded = log.next()
    const req = request(
      { hostname: url.hostname, port: url.port, path: '/stream' },
      (res) => {
        res.once('data', () => req.destroy())
      },
    )
    req.on('error', () => {})
    req.end()
    await recorded
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(log.entries).toHaveLength(1)
    expect(log.entries[0]?.aborted).toBe(true)
  })
})

describe('output', () => {
  it('writes one line of text to standard output by default', async () => {
    const written: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk) => {
        written.push(String(chunk))
        return true
      })
    try {
      const url = await serve(logger(), () => 'hello')
      await (await fetch(`${url}/greet`)).text()
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      spy.mockRestore()
    }
    const line = written.find((chunk) => chunk.includes('/greet'))
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\S+Z GET \/greet 200 \d+\.\dms 5B\n$/,
    )
  })

  it('does not affect the response or the server when write throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const url = await serve(
        logger({
          write: () => {
            throw new Error('disk full')
          },
        }),
        () => 'ok',
      )
      expect(await (await fetch(url)).text()).toBe('ok')
      expect(await (await fetch(url)).text()).toBe('ok')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('catches asynchronous failures of write', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const url = await serve(
        logger({ write: () => Promise.reject(new Error('remote down')) }),
        () => 'ok',
      )
      expect(await (await fetch(url)).text()).toBe('ok')
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(consoleError).toHaveBeenCalled()
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      consoleError.mockRestore()
    }
  })
})

describe('formatLogEntry', () => {
  const base: LogEntry = {
    time: new Date('2026-01-01T00:00:00Z'),
    method: 'GET',
    path: '/',
    status: 200,
    durationMs: 1.234,
    aborted: false,
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

  it('shows aborted and contentLength', () => {
    expect(formatLogEntry({ ...base, contentLength: 10, aborted: true })).toBe(
      '2026-01-01T00:00:00.000Z GET / 200 1.2ms 10B aborted',
    )
  })
})
