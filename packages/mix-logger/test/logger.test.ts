import { request } from 'node:http'
import { Readable } from 'node:stream'
import { HttpError } from '@imatomix/mixer'
import { describe, expect, it, vi } from 'vitest'
import { formatLogEntry, type LogEntry, logger } from '../src/index.js'
import { serve } from './helpers.js'

/** 応答が終わってから記録されるので、記録が届くのを待つ */
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

describe('記録', () => {
  it('メソッド・パス・ステータス・処理時間・Content-Length を記録する', async () => {
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

  it('クエリは記録しない', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), () => 'ok')
    const recorded = log.next()
    await (await fetch(`${url}/reset?token=abc&email=a@example.com`)).text()
    await recorded
    expect(log.entries[0]?.path).toBe('/reset')
  })

  it('エラー応答のステータスも記録する', async () => {
    const log = collect()
    const url = await serve(logger({ write: log.write }), () => {
      throw new HttpError(403)
    })
    const recorded = log.next()
    await (await fetch(url)).text()
    await recorded
    expect(log.entries[0]?.status).toBe(403)
  })

  it('並行するリクエストの処理時間を取り違えない', async () => {
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

  it('途中で切断された応答は aborted として 1 回だけ記録する', async () => {
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

describe('出力', () => {
  it('既定では 1 行のテキストを標準出力に書く', async () => {
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

  it('write が例外を投げても応答とサーバに影響しない', async () => {
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

  it('write の非同期の失敗も捕まえる', async () => {
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

  it('制御文字をエスケープして、ログを偽装させない', () => {
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

  it('aborted と contentLength を表示する', () => {
    expect(formatLogEntry({ ...base, contentLength: 10, aborted: true })).toBe(
      '2026-01-01T00:00:00.000Z GET / 200 1.2ms 10B aborted',
    )
  })
})
